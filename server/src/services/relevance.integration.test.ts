import { describe, it, expect } from 'vitest';
import { buildProbeBudgets, type ProbeSignal, type RelevanceInput } from './relevance';
import type { AgentUnderstanding } from './claude/understandingTypes';

const probes: ProbeSignal[] = [
  { slug: 'x.data_exfil.1', category: 'data_exfil', severity: 'high', applicability: ['chatbot'] },
  { slug: 'x.toxicity.1',   category: 'toxicity',   severity: 'low',  applicability: ['chatbot'] },
];
const understanding: AgentUnderstanding = {
  summary: 's', attack_surfaces: ['chat'], risk_categories: ['DATA_EXFILTRATION'],
  recommended_focus_areas: [], risk_rationale: '',
  probe_reactions: [{ type: 'DATA_EXFILTRATION', what_happened: 'leak', severity_hint: 'high' }],
  source: 'interactive',
};
const input: RelevanceInput = { understanding, agentType: 'chatbot', sensitiveDataScope: ['pii'], categoryEffectiveness: new Map() };

describe('buildProbeBudgets', () => {
  it('gives the relevant probe a richer budget than the irrelevant one', () => {
    const budgets = buildProbeBudgets(probes, input);
    expect(budgets.get('x.data_exfil.1')!.maxChainDepth).toBeGreaterThan(budgets.get('x.toxicity.1')!.maxChainDepth);
    expect(budgets.get('x.toxicity.1')!.tier).toBe('low');
  });
});
