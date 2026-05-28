import { describe, it, expect } from 'vitest';
import { RELEVANCE_CONFIG, normalizeCategory, categoryAffinity } from './relevance';

describe('relevance config + category normalization', () => {
  it('exposes weights, tier thresholds, and the rerank flag', () => {
    expect(RELEVANCE_CONFIG.weights.category).toBeGreaterThan(0);
    expect(RELEVANCE_CONFIG.tierThresholds.high).toBeGreaterThan(RELEVANCE_CONFIG.tierThresholds.med);
    expect(typeof RELEVANCE_CONFIG.llmRerankEnabled).toBe('boolean');
  });

  it('normalizes category casing/punctuation to lowercase tokens', () => {
    expect(normalizeCategory('PROMPT_INJECTION')).toEqual(['prompt', 'injection']);
    expect(normalizeCategory('data_exfil')).toEqual(['data', 'exfil']);
  });

  it('scores affinity high for prefix-matching tokens (exfil ~ exfiltration)', () => {
    expect(categoryAffinity('data_exfil', 'DATA_EXFILTRATION')).toBeGreaterThan(0.5);
    expect(categoryAffinity('toxicity', 'PROMPT_INJECTION')).toBe(0);
  });
});
