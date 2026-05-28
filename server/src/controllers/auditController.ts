import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { HttpError } from '../middleware/errorHandler';

const querySchema = z.object({
  action: z.string().optional(),
  actor: z.string().optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => {
      const n = v ? parseInt(v, 10) : 50;
      return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 50;
    }),
});

export async function listAuditLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new HttpError(401, 'Unauthorized');
    const q = querySchema.parse(req.query);

    const where: Record<string, unknown> = { orgId: req.user.orgId };
    if (q.action) where.action = q.action;
    if (q.actor) where.actorId = q.actor;
    if (q.targetType) where.targetType = q.targetType;
    if (q.targetId) where.targetId = q.targetId;
    if (q.from || q.to) {
      const range: Record<string, Date> = {};
      if (q.from) range.gte = new Date(q.from);
      if (q.to) range.lte = new Date(q.to);
      where.createdAt = range;
    }

    const items = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > q.limit;
    const page = hasMore ? items.slice(0, q.limit) : items;

    // Optionally enrich with actor names.
    const actorIds = Array.from(new Set(page.map((r) => r.actorId).filter((v): v is string => !!v)));
    const actors = actorIds.length
      ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } })
      : [];
    const actorMap = new Map(actors.map((u) => [u.id, u]));

    res.json({
      items: page.map((r) => ({
        id: r.id,
        action: r.action,
        actorType: r.actorType,
        actorId: r.actorId,
        actor: r.actorId ? actorMap.get(r.actorId) ?? null : null,
        targetType: r.targetType,
        targetId: r.targetId,
        ip: r.ip,
        userAgent: r.userAgent,
        metadata: r.metadata,
        createdAt: r.createdAt,
      })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    });
  } catch (err) {
    next(err);
  }
}

/** Distinct action names — used to populate the filter dropdown. */
export async function listActions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new HttpError(401, 'Unauthorized');
    const rows = await prisma.auditLog.findMany({
      where: { orgId: req.user.orgId },
      select: { action: true },
      distinct: ['action'],
      orderBy: { action: 'asc' },
      take: 500,
    });
    res.json({ actions: rows.map((r) => r.action) });
  } catch (err) {
    next(err);
  }
}
