import { normalizeCategory } from './relevance';

/** Share of generated cases whose normalized category is in the agent's top set. */
export function relevanceConcentration(cases: { category: string }[], topCategoryKeys: string[]): number {
  if (cases.length === 0) return 0;
  const top = new Set(topCategoryKeys);
  const hits = cases.filter((c) => top.has(normalizeCategory(c.category)[0] ?? '')).length;
  return hits / cases.length;
}
