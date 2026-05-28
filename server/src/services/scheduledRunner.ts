import cronParser from 'cron-parser';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sendToChannel, type Notification } from './channels';
import { renderReportHtml } from './exporters/htmlExporter';
import { writeAudit } from '../lib/audit';

/**
 * Single-tick scheduled-report runner. The cron worker invokes this every 60 s;
 * we scan for due rows, render the latest report for the agent (or org rollup),
 * fan out to channels, then advance nextRunAt.
 */

export function nextRunFor(cronExpr: string, timezone: string, after?: Date): Date | null {
  try {
    const it = cronParser.parseExpression(cronExpr, {
      tz: timezone || 'UTC',
      currentDate: after ?? new Date(),
    });
    return it.next().toDate();
  } catch (err) {
    logger.warn({ err, cronExpr, timezone }, 'invalid cron expression');
    return null;
  }
}

interface ChannelResults { [channelId: string]: { ok: true } | { ok: false; error: string } }

async function buildDigest(scheduledId: string, sched: { orgId: string }): Promise<{ n: Notification; reportId: string | null }> {
  // v2.0 — weekly digest. Aggregates the last 7 days of completed runs across
  // the org and produces a single rolled-up notification suitable for email.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const runs = await prisma.testRun.findMany({
    where: {
      status: 'COMPLETED',
      completedAt: { gte: since },
      suite: { agent: { orgId: sched.orgId } },
    },
    include: { report: true, suite: { include: { agent: { select: { name: true } } } } },
    orderBy: { completedAt: 'desc' },
    take: 50,
  });
  if (runs.length === 0) {
    return {
      reportId: null,
      n: {
        subject: 'Nemesis AI weekly digest — no runs this week',
        body: 'No completed test runs in the past 7 days.',
        severity: 'info',
      },
    };
  }
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  let totalScore = 0;
  let scored = 0;
  const lines: string[] = [];
  for (const r of runs) {
    const rep = r.report;
    if (rep) {
      const k = (rep.overallRiskRating || 'low').toLowerCase() as keyof typeof counts;
      if (k in counts) counts[k]++;
      totalScore += rep.riskScore || 0;
      scored++;
      lines.push(`• ${r.suite.agent.name}: ${rep.overallRiskRating} (${rep.riskScore}/100)`);
    }
  }
  const avg = scored > 0 ? Math.round(totalScore / scored) : 0;
  void scheduledId;
  return {
    reportId: null,
    n: {
      subject: `Nemesis AI weekly digest — ${runs.length} runs`,
      body:
        `${runs.length} test runs completed in the past 7 days.\n` +
        `Risk breakdown: ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low.\n` +
        `Average risk score: ${avg}/100.\n\n` +
        lines.slice(0, 10).join('\n'),
      severity: counts.critical > 0 ? 'critical' : counts.high > 0 ? 'warning' : 'info',
    },
  };
}

