import { describe, it, expect } from 'vitest';
import { formatProbeCatalog } from './testGeneration';

describe('formatProbeCatalog', () => {
  const probes = [
    { slug: 'a.low', category: 'toxicity', severity: 'low', title: 'Low one' },
    { slug: 'b.high', category: 'data_exfil', severity: 'high', title: 'High one' },
  ];
  const scores = new Map([['a.low', 0.1], ['b.high', 0.9]]);

  it('orders the catalog by descending relevance score and tags the tier', () => {
    const text = formatProbeCatalog(probes, scores);
    expect(text.indexOf('b.high')).toBeLessThan(text.indexOf('a.low')); // relevant first
    expect(text).toMatch(/high.*b\.high/s);
  });

  it('works with an empty score map (original order, no tags crash)', () => {
    expect(() => formatProbeCatalog(probes, new Map())).not.toThrow();
  });
});
