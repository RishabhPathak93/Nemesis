import { describe, it, expect } from 'vitest';
import { relevanceConcentration } from './relevanceMetrics';

describe('relevanceConcentration', () => {
  it('computes the share of cases in the agent top categories', () => {
    const cases = [
      { category: 'data_exfil' }, { category: 'data_exfil' }, { category: 'toxicity' }, { category: 'jailbreak' },
    ];
    const share = relevanceConcentration(cases, ['data', 'jailbreak']);
    expect(share).toBeCloseTo(3 / 4);
  });

  it('returns 0 for an empty suite', () => {
    expect(relevanceConcentration([], ['data'])).toBe(0);
  });
});
