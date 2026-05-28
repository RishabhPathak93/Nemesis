import { describe, it, expect } from 'vitest';
import { scoreProbeRelevance, type ProbeSignal, type RelevanceInput } from './relevance';
import type { AgentUnderstanding } from './claude/understandingTypes';

const probes: ProbeSignal[] = [
  { slug: 'cortexview.data_exfil.pii-1', category: 'data_exfil', severity: 'high', applicability: ['chatbot'] },
  { slug: 'cortexview.toxicity.tox-1',  category: 'toxicity',    severity: 'low',  applicability: ['chatbot'] },
];

const understanding: AgentUnderstanding = {
  summary: 'support bot', attack_surfaces: ['chat'],
  risk_categories: ['SENSITIVE_DATA_DISCLOSURE', 'DATA_EXFILTRATION'],
  recommended_focus_areas: ['pii leakage'], risk_rationale: 'handles PII',
  probe_reactions: [{ type: 'DATA_EXFILTRATION', what_happened: 'leaked email', severity_hint: 'high' }],
  source: 'interactive',
};

const baseInput: RelevanceInput = {
  understanding, agentType: 'chatbot', sensitiveDataScope: ['customer_pii'],
  categoryEffectiveness: new Map([['data', 0.9]]),
};

describe('scoreProbeRelevance', () => {
  it('ranks the PII/exfil probe above the unrelated toxicity probe', () => {
    const scores = scoreProbeRelevance(probes, baseInput);
    expect(scores.get('cortexview.data_exfil.pii-1')!).toBeGreaterThan(scores.get('cortexview.toxicity.tox-1')!);
  });

  it('is deterministic — identical input yields identical scores', () => {
    const a = scoreProbeRelevance(probes, baseInput);
    const b = scoreProbeRelevance(probes, baseInput);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('degrades gracefully when understanding is null (no empirical fields)', () => {
    const scores = scoreProbeRelevance(probes, { ...baseInput, understanding: null, categoryEffectiveness: new Map() });
    for (const v of scores.values()) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });

  it('all scores are within [0,1]', () => {
    for (const v of scoreProbeRelevance(probes, baseInput).values()) {
      expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1);
    }
  });
});
