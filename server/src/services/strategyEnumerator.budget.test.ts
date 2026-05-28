import { describe, it, expect } from 'vitest';
import { enumerateTestCases } from './strategyEnumerator';
import type { Probe } from '@prisma/client';
import type { ProbeBudget } from './relevance';

function probe(slug: string): Probe {
  return {
    id: slug, slug, source: 'cortexview', version: 1, category: 'jailbreak', subcategory: null,
    severity: 'high', title: slug, description: 'd', seedPayload: 'payload',
    expectedFailIndicators: [], expectedPassIndicators: [], applicability: [], defaultDetectorIds: [],
    defaultStrategies: [], enabled: true, metadata: null, createdAt: new Date(), updatedAt: new Date(),
  } as unknown as Probe;
}
async function* stream(): AsyncGenerator<Probe> { yield probe('p.high'); yield probe('p.low'); }
async function collect(opts: Parameters<typeof enumerateTestCases>[0]) {
  const out: string[] = []; for await (const ec of enumerateTestCases(opts)) out.push(ec.externalId); return out;
}

describe('enumerateTestCases with per-probe budgets', () => {
  it('expands the high-budget probe more than the low-budget (raw-only) probe', async () => {
    const probeBudgets = new Map<string, ProbeBudget>([
      ['p.high', { tier: 'high', maxChainDepth: 2, strategyFamilies: ['encoding', 'framing'] }],
      ['p.low',  { tier: 'low',  maxChainDepth: 0, strategyFamilies: [] }],
    ]);
    const ids = await collect({ probeStream: stream(), probeBudgets });
    const high = ids.filter((i) => i.startsWith('tc.p.high')).length;
    const low = ids.filter((i) => i.startsWith('tc.p.low')).length;
    expect(low).toBe(1);            // raw only — coverage floor
    expect(high).toBeGreaterThan(low);
  });

  it('falls back to global chainDepth when no budgets are given', async () => {
    const ids = await collect({ probeStream: stream(), chainDepth: 0 });
    expect(ids.length).toBe(2);     // raw-only for both (depth 0), unchanged behavior
  });
});
