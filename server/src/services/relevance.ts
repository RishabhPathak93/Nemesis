// Per-agent probe relevance: deterministic scorer + tiered budget allocator.
// Probe categories are lowercase (prompt_injection, data_exfil); the
// understanding taxonomy is UPPERCASE (PROMPT_INJECTION). Always normalize.

export interface ProbeBudget {
  tier: 'high' | 'med' | 'low';
  maxChainDepth: number;       // 0 = raw only (coverage floor)
  strategyFamilies: string[];  // which families to expand for this probe
}

export interface RelevanceConfig {
  weights: {
    category: number; surface: number; dataScope: number;
    vertical: number; reaction: number; effectiveness: number; severity: number;
  };
  tierThresholds: { high: number; med: number };  // score >= high → high; >= med → med; else low
  budgets: { high: ProbeBudget; med: ProbeBudget; low: ProbeBudget };
  llmRerankEnabled: boolean;
}

const num = (v: string | undefined, d: number) => Number(v ?? '') || d;

export const RELEVANCE_CONFIG: RelevanceConfig = {
  weights: {
    category: num(process.env.RELEVANCE_W_CATEGORY, 0.30),
    surface: num(process.env.RELEVANCE_W_SURFACE, 0.10),
    dataScope: num(process.env.RELEVANCE_W_DATASCOPE, 0.10),
    vertical: num(process.env.RELEVANCE_W_VERTICAL, 0.10),
    reaction: num(process.env.RELEVANCE_W_REACTION, 0.25),
    effectiveness: num(process.env.RELEVANCE_W_EFFECTIVENESS, 0.10),
    severity: num(process.env.RELEVANCE_W_SEVERITY, 0.05),
  },
  tierThresholds: { high: 0.66, med: 0.33 },
  budgets: {
    high: { tier: 'high', maxChainDepth: 2, strategyFamilies: ['encoding', 'framing'] },
    med: { tier: 'med', maxChainDepth: 1, strategyFamilies: ['framing'] },
    low: { tier: 'low', maxChainDepth: 0, strategyFamilies: [] },
  },
  llmRerankEnabled: (process.env.SUITE_RELEVANCE_LLM_RERANK ?? 'false').toLowerCase() === 'true',
};

/** Lowercase + split on non-alphanumerics into significant tokens (len >= 2). */
export function normalizeCategory(s: string): string[] {
  return (s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/** Two tokens match if one is a prefix of the other and the prefix is >= 4 chars
 *  (so "exfil" ~ "exfiltration"). Returns Jaccard-ish overlap in [0,1]. */
export function categoryAffinity(probeCategory: string, understandingCategory: string): number {
  const a = normalizeCategory(probeCategory);
  const b = normalizeCategory(understandingCategory);
  if (a.length === 0 || b.length === 0) return 0;
  let matches = 0;
  for (const ta of a) {
    if (b.some((tb) => (ta.startsWith(tb) || tb.startsWith(ta)) && Math.min(ta.length, tb.length) >= 4)) {
      matches++;
    }
  }
  return matches / Math.max(a.length, b.length);
}
