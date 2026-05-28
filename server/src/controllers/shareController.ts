import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { HttpError } from '../middleware/errorHandler';
import { auditFromRequest } from '../lib/audit';

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  rotate: z.boolean().optional(),
});

async function loadOwnedReport(req: Request, id: string) {
  if (!req.user) throw new HttpError(401, 'Unauthorized');
  const report = await prisma.report.findUnique({
    where: { id },
    include: { testRun: { include: { suite: { include: { agent: true } } } } },
  });
  if (!report || report.testRun.suite.agent.orgId !== req.user.orgId) {
    throw new HttpError(404, 'Report not found');
  }
  return report;
}

export async function updateShare(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const parsed = updateSchema.parse(req.body);
    const report = await loadOwnedReport(req, id);

    const data: Record<string, unknown> = {};
    if (typeof parsed.enabled === 'boolean') {
      data.shareEnabled = parsed.enabled;
      data.shareRevokedAt = parsed.enabled ? null : new Date();
    }
    if (parsed.expiresAt !== undefined) {
      data.shareExpiresAt = parsed.expiresAt ? new Date(parsed.expiresAt) : null;
    }
    if (parsed.rotate) {
      // Generate a fresh shareToken — old links go 404.
      const { randomBytes } = await import('crypto');
      data.shareToken = `r_${randomBytes(16).toString('hex')}`;
    }
    if (req.user) data.shareCreatedById = req.user.userId;

    const updated = await prisma.report.update({ where: { id }, data });

    await auditFromRequest(req, {
      action: 'report.share.updated',
      targetType: 'report',
      targetId: id,
      metadata: {
        enabled: updated.shareEnabled,
        expiresAt: updated.shareExpiresAt,
        rotated: !!parsed.rotate,
      },
    });

    res.json({
      shareToken: updated.shareToken,
      shareEnabled: updated.shareEnabled,
      shareExpiresAt: updated.shareExpiresAt,
      shareRevokedAt: updated.shareRevokedAt,
    });
  } catch (err) {
    next(err);
  }
}

export async function revokeShare(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const report = await loadOwnedReport(req, id);
    await prisma.report.update({
      where: { id: report.id },
      data: { shareEnabled: false, shareRevokedAt: new Date() },
    });
    await auditFromRequest(req, {
      action: 'report.share.revoked',
      targetType: 'report',
      targetId: id,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/** List recent share-link views for a report. Admin/analyst only — same gate as report read. */
export async function listShareViews(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const report = await loadOwnedReport(req, id);
    const views = await prisma.reportShareView.findMany({
      where: { reportId: report.id },
      orderBy: { viewedAt: 'desc' },
      take: 100,
    });
    res.json({
      views: views.map((v) => ({ id: v.id, ip: v.ip, userAgent: v.userAgent, viewedAt: v.viewedAt })),
      total: views.length,
    });
  } catch (err) {
    next(err);
  }
}
