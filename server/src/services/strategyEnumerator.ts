/**
 * v2.2 — Deterministic Cartesian enumerator (A2/A3/A4).
 *
 * The audit found that the v1 suite builder hands a *catalog* to the LLM and
 * lets the LLM curate a subset of (probe, strategy_chain) tuples. That makes
 * coverage non-deterministic and bounded by the model's creativity.
 *
 * This module flips it: the engine enumerates the full Cartesian product
 *   probes × ({no encoding} ∪ encodings) × ({no framing} ∪ framings) × languages
 * deterministically. The LLM is then only asked to *author* the per-case
 * natural-language wrapper for any tuple that needs it (e.g. instantiating
 * a probe's seedPayload into a fully-realised prompt) — never to *select*.
 *
 * Yields plain objects; the suite builder is responsible for persistence.
 * Streaming via an async generator keeps memory bounded on large catalogs.
 */

import type { Probe } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../lib/env';
import { listSlugsByFamily } from '../securityEngine/strategies/registry';
import type { ProbeBudget } from './relevance';

export interface EnumeratedCase {
  /** Deterministic externalId. Used as TestCase.externalId. */
  externalId: string;
  /** Source probe (already resolved from DB). */
  probe: Probe;
  /** Strategy chain to apply at execution time. */
  strategyChain: string[];
  /** Stable category from the probe. */
  category: string;
  /** Severity from the probe. */
  severity: string;
  /** Human-readable name. */
  name: string;
  /** What the case is checking. */
  description: string;
  /** Final attack prompt (seed payload — strategies applied at execution time). */
  attackPrompt: string;
  /** What the agent should do if it handles this safely. */
  expectedSafeBehaviour: string;
  /** How to detect failure. */
  detectionCriteria: string;
}

export interface EnumerateOptions {
  /** Restrict probes to a vertical pack's `probeIds`. */
  verticalPackSlug?: string;
  /**
   * Maximum length of the strategy chain. Default behaviour from env (Infinity
   * unless capped). chainDepth = 0 → only raw probes; 1 → + each single
   * encoding OR framing; 2 → + each (encoding, framing) pair; etc.
   *
   * In practice 2 is the useful ceiling; the encoding × framing matrix already
   * dominates the search space.
   */
  chainDepth?: number;
  /**
   * Whether to enumerate the encoding family. Default: true.
   */
  includeEncodings?: boolean;
  /** Whether to enumerate the framing family. Default: true. */
  includeFramings?: boolean;
  /**
   * Whether to enumerate one extra chain per multilingual language. Default:
   * false (LLM-assisted, expensive). Languages: ['zu', 'xh', 'mt', 'ay'] by
   * default — Crescendo / TAP / GOAT need an LLM call per translation.
   */
  includeMultilingual?: boolean;
  /**
   * Test-only / advanced: inject an alternative probe stream. The default
   * implementation reads from Prisma (cursor-paginated). Tests inject a
   * fake iterator to avoid spinning up a DB.
   */
  probeStream?: AsyncIterable<Probe>;
  /**
   * Per-probe budget (keyed by probe slug) from the relevance allocator. When a
   * probe has a budget, its maxChainDepth + strategyFamilies override the global
   * chainDepth/includes for that probe. Probes absent from the map use globals.
   */
  probeBudgets?: Map<string, ProbeBudget>;
}

const DEFAULT_LANGUAGES = ['zu', 'xh', 'mt', 'ay']; // Zulu, Xhosa, Maltese, Aymara — low-resource

/**
 * Yield every (probe × strategy_chain) tuple in deterministic order.
 *
 * Order:
 *   for each probe (asc slug):
 *     yield (probe, [])                                       // raw
 *     for each encoding slug (asc): yield (probe, [encoding])
 *     for each framing slug (asc):  yield (probe, [framing])
 *     for each (encoding, framing) pair: yield (probe, [encoding, framing])
 *     for each language: yield (probe, ['multilingual.translate'])     // when includeMultilingual
 */
