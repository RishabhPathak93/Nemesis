import { createHash, randomBytes } from 'node:crypto';

/**
 * Deterministic PRNG for the scan path (D2).
 *
 * Every random decision inside an executing scan — payload sampling,
 * adaptive-child mutation choice, suffix-corpus selection, anything
 * else — MUST route through here. The PRNG is seeded from
 * `TestRun.seed` so a scan is reproducible: replay it with the same
 * seed and you get the same payloads, the same dispatch order, the
 * same adaptive derivatives.
 *
 * Implementation is xoshiro128** — a small, fast, well-tested algorithm
 * with excellent statistical properties. We're NOT trying to be
 * cryptographically secure (use `crypto.randomBytes` for that); we just
 * need quality + determinism + speed.
 *
 * Why not Math.random()? Because Node doesn't let you seed it. And
 * we definitely don't want adversarial-testing reproducibility to
 * depend on engine implementation details.
 */

export interface Prng {
  /** Uniform double in [0, 1). */
  next(): number;
  /** Uniform integer in [min, maxExclusive). */
  int(min: number, maxExclusive: number): number;
  /** Pick one element of a non-empty array. */
  pick<T>(arr: readonly T[]): T;
  /** Fisher-Yates shuffle (returns a new array; original untouched). */
  shuffle<T>(arr: readonly T[]): T[];
  /** Pick k distinct elements (k <= arr.length). */
  sample<T>(arr: readonly T[], k: number): T[];
  /** Return true with probability p. */
  bool(p: number): boolean;
  /** Fork a child PRNG with a derived seed (useful for parallel sub-streams). */
  fork(label: string): Prng;
}

/** Hash an arbitrary string to a 128-bit seed (4 × 32-bit words). */
function seedFromString(s: string): [number, number, number, number] {
  const h = createHash('sha256').update(s).digest();
  // First 16 bytes → 4 × uint32 (little-endian).
  return [h.readUInt32LE(0), h.readUInt32LE(4), h.readUInt32LE(8), h.readUInt32LE(12)];
}

/** Generate a fresh 64-bit hex seed string. Use at TestRun.create time. */
export function freshSeed(): string {
  return randomBytes(8).toString('hex'); // 16 hex chars = 64 bits
}

/** Build a PRNG from a hex seed string (or any string — we'll hash it). */
export function prngFromSeed(seed: string): Prng {
  const initial = seedFromString(seed || freshSeed());
  return makePrng(initial[0], initial[1], initial[2], initial[3], seed);
}

function makePrng(s0: number, s1: number, s2: number, s3: number, label: string): Prng {
  // xoshiro128** state. uint32-mod arithmetic by ANDing with >>> 0.
  let a = s0 >>> 0;
  let b = s1 >>> 0;
  let c = s2 >>> 0;
  let d = s3 >>> 0;

  function rotl(x: number, k: number): number {
    return ((x << k) | (x >>> (32 - k))) >>> 0;
  }

  function nextU32(): number {
    const result = (Math.imul(rotl(Math.imul(b, 5) >>> 0, 7), 9) >>> 0);
    const t = (b << 9) >>> 0;
    c = (c ^ a) >>> 0;
    d = (d ^ b) >>> 0;
    b = (b ^ c) >>> 0;
    a = (a ^ d) >>> 0;
    c = (c ^ t) >>> 0;
    d = rotl(d, 11);
    return result;
  }

  function next(): number {
    // Mix two uint32s into a double in [0,1) (53 bits of mantissa).
    const hi = nextU32() >>> 6;       // 26 bits
    const lo = nextU32() >>> 5;       // 27 bits
    return (hi * 0x8000000 + lo) / 0x20000000000000;
  }

  function int(min: number, maxExclusive: number): number {
    if (!Number.isFinite(min) || !Number.isFinite(maxExclusive)) {
      throw new RangeError(`prng.int needs finite bounds; got [${min}, ${maxExclusive})`);
    }
    if (maxExclusive <= min) {
      throw new RangeError(`prng.int needs max > min; got [${min}, ${maxExclusive})`);
    }
    return min + Math.floor(next() * (maxExclusive - min));
  }

  function pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new RangeError('prng.pick on empty array');
    return arr[int(0, arr.length)];
  }

  function shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function sample<T>(arr: readonly T[], k: number): T[] {
    if (k < 0 || k > arr.length) {
      throw new RangeError(`prng.sample needs 0 <= k <= length; got k=${k}, length=${arr.length}`);
    }
    return shuffle(arr).slice(0, k);
  }

  function bool(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return next() < p;
  }

  function fork(child: string): Prng {
    return prngFromSeed(`${label}::${child}`);
  }

  return { next, int, pick, shuffle, sample, bool, fork };
}
