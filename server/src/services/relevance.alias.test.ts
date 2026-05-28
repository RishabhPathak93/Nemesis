import { describe, it, expect } from 'vitest';
import { categoryMatch, RELEVANCE_CONFIG, scoreProbeRelevance, allocateBudget, type ProbeSignal, type RelevanceInput } from './relevance';
import type { AgentUnderstanding } from './claude/understandingTypes';

describe('alias-aware categoryMatch', () => {
  it('bridges a security-taxonomy category to harm-dataset probe vocab', () => {
    // The catalog is dominated by harm-dataset categories; the agent speaks the
    // security taxonomy. The alias map must connect them.
    expect(categoryMatch('Information Hazards', 'SENSITIVE_DATA_DISCLOSURE')).toBeGreaterThanOrEqual(0.8);
    expect(categoryMatch('Human-Chatbot Interaction Harms', 'SOCIAL_ENGINEERING')).toBeGreaterThanOrEqual(0.8);
    expect(categoryMatch('prompt_injection', 'SYSTEM_PROMPT_EXTRACTION')).toBeGreaterThanOrEqual(0.8);
  });

  it('does NOT bridge unrelated categories', () => {
    // A support bot worried about data disclosure should not light up chem/bio probes.
    expect(categoryMatch('chemical_biological', 'SENSITIVE_DATA_DISCLOSURE')).toBe(0);
    expect(categoryMatch('copyright', 'SOCIAL_ENGINEERING')).toBe(0);
  });

  it('falls back to token affinity for categories with no alias entry', () => {
    // "pii leakage" is a free-text recommended_focus_area, not a taxonomy key.
    expect(categoryMatch('data_exfil', 'data_exfiltration')).toBeGreaterThan(0.4); // token-prefix path still works
  });
});

describe('tuned tier thresholds', () => {
  it('exposes env-backed thresholds with a smoother default gradient', () => {
    expect(RELEVANCE_CONFIG.tierThresholds.high).toBeLessThanOrEqual(0.55);
    expect(RELEVANCE_CONFIG.tierThresholds.med).toBeLessThanOrEqual(0.30);
    expect(RELEVANCE_CONFIG.tierThresholds.high).toBeGreaterThan(RELEVANCE_CONFIG.tierThresholds.med);
  });
});

describe('end-to-end: alias map lifts relevant harm-dataset probes off the floor', () => {
  const understanding: AgentUnderstanding = {
    summary: 'support bot', attack_surfaces: ['chat'],
    risk_categories: ['SENSITIVE_DATA_DISCLOSURE', 'SOCIAL_ENGINEERING'],
    recommended_focus_areas: [], risk_rationale: 'handles PII',
    source: 'interactive',
  };
  const input: RelevanceInput = { understanding, agentType: 'chatbot', sensitiveDataScope: ['pii'], categoryEffectiveness: new Map() };
  const probes: ProbeSignal[] = [
    { slug: 'p.infohaz', category: 'Information Hazards', severity: 'high', applicability: [] },
    { slug: 'p.human',   category: 'Human-Chatbot Interaction Harms', severity: 'medium', applicability: [] },
    { slug: 'p.chembio', category: 'chemical_biological', severity: 'high', applicability: [] },
  ];

  it('puts relevant harm-dataset probes above the raw floor, leaves irrelevant ones at floor', () => {
    const budgets = allocateBudget(scoreProbeRelevance(probes, input));
    expect(budgets.get('p.infohaz')!.tier).not.toBe('low'); // lifted by alias bridge
    expect(budgets.get('p.chembio')!.tier).toBe('low');      // unrelated → raw floor
  });
});
