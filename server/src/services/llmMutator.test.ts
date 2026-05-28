/**
 * v2.2 — Unit tests for the LLM mutator's deterministic fallback escalation.
 * The real LLM-call path is exercised by the bench script + integration runs;
 * here we only verify the fallback that runs when the LLM is unavailable.
 */
import { describe, it, expect } from 'vitest';
import { fallbackEscalate } from './llmMutator';
import { prngFromSeed } from '../lib/prng';

// Small representative slug sets — the real registry has 19 + 13, but the
// fallback only cares about presence/absence not the full inventory.
const ENC = ['encoding.base64', 'encoding.hex', 'encoding.rot13', 'encoding.leetspeak'];
const FRM = ['framing.citation', 'framing.dan_jailbreak', 'framing.refusal_suppression'];

describe('llmMutator.fallbackEscalate', () => {
  it('raw chain → adds one encoding', () => {
    const prng = prngFromSeed('seed1');
    const next = fallbackEscalate([], ENC, FRM, prng);
    expect(next).toHaveLength(1);
    expect(ENC).toContain(next[0]);
  });

  it('encoding-only chain → appends a framing', () => {
    const prng = prngFromSeed('seed2');
    const prior = ['encoding.base64'];
    const next = fallbackEscalate(prior, ENC, FRM, prng);
    expect(next).toHaveLength(2);
    expect(next[0]).toBe('encoding.base64');
    expect(FRM).toContain(next[1]);
  });

  it('encoding+framing → swaps the encoding for a different one', () => {
    const prng = prngFromSeed('seed3');
    const prior = ['encoding.base64', 'framing.dan_jailbreak'];
    const next = fallbackEscalate(prior, ENC, FRM, prng);
    expect(next).toHaveLength(2);
    expect(next[1]).toBe('framing.dan_jailbreak'); // framing preserved
    expect(next[0]).not.toBe('encoding.base64');
    expect(ENC).toContain(next[0]);
  });

  it('framing-only chain → prepends an encoding', () => {
    const prng = prngFromSeed('seed4');
    const prior = ['framing.citation'];
    const next = fallbackEscalate(prior, ENC, FRM, prng);
    expect(next.length).toBeGreaterThanOrEqual(2);
    expect(ENC).toContain(next[0]);
    expect(next).toContain('framing.citation');
  });

  it('is deterministic for a given seed', () => {
    const a = fallbackEscalate([], ENC, FRM, prngFromSeed('deterministic'));
    const b = fallbackEscalate([], ENC, FRM, prngFromSeed('deterministic'));
    expect(a).toEqual(b);
  });
});