async function buildNotificationFor(scheduledId: string, scope: string, agentId: string | null): Promise<{ n: Notification; reportId: string | null }> {
  // v2.0 — DIGEST scope: weekly rollup, no per-run report attached.
  if (scope === 'DIGEST') {
    const sched = await prisma.scheduledReport.findUnique({ where: { id: scheduledId } });
    if (!sched) throw new Error(`scheduled report ${scheduledId} missing`);
    return buildDigest(scheduledId, sched);
  }
  // For AGENT scope — pick the agent's latest completed report. ORG scope rolls up the org.
  if (scope === 'AGENT' && agentId) {
    const latestRun = await prisma.testRun.findFirst({
      where: { suite: { agentId }, status: 'COMPLETED', report: { isNot: null } },
      orderBy: { completedAt: 'desc' },
      include: { report: true, suite: { include: { agent: true } } },
    });
    if (!latestRun?.report) {
      return {
        reportId: null,
        n: {
          subject: 'Nemesis AI — no completed run yet',
          body: 'Scheduled report fired but no completed test run is available for this agent.',
          severity: 'info',
        },
      };
    }
    return {
      reportId: latestRun.report.id,
      n: {
        subject: `Security report: ${latestRun.suite.agent.name}`,
        body: `Risk: ${latestRun.report.overallRiskRating} (score ${latestRun.report.riskScore}/100). Open in Nemesis AI for full findings.`,
        severity: latestRun.report.overallRiskRating === 'critical' || latestRun.report.overallRiskRating === 'high'
          ? 'critical' : 'info',
        link: undefined,
      },
    };
  }

  // ORG rollup — pick the most recent completed run across the org
  const sched = await prisma.scheduledReport.findUnique({ where: { id: scheduledId } });
  if (!sched) throw new Error(`scheduled report ${scheduledId} missing`);
  const recent = await prisma.testRun.findFirst({
    where: {
      status: 'COMPLETED',
      report: { isNot: null },
      suite: { agent: { orgId: sched.orgId } },
    },
    orderBy: { completedAt: 'desc' },
    include: { report: true },
  });
  if (!recent?.report) {
    return {
      reportId: null,
      n: {
        subject: 'Nemesis AI — no completed runs',
        body: 'Scheduled rollup fired but no completed test runs exist for the organisation.',
        severity: 'info',
      },
    };
  }
  return {
    reportId: recent.report.id,
    n: {
      subject: 'Nemesis AI — latest org-wide report',
      body: `Latest run risk: ${recent.report.overallRiskRating} (score ${recent.report.riskScore}/100).`,
      severity: 'info',
    },
  };
}

export async function runScheduledReport(scheduledId: string): Promise<void> {
  const sched = await prisma.scheduledReport.findUnique({ where: { id: scheduledId } });
  if (!sched || !sched.enabled) return;

  const run = await prisma.scheduledReportRun.create({
    data: { scheduledReportId: scheduledId, status: 'PENDING', startedAt: new Date() },
  });

  try {
    const { n, reportId } = await buildNotificationFor(sched.id, sched.scope, sched.agentId);
    // For HTML export, attach a renderable report URL when available.
    if (reportId && sched.format === 'HTML') {
      try {
        await renderReportHtml(reportId);
      } catch (err) {
        logger.warn({ err, reportId }, 'scheduled report render failed (continuing without attachment)');
      }
    }
    const channelResults: ChannelResults = {};
    for (const channelId of sched.channels) {
      channelResults[channelId] = await sendToChannel(channelId, n);
    }
    const allOk = Object.values(channelResults).every((r) => r.ok);
    const next = nextRunFor(sched.cronExpr, sched.timezone);
    await prisma.$transaction([
      prisma.scheduledReportRun.update({
        where: { id: run.id },
        data: {
          status: allOk ? 'SUCCEEDED' : 'FAILED',
          completedAt: new Date(),
          reportId: reportId ?? null,
          channelResults: channelResults as never,
        },
      }),
      prisma.scheduledReport.update({
        where: { id: scheduledId },
        data: { lastRunAt: new Date(), nextRunAt: next ?? null },
      }),
    ]);
    await writeAudit({
      orgId: sched.orgId,
      action: allOk ? 'scheduled_report.run.success' : 'scheduled_report.run.failure',
      targetType: 'scheduled_report',
      targetId: scheduledId,
      metadata: { channels: Object.keys(channelResults).length, allOk },
    });
  } catch (err) {
    const next = nextRunFor(sched.cronExpr, sched.timezone);
    await prisma.scheduledReportRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });
    await prisma.scheduledReport.update({
      where: { id: scheduledId },
      data: { lastRunAt: new Date(), nextRunAt: next ?? null },
    });
    await writeAudit({
      orgId: sched.orgId,
      action: 'scheduled_report.run.failure',
      targetType: 'scheduled_report',
      targetId: scheduledId,
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}
