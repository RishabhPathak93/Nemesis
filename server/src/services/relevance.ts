// Per-agent probe relevance: deterministic scorer + tiered budget allocator.
// Probe categories are lowercase (prompt_injection, data_exfil); the
// understanding taxonomy is UPPERCASE (PROMPT_INJECTION). Always normalize.
import type { AgentUnderstanding } from './claude/understandingTypes';

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

export interface ProbeSignal {
  slug: string;
  category: string;
  severity: string;
  applicability: string[];
}

export interface RelevanceInput {
  understanding: AgentUnderstanding | null;
  agentType: string;
  sensitiveDataScope: string[];
  /** Normalized-category → 0..1 historical effectiveness (see knowledgeBase helper). */
  categoryEffectiveness: Map<string, number>;
}

const SEVERITY_PRIOR: Record<string, number> = { critical: 1, high: 0.75, medium: 0.5, low: 0.25 };
const REACTION_WEIGHT: Record<string, number> = { high: 1, medium: 0.6, low: 0.3 };
const DATA_TOKENS = ['data', 'pii', 'exfil', 'sensitive', 'disclosure', 'privacy'];

function applicabilityTokens(agentType: string): string[] {
  const t = (agentType || '').toLowerCase();
  const out = new Set<string>();
  if (t.includes('rag')) out.add('rag');
  if (t.includes('tool') || t.includes('agent')) { out.add('agent'); out.add('tool_use'); }
  out.add('chatbot');
  return [...out];
}

function maxAffinity(probeCategory: string, categories: string[]): number {
  let best = 0;
  for (const c of categories) best = Math.max(best, categoryAffinity(probeCategory, c));
  return best;
}

/** Deterministic 0..1 relevance score per probe (keyed by slug). Pure function. */
export function scoreProbeRelevance(
  probes: ProbeSignal[],
  input: RelevanceInput,
  config: RelevanceConfig = RELEVANCE_CONFIG,
): Map<string, number> {
  const w = config.weights;
  const wSum = w.category + w.surface + w.dataScope + w.vertical + w.reaction + w.effectiveness + w.severity;
  const u = input.understanding;
  const riskCats = [...(u?.risk_categories ?? []), ...(u?.recommended_focus_areas ?? [])];
  const surfaces = u?.attack_surfaces ?? [];
  const appTokens = applicabilityTokens(input.agentType);
  const probeIsDataRelated = (cat: string) =>
    normalizeCategory(cat).some((tok) => DATA_TOKENS.some((d) => tok.startsWith(d) || d.startsWith(tok)));

  const out = new Map<string, number>();
  for (const p of probes) {
    const category = riskCats.length ? maxAffinity(p.category, riskCats) : 0;
    const surface = surfaces.length ? maxAffinity(p.category, surfaces) : 0;
    const dataScope = input.sensitiveDataScope.length > 0 && probeIsDataRelated(p.category) ? 1 : 0;
    const vertical = p.applicability.some((a) => appTokens.includes(a.toLowerCase())) ? 1 : 0;
    let reaction = 0;
    for (const r of u?.probe_reactions ?? []) {
      reaction = Math.max(reaction, categoryAffinity(p.category, r.type) * (REACTION_WEIGHT[r.severity_hint] ?? 0.3));
    }
    const normCatKey = normalizeCategory(p.category)[0] ?? '';
    const effectiveness = input.categoryEffectiveness.get(normCatKey) ?? 0;
    const severity = SEVERITY_PRIOR[(p.severity || 'low').toLowerCase()] ?? 0.25;

    const raw =
      w.category * category + w.surface * surface + w.dataScope * dataScope +
      w.vertical * vertical + w.reaction * reaction + w.effectiveness * effectiveness +
      w.severity * severity;
    out.set(p.slug, wSum > 0 ? Math.min(1, Math.max(0, raw / wSum)) : 0);
  }
  return out;
}

/** Map each probe's score → a ProbeBudget tier. Every probe gets a budget
 *  (coverage floor: low tier = raw only, never dropped). */
export function allocateBudget(
  scores: Map<string, number>,
  config: RelevanceConfig = RELEVANCE_CONFIG,
): Map<string, ProbeBudget> {
  const out = new Map<string, ProbeBudget>();
  for (const [slug, score] of scores) {
    const tier = score >= config.tierThresholds.high ? 'high'
      : score >= config.tierThresholds.med ? 'med' : 'low';
    out.set(slug, config.budgets[tier]);
  }
  return out;
}

/** Convenience: score then allocate, returning the budget map the enumerator wants. */
export function buildProbeBudgets(
  probes: ProbeSignal[], input: RelevanceInput, config: RelevanceConfig = RELEVANCE_CONFIG,
): Map<string, ProbeBudget> {
  return allocateBudget(scoreProbeRelevance(probes, input, config), config);
}
