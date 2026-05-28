import Bull from 'bull';
import { promises as fs } from 'fs';
import * as path from 'path';
import { env } from '../lib/env';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { writeAudit } from '../lib/audit';

interface SweepData { tick: true }

export const complianceEvidenceQueue = new Bull<SweepData>('compliance-evidence', env.redisUrl, {
  defaultJobOptions: { removeOnComplete: 5, removeOnFail: 25, attempts: 1 },
});

const COMPLIANCE_DIR = process.env.CV_COMPLIANCE_DIR || '/tmp/cortexview-compliance';

async function ensureRecurring(): Promise<void> {
  const repeatable = await complianceEvidenceQueue.getRepeatableJobs();
  if (repeatable.find((j) => j.name === 'snapshot')) return;
  // Daily at 02:00 UTC. Operators tweak per OPERATOR.md.
  await complianceEvidenceQueue.add('snapshot', { tick: true }, { repeat: { cron: '0 2 * * *' } });
}

interface AccessReviewRow {
  userId: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  orgId: string;
  lastLoginAt: Date | null;
}

async function collectAccessReview(orgId: string): Promise<AccessReviewRow[]> {
  const users = await prisma.user.findMany({
    where: { orgId },
    select: { id: true, email: true, name: true, role: true, isActive: true, orgId: true, lastLoginAt: true },
  });
  return users.map((u) => ({ userId: u.id, ...u }));
}

async function collectChangeLog(orgId: string, since: Date): Promise<unknown[]> {
  // Audit-log rows that represent configuration / governance changes.
  return prisma.auditLog.findMany({
    where: {
      orgId,
      createdAt: { gte: since },
      action: {
        in: [
          'org.saml.configure', 'org.saml.enable', 'org.saml.disable',
          'org.oidc.configure', 'org.oidc.enable',
          'policy.update', 'org.quota.update',
          'webhook.create', 'webhook.delete', 'webhook.rotate_secret',
          'notification_channel.create', 'notification_channel.delete',
          'scheduled_report.create', 'scheduled_report.delete',
          'data_subject_request.create', 'data_subject_request.approve',
          'impersonation.start', 'impersonation.end',
          'user.locked', 'auth.ip.blocked', 'auth.country.blocked',
          'probe.disable', 'probe.enable',
        ],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 5_000,
    select: {
      id: true, action: true, actorId: true, actorType: true,
      targetType: true, targetId: true, ip: true, userAgent: true,
      metadata: true, createdAt: true,
    },
  });
}

async function collectUptime(orgId: string, since: Date): Promise<{ daysObserved: number; failedHealthChecks: number }> {
  void orgId;
  // We don't keep a rolling /health/deep history table. As a proxy, count
  // queue.dlq.* and unhandled-error audit rows in the period.
  const errs = await prisma.auditLog.count({
    where: {
      createdAt: { gte: since },
      action: { in: ['queue.dlq.test_run', 'queue.dlq.webhook'] },
    },
  });
  const days = Math.max(1, Math.ceil((Date.now() - since.getTime()) / (24 * 60 * 60 * 1000)));
  return { daysObserved: days, failedHealthChecks: errs };
}

async function collectAuditEvents(orgId: string, since: Date): Promise<unknown[]> {
  return prisma.auditLog.findMany({
    where: { orgId, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 50_000,
    select: {
      id: true, action: true, actorId: true, actorType: true,
      targetType: true, targetId: true, ip: true, metadata: true, createdAt: true,
    },
  });
}

async function generateForOrg(orgId: string, periodStart: Date, periodEnd: Date): Promise<{ contentPath: string; size: number }> {
  const dir = path.resolve(COMPLIANCE_DIR, orgId);
  await fs.mkdir(dir, { recursive: true });
  const stamp = periodEnd.toISOString().slice(0, 10);
  const target = path.resolve(dir, `evidence-${stamp}.json`);

  const [accessReview, changeLog, uptime, auditEvents] = await Promise.all([
    collectAccessReview(orgId),
    collectChangeLog(orgId, periodStart),
    collectUptime(orgId, periodStart),
    collectAuditEvents(orgId, periodStart),
  ]);

  const bundle = JSON.stringify({
    orgId,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    generatedAt: new Date().toISOString(),
    access_review: accessReview,
    change_log: changeLog,
    uptime,
    audit_events: auditEvents,
  }, null, 2);

  await fs.writeFile(target, bundle);
  return { contentPath: target, size: bundle.length };
}

complianceEvidenceQueue.process('snapshot', async () => {
  const orgs = await prisma.org.findMany({ select: { id: true } });
  const periodEnd = new Date();
  const periodStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90-day rolling window

  for (const o of orgs) {
    try {
      const { contentPath, size } = await generateForOrg(o.id, periodStart, periodEnd);
      const ev = await prisma.complianceEvidence.create({
        data: {
          orgId: o.id,
          kind: 'BUNDLE',
          periodStart, periodEnd,
          contentPath,
        },
      });
      await writeAudit({
        orgId: o.id,
        action: 'compliance.evidence.generated',
        actorType: 'system',
        targetType: 'compliance_evidence',
        targetId: ev.id,
        metadata: { sizeBytes: size, periodStart, periodEnd },
      });
    } catch (err) {
      logger.warn({ err, orgId: o.id }, 'compliance evidence generation failed');
    }
  }
});

complianceEvidenceQueue.on('error', (err) => logger.error({ err }, 'compliance-evidence queue error'));

void ensureRecurring().catch((err) => logger.warn({ err }, 'failed to install compliance evidence cron'));

/** Manual trigger for an immediate snapshot — used by the admin "Generate now" UI. */
export async function generateComplianceEvidenceNow(orgId: string, days = 90): Promise<{ id: string; contentPath: string }> {
  const periodEnd = new Date();
  const periodStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { contentPath } = await generateForOrg(orgId, periodStart, periodEnd);
  const ev = await prisma.complianceEvidence.create({
    data: { orgId, kind: 'BUNDLE', periodStart, periodEnd, contentPath },
  });
  return { id: ev.id, contentPath };
}
