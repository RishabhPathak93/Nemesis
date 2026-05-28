import { describe, it, expect } from 'vitest';
import { allocateBudget } from './relevance';

describe('allocateBudget', () => {
  const scores = new Map([['p.high', 0.9], ['p.med', 0.5], ['p.low', 0.1]]);

  it('assigns tiers by threshold', () => {
    const b = allocateBudget(scores);
    expect(b.get('p.high')!.tier).toBe('high');
    expect(b.get('p.med')!.tier).toBe('med');
    expect(b.get('p.low')!.tier).toBe('low');
  });

  it('preserves the coverage floor — even low tier keeps the raw case (depth 0, no drop)', () => {
    const b = allocateBudget(scores);
    expect(b.get('p.low')!.maxChainDepth).toBe(0);
    expect(b.has('p.low')).toBe(true);
  });

  it('gives high tier more depth than med than low', () => {
    const b = allocateBudget(scores);
    expect(b.get('p.high')!.maxChainDepth).toBeGreaterThan(b.get('p.med')!.maxChainDepth);
    expect(b.get('p.med')!.maxChainDepth).toBeGreaterThanOrEqual(b.get('p.low')!.maxChainDepth);
  });

  it('every scored probe gets a budget (nothing dropped)', () => {
    expect(allocateBudget(scores).size).toBe(scores.size);
  });
});
