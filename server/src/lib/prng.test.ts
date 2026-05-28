import { describe, it, expect } from 'vitest';
import { prngFromSeed, freshSeed } from './prng';

describe('prng', () => {
  it('produces a sequence determined by the seed', () => {
    const a = prngFromSeed('cafe');
    const b = prngFromSeed('cafe');
    const aSeq = Array.from({ length: 20 }, () => a.next());
    const bSeq = Array.from({ length: 20 }, () => b.next());
    expect(aSeq).toEqual(bSeq);
  });

  it('produces different sequences for different seeds', () => {
    const a = prngFromSeed('cafe');
    const b = prngFromSeed('dead');
    expect(a.next()).not.toBe(b.next());
  });

  it('next() stays in [0, 1)', () => {
    const r = prngFromSeed('test');
    for (let i = 0; i < 10_000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int(min,max) stays in [min,max)', () => {
    const r = prngFromSeed('test');
    for (let i = 0; i < 5_000; i++) {
      const v = r.int(-10, 10);
      expect(v).toBeGreaterThanOrEqual(-10);
      expect(v).toBeLessThan(10);
    }
  });

  it('pick distributes across the array', () => {
    const r = prngFromSeed('dist');
    const counts = new Map<string, number>();
    const arr = ['a', 'b', 'c', 'd', 'e'];
    for (let i = 0; i < 5000; i++) {
      const v = r.pick(arr);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    // Each bucket should be roughly 1000 ± reasonable jitter (chi-square-ish).
    for (const v of arr) {
      const c = counts.get(v) ?? 0;
      expect(c).toBeGreaterThan(800);
      expect(c).toBeLessThan(1200);
    }
  });

  it('shuffle is a permutation (multiset-preserving)', () => {
    const r = prngFromSeed('shuf');
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    for (let i = 0; i < 100; i++) {
      const out = r.shuffle(arr);
      expect(out.slice().sort()).toEqual(arr);
      expect(out.length).toBe(arr.length);
    }
  });

  it('sample(k) returns k distinct elements', () => {
    const r = prngFromSeed('samp');
    const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const k = 5;
    for (let i = 0; i < 50; i++) {
      const out = r.sample(arr, k);
      expect(out.length).toBe(k);
      expect(new Set(out).size).toBe(k);     // distinct
      out.forEach((x) => expect(arr).toContain(x));
    }
  });

  it('fork produces a different but deterministic child stream', () => {
    const a = prngFromSeed('parent');
    const b = prngFromSeed('parent');
    const childA = a.fork('child');
    const childB = b.fork('child');
    expect(childA.next()).toBe(childB.next());
    // child stream is different from parent
    const a2 = prngFromSeed('parent');
    expect(a2.fork('child').next()).not.toBe(a2.next());
  });

  it('freshSeed returns a 16-char hex string', () => {
    const s = freshSeed();
    expect(s).toMatch(/^[0-9a-f]{16}$/);
  });

  it('rejects bad arguments', () => {
    const r = prngFromSeed('x');
    expect(() => r.int(0, 0)).toThrow();
    expect(() => r.int(10, 0)).toThrow();
    expect(() => r.pick([])).toThrow();
    expect(() => r.sample([1, 2], 5)).toThrow();
  });
});
