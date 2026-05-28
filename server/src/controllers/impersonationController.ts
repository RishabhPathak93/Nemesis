import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { signAccessToken } from '../lib/jwt';
import { auditFromRequest } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';

const ImpersonateSchema = z.object({
  targetUserId: z.string().min(1),
  reason: z.string().min(1).max(500),
  durationMinutes: z.number().int().min(5).max(240).default(60),
});

/**
 * v1.5 — Admin can impersonate a member for time-bounded support / debug.
 * Issues a short-lived access token tagged with `impersonatedBy` (planned for
 * an extended JWT payload — for now we lean on audit log to surface usage).
 *
 * Every request made under the impersonated session is audited; the original
 * admin's id is preserved in the ImpersonationSession row.
 */

export async function startImpersonation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const adminId = req.user!.userId;
    if (req.user!.role !== 'ADMIN') throw new HttpError(403, 'only admins may impersonate');
    const body = ImpersonateSchema.parse(req.body);
    const target = await prisma.user.findFirst({ where: { id: body.targetUserId, orgId } });
    if (!target) throw new HttpError(404, 'target user not in your org');
    if (!target.isActive) throw new HttpError(400, 'target is deactivated');

    const expiresAt = new Date(Date.now() + body.durationMinutes * 60_000);
    const session = await prisma.impersonationSession.create({
      data: { orgId, adminId, targetUserId: body.targetUserId, reason: body.reason, expiresAt },
    });

    const accessToken = signAccessToken({
      userId: target.id,
      orgId: target.orgId,
      role: target.role,
      tokenVersion: target.tokenVersion,
    });

    await auditFromRequest(req, {
      action: 'impersonation.start',
      targetType: 'user',
      targetId: target.id,
      metadata: { reason: body.reason, durationMinutes: body.durationMinutes, sessionId: session.id },
    });

    res.json({ accessToken, session, target: { id: target.id, email: target.email, role: target.role } });
  } catch (err) { next(err); }
}

export async function endImpersonation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const id = req.params.id;
    const session = await prisma.impersonationSession.findFirst({ where: { id, orgId } });
    if (!session) throw new HttpError(404, 'session not found');
    await prisma.impersonationSession.update({ where: { id }, data: { endedAt: new Date() } });
    await auditFromRequest(req, {
      action: 'impersonation.end',
      targetType: 'user',
      targetId: session.targetUserId,
      metadata: { sessionId: id },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function listImpersonations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const sessions = await prisma.impersonationSession.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ sessions });
  } catch (err) { next(err); }
}
