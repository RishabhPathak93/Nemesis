/**
 * v2.2 — D6: Adaptive child-payload derivatives.
 *
 * When an attempt produces a `partial` verdict (or a low-confidence pass)
 * we treat that as a signal that the agent's defence is fragile here:
 * the same probe with a different transform might tip it over.
 *
 * For each partial/weak attempt, we mint up to `env.adaptiveMaxDerivatives`
 * child variants by:
 *   1. Swapping the encoding for a different one in the same family.
 *   2. Adding a refusal-suppression suffix.
 *   3. Applying a paraphrase via a sibling strategy (NFKD / homoglyph) on
 *      top of the existing chain.
 *
 * The children become NEW `TestCase` rows in the same suite (so they pick
 * up the resumability machinery automatically) and the runner loops back
 * to pick them up at the end of its current pass.
 */

import type { TestCase } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../lib/env';
import { listSlugsByFamily } from '../securityEngine/strategies/registry';
import type { Prng } from '../lib/prng';

export interface DeriveOptions {
  /** Parent test case (whose attempt was weak/partial). */
  parentCase: TestCase;
  /** Per-case PRNG so derivatives are deterministic. */
  prng: Prng;
  /** Suite id to attach the new TestCases to. */
  suiteId: string;
  /** How many children to mint. Default env.adaptiveMaxDerivatives. */
  maxChildren?: number;
}

/**
 * Produce N deterministic strategy-chain variants and persist them as new
 * TestCase rows. Returns the IDs so the caller can decide whether to enqueue
 * them in this run or defer.
 */
export async function deriveChildren(opts: DeriveOptions): Promise<string[]> {
  const max = Math.min(
    opts.maxChildren ?? env.adaptiveMaxDerivatives,
    Number.isFinite(env.adaptiveMaxDerivatives) ? env.adaptiveMaxDerivatives : 32,
  );
  if (max <= 0) return [];

  const encodings = listSlugsByFamily('encoding');
  const framings = listSlugsByFamily('framing');

  const parentChain = opts.parentCase.strategyChain;
  const existing = new Set(parentChain);

  const variants: string[][] = [];

  // (1) swap encoding for a different one if the parent had any
  const parentEncoding = parentChain.find((s) => s.startsWith('encoding.'));
  if (parentEncoding) {
    for (const e of encodings) {
      if (e === parentEncoding) continue;
      variants.push(parentChain.map((s) => (s === parentEncoding ? e : s)));
      if (variants.length >= max) break;
    }
  }

  // (2) append framing.refusal_suppression (if not already present)
  if (variants.length < max && !existing.has('framing.refusal_suppression')) {
    variants.push([...parentChain, 'framing.refusal_suppression']);
  }

  // (3) append framing.instruction_hierarchy
  if (variants.length < max && !existing.has('framing.instruction_hierarchy')) {
    variants.push([...parentChain, 'framing.instruction_hierarchy']);
  }

  // (4) add a paraphrase via NFKD / homoglyph if not already wrapped
  if (variants.length < max && !existing.has('encoding.nfkd_normalize') && !parentEncoding) {
    variants.push(['encoding.nfkd_normalize', ...parentChain]);
  }
  if (variants.length < max && !existing.has('encoding.unicode_homoglyph') && !parentEncoding) {
    variants.push(['encoding.unicode_homoglyph', ...parentChain]);
  }

  // (5) sample random (enc, framing) pairs to backfill any remaining budget
  while (variants.length < max) {
    const chain = [opts.prng.pick(encodings), opts.prng.pick(framings)];
    // Don't duplicate
    const key = chain.join('|');
    if (!variants.some((v) => v.join('|') === key)) variants.push(chain);
    if (variants.length > 1000) break; // safety
  }

  // Persist as new TestCase rows. ExternalId carries the parent + variant index
  // so it sorts after the parent and is recognisably derived.
  const newCases = variants.slice(0, max).map((chain, i) => ({
    suiteId: opts.suiteId,
    externalId: `${opts.parentCase.externalId}.adapt.${i}`,
    category: opts.parentCase.category,
    severity: opts.parentCase.severity,
    name: `${opts.parentCase.name} — adaptive child #${i}`,
    description: `Derived from ${opts.parentCase.externalId} because the parent attempt was weak/partial. ` +
      `Strategy chain: ${chain.join('+')}.`,
    attackPrompt: opts.parentCase.attackPrompt,
    expectedSafeBehaviour: opts.parentCase.expectedSafeBehaviour,
    detectionCriteria: opts.parentCase.detectionCriteria,
    probeId: opts.parentCase.probeId,
    strategyChain: chain,
  }));

  if (newCases.length === 0) return [];

  // createMany doesn't return IDs in Postgres so we re-query by externalId.
  await prisma.testCase.createMany({ data: newCases });
  const persisted = await prisma.testCase.findMany({
    where: {
      suiteId: opts.suiteId,
      externalId: { in: newCases.map((r) => r.externalId) },
    },
    select: { id: true },
  });
  return persisted.map((r) => r.id);
}