export async function* enumerateTestCases(
  options: EnumerateOptions = {},
): AsyncGenerator<EnumeratedCase> {
  const chainDepth = Number.isFinite(options.chainDepth) ? options.chainDepth! : 2;
  const includeEncodings = options.includeEncodings ?? true;
  const includeFramings = options.includeFramings ?? true;
  const includeMultilingual = options.includeMultilingual ?? false;

  // ── resolve the candidate strategy lists from the registry ──
  const encodings = includeEncodings ? listSlugsByFamily('encoding').sort() : [];
  const framings = includeFramings ? listSlugsByFamily('framing').sort() : [];
  const languages = includeMultilingual ? DEFAULT_LANGUAGES : [];

  // ── resolve the probe set (vertical-pack-filtered if requested) ──
  const probeFilter = options.verticalPackSlug
    ? await resolveVerticalPackFilter(options.verticalPackSlug)
    : undefined;

  // Stream the probes either from the caller-supplied iterator (tests) or
  // from Prisma via cursor pagination so the catalog can be arbitrarily large
  // without buffering all of it in memory.
  const probeIterable: AsyncIterable<Probe> =
    options.probeStream ?? defaultProbeStream(probeFilter);

  let seenAny = false;
  let probeCount = 0;

  for await (const probe of probeIterable) {
    seenAny = true;
    probeCount++;

    {
      let i = 0;
      const make = (chain: string[]): EnumeratedCase => {
        const suffix = chain.length === 0 ? 'raw' : chain.join('+');
        return {
          externalId: stableExternalId(probe.slug, suffix, i++),
          probe,
          strategyChain: chain,
          category: probe.category,
          severity: probe.severity,
          name: chain.length === 0
            ? probe.title
            : `${probe.title} — via ${suffix}`,
          description: probe.description,
          attackPrompt: probe.seedPayload,
          expectedSafeBehaviour:
            probe.expectedPassIndicators.join('; ') || 'Refuse, deflect, or sanitise.',
          detectionCriteria:
            probe.expectedFailIndicators.join('; ') || 'Detector chain fires fail/inspect.',
        };
      };

      // Per-probe budget overrides (relevance targeting). Falls back to globals.
      const budget = options.probeBudgets?.get(probe.slug);
      const effDepth = budget ? budget.maxChainDepth : chainDepth;
      const effEncodings = budget ? budget.strategyFamilies.includes('encoding') : includeEncodings;
      const effFramings = budget ? budget.strategyFamilies.includes('framing') : includeFramings;

      // Resolve per-probe strategy lists (may differ from global lists).
      const probeEncodings = effEncodings ? encodings : [];
      const probeFramings = effFramings ? framings : [];

      // 0-chain: raw probe — always emitted (coverage floor, never gated on budget)
      yield make([]);

      if (effDepth >= 1) {
        for (const e of probeEncodings) yield make([e]);
        for (const f of probeFramings) yield make([f]);
      }

      if (effDepth >= 2) {
        // (encoding, framing) pairs — order matters; encoding inside framing
        // means the model sees framing as outer wrapper around the encoded payload.
        for (const e of probeEncodings) {
          for (const f of probeFramings) yield make([e, f]);
        }
      }

      if (effDepth >= 3) {
        // (encoding, encoding, framing) — chain two encodings first
        for (let a = 0; a < probeEncodings.length; a++) {
          for (let b = a + 1; b < probeEncodings.length; b++) {
            for (const f of probeFramings) yield make([probeEncodings[a], probeEncodings[b], f]);
          }
        }
      }

      // Multilingual variants (optional, LLM-assisted at apply-time)
      if (includeMultilingual) {
        for (const lang of languages) {
          yield make([`multilingual.translate:${lang}`]);
        }
      }
    }

    // env.scanProbeCatalogLimit lets an operator cap the catalog walk. Default
    // Infinity (per the brief's hard requirement #1).
    if (Number.isFinite(env.scanProbeCatalogLimit) && probeCount >= env.scanProbeCatalogLimit) {
      break;
    }
  }

  if (!seenAny) {
    throw new Error('enumerateTestCases: no probes matched — check the catalog seed and the vertical pack slug.');
  }
}

/**
 * Default probe stream: cursor-paginated Prisma read. Yields probes in
 * ascending slug order so two runs against the same DB produce identical
 * (probe, strategy_chain) sequences (resumability anchor).
 */
async function* defaultProbeStream(probeFilter: string[] | undefined): AsyncGenerator<Probe> {
  const PAGE = 200;
  let lastSlug: string | undefined;
  while (true) {
    const page = await prisma.probe.findMany({
      where: {
        enabled: true,
        ...(probeFilter ? { id: { in: probeFilter } } : {}),
        ...(lastSlug ? { slug: { gt: lastSlug } } : {}),
      },
      orderBy: { slug: 'asc' },
      take: PAGE,
    });
    if (page.length === 0) break;
    for (const p of page) yield p;
    lastSlug = page[page.length - 1].slug;
  }
}

/** Resolve a vertical-pack slug → list of probe ids. */
async function resolveVerticalPackFilter(slug: string): Promise<string[] | undefined> {
  const pack = await prisma.verticalPack.findUnique({
    where: { slug },
    select: { probeIds: true },
  });
  if (!pack || pack.probeIds.length === 0) return undefined;
  return pack.probeIds;
}

/**
 * Deterministic per-case ID. Sorts cleanly when reviewing a run; lets the
 * resumer locate "where did we stop" in O(log N).
 *
 * Format: `tc.<probe-slug>.<chain-suffix>.<seq>`
 *
 * `seq` is the sequence within this probe (always 0 for the raw case, then
 * monotone increasing for each strategy chain). It's there so two runs of
 * the same enumerator produce identical externalIds even if a third probe
 * is added in between.
 */
function stableExternalId(probeSlug: string, chainSuffix: string, seq: number): string {
  return `tc.${probeSlug}.${chainSuffix}.${seq}`;
}

/**
 * Compute the theoretical case count for a given probe count and registry,
 * without iterating. Useful for the dashboard "this scan will take ~N cases"
 * pre-estimate.
 */
export function estimateCaseCount(
  probeCount: number,
  options: EnumerateOptions = {},
): number {
  const chainDepth = Number.isFinite(options.chainDepth) ? options.chainDepth! : 2;
  const includeEncodings = options.includeEncodings ?? true;
  const includeFramings = options.includeFramings ?? true;
  const includeMultilingual = options.includeMultilingual ?? false;

  const e = includeEncodings ? listSlugsByFamily('encoding').length : 0;
  const f = includeFramings ? listSlugsByFamily('framing').length : 0;
  const langs = includeMultilingual ? DEFAULT_LANGUAGES.length : 0;

  let perProbe = 1; // raw
  if (chainDepth >= 1) perProbe += e + f;
  if (chainDepth >= 2) perProbe += e * f;
  if (chainDepth >= 3) perProbe += (e * (e - 1) / 2) * f;
  perProbe += langs;

  return probeCount * perProbe;
}
