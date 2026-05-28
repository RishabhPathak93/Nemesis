import { describe, it, expect } from 'vitest';
import { applyCategoryWeights, scoreProbeRelevance, type ProbeSignal, type RelevanceInput } from './relevance';

const probes: ProbeSignal[] = [
  { slug: 'p.exfil', category: 'data_exfil', severity: 'high', applicability: ['chatbot'] },
  { slug: 'p.tox',   category: 'toxicity',   severity: 'high', applicability: ['chatbot'] },
];
const input: RelevanceInput = {
  understanding: { summary: 's', attack_surfaces: [], risk_categories: ['DATA_EXFILTRATION','TOXICITY'], recommended_focus_areas: [], risk_rationale: '' },
  agentType: 'chatbot', sensitiveDataScope: [], categoryEffectiveness: new Map(),
};

describe('applyCategoryWeights', () => {
  it('boosts probes whose normalized category matches a high-weight key', () => {
    const base = scoreProbeRelevance(probes, input);
    const weighted = applyCategoryWeights(base, probes, new Map([['data', 1.5], ['toxicity', 0.5]]));
    expect(weighted.get('p.exfil')!).toBeGreaterThan(weighted.get('p.tox')!);
    for (const v of weighted.values()) { expect(v).toBeLessThanOrEqual(1); expect(v).toBeGreaterThanOrEqual(0); }
  });

  it('is a no-op when weights are empty', () => {
    const base = scoreProbeRelevance(probes, input);
    expect([...applyCategoryWeights(base, probes, new Map()).entries()]).toEqual([...base.entries()]);
  });
});
