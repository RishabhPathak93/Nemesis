import { Agent } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { sanitizeForDb } from '../lib/json';
import { generateAgentUnderstanding } from './claude/understanding';
import { generateTestSuite } from './claude/testGeneration';
import { getRelevantPatterns, getRelevantKnowledgeArticles } from './learning/knowledgeBase';
import { researchForAgent } from './research/researcher';
import { enumerateTestCases, type EnumerateOptions } from './strategyEnumerator';

export interface BuildSuiteOptions {
  /**
   * If provided, populate test cases inside this existing TestSuite (e.g. a placeholder
   * created by the controller before queueing). Otherwise a brand-new TestSuite is created.
   */
  intoSuiteId?: string;
  /** Optional progress reporter — used by the worker to update TestRun.phaseDetail. */
  onProgress?: (label: string) => Promise<void>;
  /** SE-6 — when set, narrow the probe catalog injected into test generation. */
  verticalPackSlug?: string;
  /**
   * v2.2 — enumeration mode.
   *   'llm'       — legacy LLM-curated suite (creative + bounded). Read-only.
   *   'cartesian' — deterministic product of (probe × strategies × …).
   *   'hybrid'    — Cartesian skeleton at runtime, plus adaptive LLM mutation
   *                 in the runner (default for new scans).
   *
   * Default is taken from TestRun.enumerationMode if available; if not, falls
   * back to 'llm' for backwards compatibility with existing scans.
   */
  enumerationMode?: 'llm' | 'cartesian' | 'hybrid';
  /** Extra knobs forwarded to the Cartesian enumerator (when cartesian/hybrid). */
  cartesianOptions?: EnumerateOptions;
}

/**
 * Builds a fresh, adaptive test suite for an agent.
 *
 *   1. Generates the security understanding profile if missing
 *   2. Pulls the most relevant learned patterns (best-effort)
 *   3. Runs web research (best-effort, only if the org has it enabled)
 *   4. Calls the test-generation pipeline with patterns + research as in-context grounding
 *   5. Persists test cases to the supplied or freshly-created TestSuite
 *
 * Returns the suite id with its test cases populated.
 */
