import os from 'node:os';
import Bull from 'bull';
import { env } from '../lib/env';
import { executeTestRun } from '../services/testRunner';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { writeAudit } from '../lib/audit';
import { nemesisQueueDepth, nemesisRunState } from '../lib/metrics';

// v2.2 — D4: queue concurrency tunable via QUEUE_CONCURRENCY env var.
// Defaults to the number of CPU cores. Setting "unlimited" means "as many as
// Node can spawn", which Bull caps at its internal Worker pool anyway.
function resolveQueueConcurrency(): number {
  const cpus = Math.max(1, os.cpus().length);
  return Number.isFinite(env.queueConcurrency)
    ? Math.max(1, env.queueConcurrency)
    : cpus;
}

export interface TestRunJobData {
  testRunId: string;
  /** SE-6 — narrow the probe-catalog block in test generation to this pack. */
  verticalPackSlug?: string;
  /**
   * v2.2 — Knobs for the Cartesian enumerator. Only consulted when the
   * TestRun's `enumerationMode` is `'cartesian'`. Plain JSON-serialisable
   * shape so Bull can round-trip it through Redis.
   */
  cartesianOptions?: {
    chainDepth?: number;
    includeMultilingual?: boolean;
  };
}

const RETRY_BACKOFF_MS = 5_000;
const MAX_ATTEMPTS = 3;

export const testRunQueue = new Bull<TestRunJobData>('test-runs', env.redisUrl, {
  defaultJobOptions: {
    // v1.4 — exponential backoff retries.
    attempts: MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: RETRY_BACKOFF_MS },
    removeOnComplete: 100,
    removeOnFail: 100,
  },
});

/**
 * v1.4 — paired dead-letter queue. Jobs that exhaust their attempts here land
 * as audit-logged dead letters. Operators inspect via `bull-board` (mounted
 * separately) or directly via Redis.
 */
export const testRunDlq = new Bull<TestRunJobData & { reason: string }>('test-runs-dlq', env.redisUrl, {
  defaultJobOptions: { removeOnComplete: 50, removeOnFail: 200, attempts: 1 },
});

testRunQueue.process(resolveQueueConcurrency(), async (job) => {
  const { testRunId, verticalPackSlug, cartesianOptions } = job.data;
  try {
    // W2 observability: surface queue depth + the run-state transition.
    try { nemesisQueueDepth.set({ queue: 'test_runs' }, await testRunQueue.getWaitingCount()); } catch { /* metrics best-effort */ }
    nemesisRunState.inc({ from: 'queued', to: 'running' });
    await executeTestRun(testRunId, { verticalPackSlug, cartesianOptions });
    nemesisRunState.inc({ from: 'running', to: 'completed' });
  } catch (err) {
    nemesisRunState.inc({ from: 'running', to: 'failed' });
    logger.warn({ err, testRunId, attempt: job.attemptsMade }, `TestRun ${testRunId} attempt ${job.attemptsMade}/${MAX_ATTEMPTS} failed`);
    await prisma.testRun.update({
      where: { id: testRunId },
      data: {
        status: 'FAILED',
        errorMessage: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      },
    });
    throw err; // triggers Bull retry (or dead-letter on the final attempt — see `failed` handler below)
  }
});

testRunQueue.on('failed', async (job, err) => {
  if (job.attemptsMade < MAX_ATTEMPTS) return; // still retrying
  const { testRunId } = job.data;
  // Push the exhausted job into the DLQ for inspection / replay.
  await testRunDlq.add({
    ...job.data,
    reason: err instanceof Error ? err.message : String(err),
  });
  // Audit the dead-letter event so the trail survives queue cleanup.
  const run = await prisma.testRun.findUnique({
    where: { id: testRunId },
    include: { suite: { include: { agent: { select: { orgId: true } } } } },
  });
  if (run) {
    await writeAudit({
      orgId: run.suite.agent.orgId,
      action: 'queue.dlq.test_run',
      actorType: 'system',
      targetType: 'test_run',
      targetId: testRunId,
      metadata: { attempts: job.attemptsMade, reason: String(err) },
    });
  }
});

testRunQueue.on('error', (err) => logger.error({ err }, 'test-run queue error'));
testRunDlq.on('error', (err) => logger.error({ err }, 'test-run DLQ error'));

/**
 * Idempotent enqueue helper. Uses a deterministic Bull jobId so a retry of
 * the same triggering API call doesn't double-enqueue. Caller still creates
 * the TestRun row before this; this just guards the queue side.
 */
export async function enqueueTestRun(data: TestRunJobData): Promise<void> {
  await testRunQueue.add(data, {
    jobId: `testrun:${data.testRunId}`, // Bull dedupes by jobId
  });
}
