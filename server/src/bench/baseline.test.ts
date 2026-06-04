import { describe, it, expect } from 'vitest';
import { computeBaselineMetrics } from './baseline';
import labeled from './labeled-set/eval-cases.seed.json';

describe('baseline metrics', () => {
  it('reports the four required baselines', async () => {
    const m = await computeBaselineMetrics({ labeled: labeled.cases as any, skipNetwork: true });
    expect(typeof m.evalF1Baseline).toBe('number');
    expect(typeof m.concentrationBaseline).toBe('number');
    expect(typeof m.runP95MsBaseline).toBe('number');
    expect(typeof m.queueThroughputBaseline).toBe('number');
  });

  it('evalF1Baseline is in [0,1]', async () => {
    const m = await computeBaselineMetrics({ labeled: labeled.cases as any, skipNetwork: true });
    expect(m.evalF1Baseline).toBeGreaterThanOrEqual(0);
    expect(m.evalF1Baseline).toBeLessThanOrEqual(1);
  });
});
