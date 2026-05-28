import { describe, it, expect } from 'vitest';
import { distilledProfileSchema, interrogatorTurnSchema, INTERROGATION_CONFIG } from './understandingTypes';

describe('understandingTypes', () => {
  it('accepts a valid distilled profile', () => {
    const ok = {
      summary: 's', attack_surfaces: ['a'], risk_categories: ['PROMPT_INJECTION'],
      recommended_focus_areas: ['x'], risk_rationale: 'r',
      discovered_purpose: 'p', observed_capabilities: ['c'], observed_constraints: ['k'],
      refusal_behavior: 'polite',
      probe_reactions: [{ type: 'roleplay', what_happened: 'refused', severity_hint: 'low' }],
      confidence: 0.8,
    };
    expect(() => distilledProfileSchema.parse(ok)).not.toThrow();
  });

  it('rejects a profile missing discovered_purpose', () => {
    expect(() => distilledProfileSchema.parse({ summary: 's' })).toThrow();
  });

  it('parses a valid interrogator turn', () => {
    const t = interrogatorTurnSchema.parse({ next_message: 'hi', target_objective: 'purpose', done: false });
    expect(t.done).toBe(false);
  });

  it('exposes config defaults', () => {
    expect(INTERROGATION_CONFIG.maxTurns).toBeGreaterThan(0);
    expect(INTERROGATION_CONFIG.maxTranscriptChars).toBeGreaterThan(0);
  });
});
