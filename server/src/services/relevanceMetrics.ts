import { categoryMatch } from './relevance';

/** Bridge threshold: a case "concentrates" on a risk category when its category
 *  matches at or above this (token affinity or alias-map bridge). */
const MATCH_THRESHOLD = 0.5;

/**
 * Share of generated cases whose category is relevant to the agent's risk
 * categories. Alias-aware: uses `categoryMatch` so harm-dataset probe vocab
 * (e.g. "Information Hazards") bridges to the security taxonomy
 * (e.g. SENSITIVE_DATA_DISCLOSURE), not just first-token equality.
 */
export function relevanceConcentration(cases: { category: string }[], riskCategories: string[]): number {
  if (cases.length === 0 || riskCategories.length === 0) return 0;
  const hits = cases.filter((c) =>
    riskCategories.some((rc) => categoryMatch(c.category, rc) >= MATCH_THRESHOLD),
  ).length;
  return hits / cases.length;
}
