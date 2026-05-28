import Bull from 'bull';
import { env } from '../lib/env';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { writeAudit } from '../lib/audit';

interface SweepData { tick: true }

export const retentionQueue = new Bull<SweepData>('retention-sweep', env.redisUrl, {
  defaultJobOptions: { removeOnComplete: 5, removeOnFail: 25, attempts: 1 },
});

const DEFAULT_RETENTION = {
  auditLogDays: 365,
  loginAttemptDays: 90,
  refreshTokenGraceDays: 7,           // expired+revoked refresh tokens kept this long for forensics
  scheduledReportRunDays: 180,
  webhookDeliveryDays: 90,
  reportShareViewDays: 365,
  // Soft-deleted Agent rows hard-deleted after this many days past deletedAt.
  softDeletedAgentDays: 30,
};

async function ensureRecurring(): Promise<void> {
  const repeatable = await retentionQueue.getRepeatableJobs();
  const already = repeatable.find((j) => j.name === 'sweep');
  if (already) return;
  // Run hourly. Each run is short — paginated DELETE by createdAt ranges.
  await retentionQueue.add('sweep', { tick: true }, { repeat: { every: 60 * 60 * 1000 } });
}

function daysAgo(d: number): Date {
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000);
}

retentionQueue.process('sweep', async () => {
  const r = DEFAULT_RETENTION;
  let total = 0;

  try {
    const auditCutoff = daysAgo(r.auditLogDays);
    // NEM-2026-016: AuditLog is locked append-only at the DB. Lift the lock
    // for this single transaction so retention-policy deletion is allowed.
    const a = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL cortexview.audit_modify = 'on'");
      return tx.auditLog.deleteMany({ where: { createdAt: { lt: auditCutoff } } });
    });
    total += a.count;

    const loginCutoff = daysAgo(r.loginAttemptDays);
    const b = await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: loginCutoff } } });
    total += b.count;

    const refreshCutoff = daysAgo(r.refreshTokenGraceDays);
    const c = await prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: refreshCutoff } },
          { revokedAt: { lt: refreshCutoff } },
        ],
      },
    });
    total += c.count;

    const schedRunCutoff = daysAgo(r.scheduledReportRunDays);
    const d = await prisma.scheduledReportRun.deleteMany({ where: { startedAt: { lt: schedRunCutoff } } });
    total += d.count;

    const whCutoff = daysAgo(r.webhookDeliveryDays);
    const e = await prisma.webhookDelivery.deleteMany({ where: { createdAt: { lt: whCutoff } } });
    total += e.count;

    const shareCutoff = daysAgo(r.reportShareViewDays);
    const f = await prisma.reportShareView.deleteMany({ where: { viewedAt: { lt: shareCutoff } } });
    total += f.count;

    // Soft-deleted Agents past their grace window get hard-deleted.
    // Cascade kills child suites, runs, results, reports. Audit per-org
    // before we drop them so retention doesn't erase the trail.
    const agentCutoff = daysAgo(r.softDeletedAgentDays);
    const expiringAgents = await prisma.agent.findMany({
      where: { deletedAt: { not: null, lt: agentCutoff } },
      select: { id: true, orgId: true, name: true },
    });
    for (const agt of expiringAgents) {
      await writeAudit({
        orgId: agt.orgId,
        action: 'record.purged_by_retention',
        actorType: 'system',
        targetType: 'agent',
        targetId: agt.id,
        metadata: { name: agt.name, retentionDays: r.softDeletedAgentDays },
      });
    }
    const g = await prisma.agent.deleteMany({ where: { deletedAt: { not: null, lt: agentCutoff } } });
    total += g.count;

    // Clear webhook `secretPrevious` once the 24h overlap has expired so we
    // don't keep stale encrypted material around longer than necessary.
    const cleared = await prisma.webhook.updateMany({
      where: {
        secretPreviousExpiresAt: { not: null, lt: new Date() },
      },
      data: { secretPrevious: null, secretPreviousExpiresAt: null },
    });
    total += cleared.count;

    if (total > 0) {
      logger.info({ deleted: total }, 'retention sweep completed');
    }
  } catch (err) {
    logger.warn({ err }, 'retention sweep failed');
    throw err;
  }
});

retentionQueue.on('error', (err) => logger.error({ err }, 'retention queue error'));

void ensureRecurring().catch((err) => logger.warn({ err }, 'failed to install retention sweep'));
