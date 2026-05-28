import Bull from 'bull';
import { env } from '../lib/env';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { runScheduledReport } from '../services/scheduledRunner';

interface ScheduledTickData { tick: true }

export const scheduledReportQueue = new Bull<ScheduledTickData>('scheduled-reports-tick', env.redisUrl, {
  defaultJobOptions: { removeOnComplete: 5, removeOnFail: 50, attempts: 1 },
});

/** Recurring 60-second tick that scans for due scheduled reports. */
async function ensureRecurring(): Promise<void> {
  const repeatable = await scheduledReportQueue.getRepeatableJobs();
  const already = repeatable.find((j) => j.name === 'tick');
  if (already) return;
  await scheduledReportQueue.add('tick', { tick: true }, { repeat: { every: 60_000 } });
}

scheduledReportQueue.process('tick', async () => {
  const now = new Date();
  const due = await prisma.scheduledReport.findMany({
    where: {
      enabled: true,
      OR: [
        { nextRunAt: null },
        { nextRunAt: { lte: now } },
      ],
    },
    take: 50,
  });
  for (const sched of due) {
    try {
      await runScheduledReport(sched.id);
    } catch (err) {
      logger.warn({ err, scheduledId: sched.id }, 'scheduled report tick: run failed');
    }
  }
});

scheduledReportQueue.on('error', (err) => logger.error({ err }, 'scheduled-report queue error'));

void ensureRecurring().catch((err) => logger.warn({ err }, 'failed to install scheduled-report tick'));