export async function buildSuiteForAgent(
  agent: Agent,
  options: BuildSuiteOptions = {},
): Promise<{ suiteId: string; caseCount: number }> {
  const { onProgress } = options;
  const mode = options.enumerationMode ?? 'llm';

  // v2.2 — A2: deterministic Cartesian path. Skips LLM-curated payload
  // generation entirely; cases come from the registry × probe-catalog
  // product. Understanding still runs because downstream judging benefits
  // from it (the LLM judge reads it as context).
  //
  // 'hybrid' shares the same suite-builder skeleton — the LLM-driven
  // mutation happens later, in the runner's per-case adaptive loop.
  if (mode === 'cartesian' || mode === 'hybrid') {
    return buildSuiteCartesian(agent, options);
  }

  // 1. Ensure understanding exists
  let understanding = agent.understanding as unknown as
    | Awaited<ReturnType<typeof generateAgentUnderstanding>>
    | null;
  if (!understanding) {
    await onProgress?.('Analysing agent profile…');
    understanding = await generateAgentUnderstanding(agent);
    await prisma.agent.update({
      where: { id: agent.id },
      data: { understanding: understanding as unknown as object },
    });
  }

  // 2 & 3. Best-effort enrichment — KB articles, learned patterns, web research
  await onProgress?.('Loading curated KB, learned patterns, and research…');
  const [knowledgeArticles, patterns, research] = await Promise.all([
    getRelevantKnowledgeArticles(agent, 12).catch((err) => {
      console.warn('[suite] KB lookup failed:', err);
      return [];
    }),
    getRelevantPatterns(agent).catch((err) => {
      console.warn('[suite] pattern lookup failed:', err);
      return [];
    }),
    researchForAgent(agent).catch((err) => {
      console.warn('[suite] research failed:', err);
      return null;
    }),
  ]);

  // 4. Generate test cases — streamed, so we can surface a live count.
  await onProgress?.('Generating tailored adversarial test cases — 0 so far…');
  let lastReportedCount = -1;
  const generated = await generateTestSuite(agent, understanding, {
    patterns,
    research,
    knowledgeArticles,
    verticalPackSlug: options.verticalPackSlug,
    onCaseCount: async (count) => {
      // Only update when the count actually changes — avoids hammering the DB.
      if (count !== lastReportedCount) {
        lastReportedCount = count;
        await onProgress?.(`Generating tailored adversarial test cases — ${count} so far…`);
      }
    },
  });

  // 5. Persist — defensively coerce any LLM-emitted oddities (arrays where
  // strings are expected, missing fields, etc.) before they hit Prisma.
  const persistRows = generated
    .map((tc, i) => normaliseGeneratedCase(tc, i))
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (persistRows.length === 0) {
    throw new Error('All generated test cases were unusable after normalisation');
  }

  // SE-2 — bulk resolve probe slugs → probeIds. Cases tagged with unknown
  // slugs degrade gracefully to probeId=null (still persisted, just legacy).
  const taggedSlugs = [...new Set(persistRows.map((r) => r.probeSlug).filter((s): s is string => !!s))];
  let slugToId = new Map<string, string>();
  if (taggedSlugs.length > 0) {
    const probes = await prisma.probe.findMany({
      where: { slug: { in: taggedSlugs } },
      select: { id: true, slug: true },
    });
    slugToId = new Map(probes.map((p) => [p.slug, p.id]));
  }

  // Strip the helper-only fields and project final insert rows.
  const insertRows = persistRows.map((row) => {
    const { probeSlug, strategyChain, ...rest } = row;
    return {
      ...rest,
      probeId: probeSlug ? slugToId.get(probeSlug) ?? null : null,
      strategyChain,
    };
  });

  let suiteId: string;
  if (options.intoSuiteId) {
    suiteId = options.intoSuiteId;
    await prisma.testCase.deleteMany({ where: { suiteId } });
    await prisma.testCase.createMany({
      data: insertRows.map((row) => ({ suiteId, ...row })),
    });
  } else {
    const created = await prisma.testSuite.create({
      data: {
        agentId: agent.id,
        testCases: { create: insertRows },
      },
    });
    suiteId = created.id;
  }

  return { suiteId, caseCount: insertRows.length };
}

/**
 * v2.2 — Deterministic Cartesian builder. Streams from `enumerateTestCases`
 * and inserts in batches of 500 so we don't OOM on large catalogs.
 */
async function buildSuiteCartesian(
  agent: Agent,
  options: BuildSuiteOptions,
): Promise<{ suiteId: string; caseCount: number }> {
  const { onProgress, intoSuiteId } = options;

  // Resolve suiteId up-front so we can batch-insert into it.
  let suiteId: string;
  if (intoSuiteId) {
    suiteId = intoSuiteId;
    // Wipe any leftover rows from a previous attempt at the same suiteId.
    await prisma.testCase.deleteMany({ where: { suiteId } });
  } else {
    const created = await prisma.testSuite.create({ data: { agentId: agent.id } });
    suiteId = created.id;
  }

  await onProgress?.('Enumerating (probe × strategy) Cartesian product…');

  const BATCH = 500;
  let total = 0;
  let batch: {
    suiteId: string;
    externalId: string;
    category: string;
    severity: string;
    name: string;
    description: string;
    attackPrompt: string;
    expectedSafeBehaviour: string;
    detectionCriteria: string;
    probeId: string | null;
    strategyChain: string[];
  }[] = [];

  for await (const ec of enumerateTestCases({
    verticalPackSlug: options.verticalPackSlug,
    ...options.cartesianOptions,
  })) {
    batch.push({
      suiteId,
      externalId: ec.externalId,
      category: sanitizeForDb(ec.category),
      severity: ec.severity,
      name: sanitizeForDb(ec.name),
      description: sanitizeForDb(ec.description),
      attackPrompt: sanitizeForDb(ec.attackPrompt),
      expectedSafeBehaviour: sanitizeForDb(ec.expectedSafeBehaviour),
      detectionCriteria: sanitizeForDb(ec.detectionCriteria),
      probeId: ec.probe.id,
      strategyChain: ec.strategyChain,
    });
    if (batch.length >= BATCH) {
      await prisma.testCase.createMany({ data: batch });
      total += batch.length;
      await onProgress?.(`Enumerated ${total} test cases so far…`);
      batch = [];
    }
  }
  if (batch.length > 0) {
    await prisma.testCase.createMany({ data: batch });
    total += batch.length;
  }

  if (total === 0) {
    throw new Error('Cartesian enumeration produced no test cases — empty probe catalog?');
  }
  await onProgress?.(`Suite ready: ${total} test cases.`);
  return { suiteId, caseCount: total };
}

