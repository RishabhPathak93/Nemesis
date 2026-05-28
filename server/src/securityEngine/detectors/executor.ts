import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

/**
 * SE-3 — detector executor. Tiered evaluation:
 *   1) cheap regex / signature detectors → may decisively pass or fail
 *   2) classifier detectors → currently stubs that defer to llm-judge
 *   3) llm-judge → final tier (wraps existing services/claude/evaluation.ts)
 *
 * Returns a verdict + reasoning + which detector decided. The runner stops at
 * the first decisive detector; that's where the cost reduction comes from
 * (most refusals are caught by the regex layer in milliseconds).
 */

export type Verdict = 'pass' | 'fail' | 'partial' | 'inspect';

export interface DetectorResult {
  detectorSlug: string;
  verdict: Verdict;
  reasoning: string;
  evidence?: string;
}

export interface DetectorContext {
  /** The probe's seed payload, post-strategy-chain. Used for echo-detection. */
  prompt: string;
  /** The agent's response. */
  response: string;
}

interface RegexConfig {
  patterns: string[];
  verdict: 'pass_when_match' | 'fail_when_match' | 'inspect';
}

interface SignatureConfig {
  tokens?: string[];
  ranges?: [string, string][];
  maxBytes?: number;
  verdict: 'pass_when_match' | 'fail_when_match' | 'inspect';
}

function runRegex(slug: string, cfg: RegexConfig, ctx: DetectorContext): DetectorResult | null {
  for (const pat of cfg.patterns) {
    let re: RegExp;
    try { re = new RegExp(pat); } catch { continue; }
    const m = ctx.response.match(re);
    if (m) {
      const verdict: Verdict =
        cfg.verdict === 'pass_when_match' ? 'pass' :
        cfg.verdict === 'fail_when_match' ? 'fail' : 'inspect';
      return {
        detectorSlug: slug,
        verdict,
        reasoning: `regex pattern matched: ${pat}`,
        evidence: m[0]?.slice(0, 200),
      };
    }
  }
  return null;
}

function runSignature(slug: string, cfg: SignatureConfig, ctx: DetectorContext): DetectorResult | null {
  if (cfg.tokens) {
    for (const tok of cfg.tokens) {
      if (ctx.response.includes(tok)) {
        const verdict: Verdict = cfg.verdict === 'pass_when_match' ? 'pass' :
          cfg.verdict === 'fail_when_match' ? 'fail' : 'inspect';
        return { detectorSlug: slug, verdict, reasoning: `signature token present: ${tok}`, evidence: tok };
      }
    }
  }
  if (cfg.ranges) {
    for (const [lo, hi] of cfg.ranges) {
      const a = parseInt(lo, 16);
      const b = parseInt(hi, 16);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      for (const ch of ctx.response) {
        const cp = ch.codePointAt(0) ?? 0;
        if (cp >= a && cp <= b) {
          const verdict: Verdict = cfg.verdict === 'pass_when_match' ? 'pass' :
            cfg.verdict === 'fail_when_match' ? 'fail' : 'inspect';
          return { detectorSlug: slug, verdict, reasoning: `unicode codepoint in range U+${lo}–U+${hi}`, evidence: ch };
        }
      }
    }
  }
  if (typeof cfg.maxBytes === 'number') {
    const bytes = Buffer.byteLength(ctx.response, 'utf-8');
    if (bytes > cfg.maxBytes) {
      const verdict: Verdict = cfg.verdict === 'fail_when_match' ? 'fail' : 'inspect';
      return { detectorSlug: slug, verdict, reasoning: `response length ${bytes} bytes exceeds ${cfg.maxBytes}` };
    }
  }
  return null;
}

interface DetectorRow {
  slug: string;
  kind: string;
  config: unknown;
  enabled: boolean;
}

let cache: { at: number; rows: DetectorRow[] } | undefined;
const CACHE_MS = 30_000;

async function loadDetectors(): Promise<DetectorRow[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const rows = await prisma.detector.findMany({ where: { enabled: true }, select: { slug: true, kind: true, config: true, enabled: true } });
  cache = { at: Date.now(), rows };
  return rows;
}

/**
 * Run a list of detector slugs against the (prompt, response) pair, returning
 * the first decisive result (pass/fail). Returns null if every detector either
 * returned 'inspect' or didn't match — caller should escalate to llm-judge.
 */
export async function runDetectorChain(slugs: string[], ctx: DetectorContext): Promise<DetectorResult | null> {
  if (slugs.length === 0) return null;
  const all = await loadDetectors();
  const byId = new Map(all.map((r) => [r.slug, r]));
  const inspectHits: DetectorResult[] = [];

  for (const slug of slugs) {
    const row = byId.get(slug);
    if (!row) continue;
    let result: DetectorResult | null = null;
    try {
      if (row.kind === 'regex') result = runRegex(slug, row.config as RegexConfig, ctx);
      else if (row.kind === 'signature') result = runSignature(slug, row.config as SignatureConfig, ctx);
      // 'classifier' and 'llm_judge' are skipped here; the test runner invokes the LLM judge separately.
    } catch (err) {
      logger.warn({ err, slug }, 'detector run errored');
      continue;
    }
    if (!result) continue;
    if (result.verdict === 'pass' || result.verdict === 'fail') return result;
    if (result.verdict === 'partial') return result;
    inspectHits.push(result);
  }

  // No decisive verdict; return null so the caller escalates to LLM judge.
  return null;
}

/**
 * Convenience for callers: returns a verdict ('pass'|'fail'|'partial') plus the
 * detector that decided, OR returns 'inspect' to signal the pipeline should
 * fall through to the existing Claude evaluator.
 */
export async function evaluateWithDetectors(
  detectorSlugs: string[],
  prompt: string,
  response: string,
): Promise<DetectorResult | { detectorSlug: 'none'; verdict: 'inspect'; reasoning: 'no detector matched decisively' }> {
  const result = await runDetectorChain(detectorSlugs, { prompt, response });
  if (result) return result;
  return { detectorSlug: 'none', verdict: 'inspect', reasoning: 'no detector matched decisively' };
}

/**
 * Always-on detectors run on every test case. Cheap regex checks that catch
 * the obvious tells regardless of whether the case carries a probe lineage.
 */
const ALWAYS_ON_DETECTORS = [
  'regex.refusal_keywords',
  'regex.pii_email',
  'regex.pii_phone',
  'regex.secrets_api_keys',
  'regex.pwned_marker',
  'regex.system_prompt_signatures',
];

/**
 * Default detector set for a test case. If the case is catalog-grounded
 * (has probeId), union the probe's `defaultDetectorIds` with the always-on
 * set. Otherwise return the always-on set.
 */
export function defaultDetectorsForCase(testCase?: { probeId?: string | null }): string[] {
  // The probe-specific detectors are looked up when the case is catalog-grounded;
  // the testRunner passes the prefetched probe row via probeDefaultDetectors below.
  void testCase;
  return ALWAYS_ON_DETECTORS;
}

/**
 * When the test runner has a probe on hand, use this to merge the always-on set
 * with the probe-defined detector ids.
 */
export function detectorsForProbe(probeDefaultDetectorIds: string[] | null | undefined): string[] {
  const probeSlugs = (probeDefaultDetectorIds ?? []).filter((s) => typeof s === 'string' && s.length > 0);
  return [...new Set([...probeSlugs, ...ALWAYS_ON_DETECTORS])];
}
