import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { auditFromRequest } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';

const PutSchema = z.object({
  capTestRunsPerMonth: z.number().int().nonnegative().nullable().optional(),
  capAgents: z.number().int().nonnegative().nullable().optional(),
  capApiKeys: z.number().int().nonnegative().nullable().optional(),
  capScheduledReports: z.number().int().nonnegative().nullable().optional(),
});

export async function getUsage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    let usage = await prisma.orgUsage.findUnique({ where: { orgId } });
    if (!usage) {
      // Lazy-init counters from current rows.
      const [agents, keys, sched] = await Promise.all([
        prisma.agent.count({ where: { orgId } }),
        prisma.apiKey.count({ where: { orgId, revokedAt: null } }),
        prisma.scheduledReport.count({ where: { orgId } }),
      ]);
      usage = await prisma.orgUsage.create({
        data: {
          orgId,
          agentCount: agents,
          apiKeyCount: keys,
          scheduledReportCount: sched,
        },
      });
    }
    res.json(usage);
  } catch (err) { next(err); }
}

/** Admin-only — set caps (per-org governance, not commercial billing). */
export async function setCaps(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const body = PutSchema.parse(req.body);
    const usage = await prisma.orgUsage.upsert({
      where: { orgId },
      create: { orgId, ...body },
      update: body,
    });
    await auditFromRequest(req, {
      action: 'org.quota.update',
      targetType: 'org',
      targetId: orgId,
      metadata: { changed: Object.keys(body) },
    });
    res.json(usage);
  } catch (err) { next(err); }
}

/** Reset monthly counters (manual). Called by retention sweeper monthly in v1.4+. */
export async function resetMonthlyCounters(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    await prisma.orgUsage.upsert({
      where: { orgId },
      create: { orgId, testRunsThisMonth: 0, resetAt: new Date() },
      update: { testRunsThisMonth: 0, resetAt: new Date() },
    });
    await auditFromRequest(req, { action: 'org.quota.reset', targetType: 'org', targetId: orgId });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

/**
 * Quota gate — call this in routes/services that should consume quota
 * (e.g. agent.create, run.start, scheduled_report.create). Throws HttpError(429)
 * when over.
 */
export async function ensureUnderQuota(orgId: string, kind: 'testRunsPerMonth' | 'agents' | 'apiKeys' | 'scheduledReports'): Promise<void> {
  const usage = await prisma.orgUsage.findUnique({ where: { orgId } });
  if (!usage) return;
  const counterField = {
    testRunsPerMonth: 'testRunsThisMonth',
    agents: 'agentCount',
    apiKeys: 'apiKeyCount',
    scheduledReports: 'scheduledReportCount',
  }[kind] as keyof typeof usage;
  const capField = {
    testRunsPerMonth: 'capTestRunsPerMonth',
    agents: 'capAgents',
    apiKeys: 'capApiKeys',
    scheduledReports: 'capScheduledReports',
  }[kind] as keyof typeof usage;
  const cap = usage[capField] as number | null | undefined;
  const cur = usage[counterField] as number | undefined;
  if (cap == null || cur == null) return;
  if (cur >= cap) {
    throw new HttpError(429, `quota exceeded for ${kind} (${cur}/${cap})`);
  }
}
