import { describe, it, expect } from 'vitest';
import { relevanceConcentration } from './relevanceMetrics';

describe('relevanceConcentration (alias-aware)', () => {
  it('counts cases whose category bridges to an agent risk category (via the alias map)', () => {
    // "Information Hazards" bridges to SENSITIVE_DATA_DISCLOSURE through the alias
    // map even though they share no first-token — the metric must see that.
    const cases = [
      { category: 'Information Hazards' },
      { category: 'Information Hazards' },
      { category: 'chemical_biological' },
      { category: 'copyright' },
    ];
    const share = relevanceConcentration(cases, ['SENSITIVE_DATA_DISCLOSURE']);
    expect(share).toBeCloseTo(2 / 4); // 2 info-hazard cases bridge; chem/bio + copyright don't
  });

  it('still matches direct token overlap (no alias needed)', () => {
    const cases = [{ category: 'data_exfil' }, { category: 'toxicity' }];
    expect(relevanceConcentration(cases, ['DATA_EXFILTRATION'])).toBeCloseTo(1 / 2);
  });

  it('returns 0 for an empty suite', () => {
    expect(relevanceConcentration([], ['SENSITIVE_DATA_DISCLOSURE'])).toBe(0);
  });

  it('returns 0 when no agent risk categories are given', () => {
    expect(relevanceConcentration([{ category: 'Information Hazards' }], [])).toBe(0);
  });
});
