import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { promises as fs } from 'fs';
import * as path from 'path';
import { prisma } from '../lib/prisma';
import { auditFromRequest } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';
import { env } from '../lib/env';
import { logger } from '../lib/logger';

const CreateSchema = z.object({
  type: z.enum(['EXPORT', 'DELETE']),
});

const ApprovalSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
});

/**
 * GDPR / CCPA Data Subject Requests (v1.5).
 *
 * EXPORT: any user can request a tarball of their own data + the audit rows
 *   they're the actor of. The export is generated synchronously here for
 *   simplicity; for very large orgs, swap to a Bull job in v2.0.
 *
 * DELETE: any user can request, but only an ADMIN can APPROVE. On approval,
 *   the user is anonymised (email rewritten, name "Deleted User", PII stripped)
 *   while audit rows remain (with actorId nulled) for forensic continuity.
 */

const DSR_DIR = process.env.CV_DSR_DIR || '/tmp/cortexview-dsr';

export async function listDsrs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'ADMIN';
    const where = isAdmin ? { orgId } : { orgId, userId };
    const rows = await prisma.dataSubjectRequest.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      take: 100,
    });
    res.json({ requests: rows });
  } catch (err) { next(err); }
}

export async function createDsr(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const userId = req.user!.userId;
    const { type } = CreateSchema.parse(req.body);
    const dsr = await prisma.dataSubjectRequest.create({
      data: { orgId, userId, type, status: type === 'EXPORT' ? 'APPROVED' : 'PENDING' },
    });
    await auditFromRequest(req, {
      action: 'data_subject_request.create',
      targetType: 'data_subject_request',
      targetId: dsr.id,
      metadata: { type },
    });
    // EXPORT runs immediately; DELETE waits for admin approval.
    if (type === 'EXPORT') void runExport(dsr.id, userId, orgId);
    res.status(201).json(dsr);
  } catch (err) { next(err); }
}

export async function approveDsr(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const adminId = req.user!.userId;
    const id = req.params.id;
    const { status } = ApprovalSchema.parse(req.body);
    const dsr = await prisma.dataSubjectRequest.findFirst({ where: { id, orgId } });
    if (!dsr) throw new HttpError(404, 'DSR not found');
    if (dsr.status !== 'PENDING') throw new HttpError(400, `DSR is ${dsr.status}, cannot transition`);

    await prisma.dataSubjectRequest.update({
      where: { id },
      data: { status, approvedAt: new Date(), approvedById: adminId },
    });
    await auditFromRequest(req, {
      action: status === 'APPROVED' ? 'data_subject_request.approve' : 'data_subject_request.reject',
      targetType: 'data_subject_request',
      targetId: id,
    });
    if (status === 'APPROVED' && dsr.type === 'DELETE') {
      void runDelete(dsr.id, dsr.userId, orgId);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function runExport(dsrId: string, userId: string, orgId: string): Promise<void> {
  try {
    const [user, agents, runs, audit] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.agent.findMany({ where: { orgId } }),
      prisma.testRun.findMany({ where: { suite: { agent: { orgId } } }, take: 1000, orderBy: { createdAt: 'desc' } }),
      prisma.auditLog.findMany({ where: { orgId, actorId: userId }, take: 5000, orderBy: { createdAt: 'desc' } }),
    ]);
    const bundle = JSON.stringify({ user, agents, runs, audit, exportedAt: new Date().toISOString() }, null, 2);
    const dir = path.resolve(DSR_DIR, orgId);
    await fs.mkdir(dir, { recursive: true });
    const target = path.resolve(dir, `${dsrId}.json`);
    await fs.writeFile(target, bundle);
    await prisma.dataSubjectRequest.update({
      where: { id: dsrId },
      data: { status: 'COMPLETED', completedAt: new Date(), downloadPath: target },
    });
  } catch (err) {
    logger.warn({ err, dsrId }, 'DSR export failed');
    await prisma.dataSubjectRequest.update({
      where: { id: dsrId },
      data: { status: 'FAILED', errorMessage: err instanceof Error ? err.message : String(err) },
    });
  }
  void env;
}

async function runDelete(dsrId: string, userId: string, _orgId: string): Promise<void> {
  try {
    // Last-admin guard: never anonymise the org's last admin.
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('user vanished');
    if (user.role === 'ADMIN') {
      const otherAdmins = await prisma.user.count({
        where: { orgId: user.orgId, role: 'ADMIN', isActive: true, id: { not: userId } },
      });
      if (otherAdmins === 0) throw new Error('cannot delete the last active admin in the org');
    }
    // NEM-2026-016: AuditLog is append-only at the DB; lift the guard inside
    // this transaction for the GDPR-mandated actorId anonymisation.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL cortexview.audit_modify = 'on'");
      await tx.user.update({
        where: { id: userId },
        data: {
          email: `deleted-${userId.slice(0, 8)}@removed.local`,
          name: 'Deleted User',
          mfaSecret: null,
          mfaEnabled: false,
          mfaBackupCodes: [],
          isActive: false,
          deactivatedAt: new Date(),
          tokenVersion: { increment: 1 }, // forces logout of any active sessions
        },
      });
      await tx.auditLog.updateMany({ where: { actorId: userId }, data: { actorId: null } });
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    await prisma.dataSubjectRequest.update({
      where: { id: dsrId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  } catch (err) {
    logger.warn({ err, dsrId }, 'DSR delete failed');
    await prisma.dataSubjectRequest.update({
      where: { id: dsrId },
      data: { status: 'FAILED', errorMessage: err instanceof Error ? err.message : String(err) },
    });
  }
}

/** GET /api/data-subject-requests/:id/download — admin streams the export. */
export async function downloadDsr(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const id = req.params.id;
    const dsr = await prisma.dataSubjectRequest.findFirst({ where: { id, orgId } });
    if (!dsr || !dsr.downloadPath) throw new HttpError(404, 'export not ready');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="dsr-${id}.json"`);
    res.sendFile(dsr.downloadPath);
  } catch (err) { next(err); }
}
