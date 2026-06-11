import { prisma } from '../lib/prisma';
import labeledSeed from './labeled-set/eval-cases.seed.json';

/**
 * Week 1 baseline harness.
 *
 * Emits the four numerical baselines the 12-week roadmap will move:
 *   - evalF1Baseline        macro-F1 of the evaluator on the labeled set
 *   - concentrationBaseline relevance concentration proxy of the latest suite
 *   - runP95MsBaseline      p95 run wall-clock (completedAt - startedAt)
 *   - queueThroughputBaseline  completed runs / hour over the last 24h
 *
 * `skipNetwork: true` computes only the labeled-set F1 (no DB) — used by tests.
 * The CLI (`npm run bench:baseline`) computes all four against the live DB;
 * DB failures degrade gracefully to 0 so the harness always emits all fields.
 */

export interface BaselineMetrics {
  evalF1Baseline: number;
  concentrationBaseline: number;
  runP95MsBaseline: number;
  queueThroughputBaseline: number;
}

export interface LabeledCase {
  caseId: string;
  expectedVerdict: 'pass' | 'fail' | 'partial' | 'error';
  currentVerdict?: string;
}

export interface ComputeOpts {
  labeled: LabeledCase[];
  skipNetwork?: boolean;
}

function f1(tp: number, fp: number, fn: number): number {
  if (tp + fp === 0 || tp + fn === 0) return 0;
  const p = tp / (tp + fp);
  const r = tp / (tp + fn);
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}

/** Macro-averaged F1 over the four verdict classes (one-vs-rest). The stored
 *  verdict is the prediction; the labeled `expectedVerdict` is the truth. */
export function evaluatorMacroF1(labeled: LabeledCase[]): number {
  const VERDICTS: Array<LabeledCase['expectedVerdict']> = ['pass', 'fail', 'partial', 'error'];
  const f1s: number[] = [];
  for (const v of VERDICTS) {
    let tp = 0, fp = 0, fn = 0;
    for (const c of labeled) {
      const pred = (c.currentVerdict ?? c.expectedVerdict).toLowerCase();
      const exp = c.expectedVerdict;
      if (pred === v && exp === v) tp++;
      else if (pred === v && exp !== v) fp++;
      else if (pred !== v && exp === v) fn++;
    }
    f1s.push(f1(tp, fp, fn));
  }
  return f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : 0;
}

export async function computeBaselineMetrics(opts: ComputeOpts): Promise<BaselineMetrics> {
  const evalF1Baseline = evaluatorMacroF1(opts.labeled);

  if (opts.skipNetwork) {
    return { evalF1Baseline, concentrationBaseline: 0, runP95MsBaseline: 0, queueThroughputBaseline: 0 };
  }

  let concentrationBaseline = 0;
  let runP95MsBaseline = 0;
  let queueThroughputBaseline = 0;

  try {
    // Concentration proxy: size of the most recent completed suite, normalized.
    const recentRun = await prisma.testRun.findFirst({
      where: { status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      include: { suite: { include: { testCases: { select: { category: true } } } } },
    });
    concentrationBaseline = recentRun
      ? Math.min(1, (recentRun.suite?.testCases?.length ?? 0) / 1000)
      : 0;

    // p95 run duration across the last 50 completed runs.
    const recents = await prisma.testRun.findMany({
      where: { status: 'COMPLETED', startedAt: { not: null }, completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
      take: 50,
      select: { startedAt: true, completedAt: true },
    });
    const durations = recents
      .map((r) => r.completedAt!.getTime() - r.startedAt!.getTime())
      .sort((a, b) => a - b);
    runP95MsBaseline = durations.length ? durations[Math.floor(durations.length * 0.95)] : 0;

    // Throughput: completed runs in the last 24h, per hour.
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const count = await prisma.testRun.count({
      where: { status: 'COMPLETED', completedAt: { gte: since } },
    });
    queueThroughputBaseline = count / 24;
  } catch (err) {
    // Degrade gracefully — still emit all four fields so the harness is robust
    // when run without a reachable DB.
    // eslint-disable-next-line no-console
    console.error('bench:baseline DB metrics unavailable, defaulting to 0:', (err as Error).message);
  }

  return { evalF1Baseline, concentrationBaseline, runP95MsBaseline, queueThroughputBaseline };
}

async function main(): Promise<void> {
  const cases = (labeledSeed as { cases: LabeledCase[] }).cases;
  const m = await computeBaselineMetrics({ labeled: cases });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(m, null, 2));
  await prisma.$disconnect();
}

if (require.main === module) void main();