/**
 * Coerces a single LLM-generated test case into the shape Prisma expects.
 * Tolerates: arrays where strings are expected (joins them), missing optional
 * fields, mis-cased severities, non-string ids. Returns null if the case is
 * fundamentally unusable (no prompt, no name).
 */
function normaliseGeneratedCase(tc: unknown, idx: number): {
  externalId: string;
  category: string;
  severity: string;
  name: string;
  description: string;
  attackPrompt: string;
  expectedSafeBehaviour: string;
  detectionCriteria: string;
  probeSlug: string | null;
  strategyChain: string[];
} | null {
  if (!tc || typeof tc !== 'object') return null;
  const r = tc as Record<string, unknown>;

  const toStr = (v: unknown, fallback = ''): string => {
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n\n');
    if (v == null) return fallback;
    return JSON.stringify(v);
  };

  const attackPrompt = toStr(r.attack_prompt ?? r.attackPrompt ?? r.payload ?? r.payloads);
  const name = toStr(r.name ?? r.title);
  if (!attackPrompt.trim() || !name.trim()) return null; // genuinely unusable

  // Reject prompts that are nothing but unfilled `{{placeholder}}` template
  // tokens. The LLM is instructed not to emit these, but small models sometimes
  // leak the template variable through. A prompt that is *purely* a placeholder
  // can't actually attack anything.
  const placeholderOnly = /^\s*\{\{[^}]*\}\}\s*$/;
  if (placeholderOnly.test(attackPrompt)) return null;

  const sevRaw = toStr(r.severity, 'medium').toLowerCase();
  const severity = ['critical', 'high', 'medium', 'low'].includes(sevRaw) ? sevRaw : 'medium';

  // SE-2 catalog grounding (optional — null/empty when the LLM didn't tag).
  const probeSlugRaw = r.probe_slug ?? r.probeSlug;
  const probeSlug = typeof probeSlugRaw === 'string' && probeSlugRaw.trim().length > 0
    ? probeSlugRaw.trim()
    : null;
  const chainRaw = r.strategy_chain ?? r.strategyChain;
  const strategyChain: string[] = Array.isArray(chainRaw)
    ? chainRaw.filter((s): s is string => typeof s === 'string' && s.length > 0)
    : [];

  return {
    externalId: sanitizeForDb(toStr(r.id ?? r.external_id ?? r.externalId, `TC-${String(idx + 1).padStart(3, '0')}`)),
    category: sanitizeForDb(toStr(r.category, 'PROMPT_INJECTION')),
    severity,
    name: sanitizeForDb(name),
    description: sanitizeForDb(toStr(r.description)),
    attackPrompt: sanitizeForDb(attackPrompt),
    expectedSafeBehaviour: sanitizeForDb(toStr(r.expected_safe_behaviour ?? r.expectedSafeBehaviour)),
    detectionCriteria: sanitizeForDb(toStr(r.detection_criteria ?? r.detectionCriteria)),
    probeSlug,
    strategyChain,
  };
}
