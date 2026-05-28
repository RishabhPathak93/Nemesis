import type { Agent, Probe } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { env } from '../../lib/env';

// v2.2 — Prisma `take: undefined` means "no limit" (Number.POSITIVE_INFINITY
// isn't a valid Prisma arg). Convert Infinity → undefined here.
function takeOrUnlimited(n: number): number | undefined {
  return Number.isFinite(n) ? n : undefined;
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  informational: 0,
};

/**
 * Unified knowledge model:
 *   - Curated KB articles  → Probe(source='cortexview_kb' | 'cortexview_curated')
 *   - Learned attack patterns → Probe(source='cortexview_learned')
 *   - Dataset items pending promotion → DatasetItem (separate model, by design)
 *
 * The two helpers below preserve the existing public API used by
 * `suiteBuilder.ts` so the test-generation pipeline doesn't have to change.
 */

/**
 * Map a CortexView agent type to applicability tags. The Probe table uses
 * `applicability` (chatbot/rag/agent/tool_use/multimodal) — same shape as the
 * old `KnowledgeArticle.targets[]`.
 */
function inferApplicabilityTags(agent: Agent): string[] {
  const t = agent.agentType.toLowerCase();
  const tags = new Set<string>();
  if (t.includes('agent')) tags.add('agent');
  if (t.includes('bot') || t.includes('assistant') || t.includes('chat')) tags.add('chatbot');
  if (t.includes('rag') || t.includes('retrieval')) tags.add('rag');
  if (t.includes('multimodal') || t.includes('vision') || t.includes('image')) tags.add('multimodal');
  if (tags.size === 0) tags.add('chatbot');
  return Array.from(tags);
}

/**
 * "Curated KB" pull — Probe rows from the unified CortexView catalog
 * (cortexview_kb + cortexview_curated). Excludes per-org learned patterns —
 * those are handled by `getRelevantPatterns`.
 */
export async function getRelevantKnowledgeArticles(
  agent: Agent,
  // v2.2 — caller-override; defaults to env.scanKbFinalLimit which is Infinity
  // unless SCAN_KB_FINAL_LIMIT is set.
  limit: number = env.scanKbFinalLimit,
): Promise<Probe[]> {
  const understanding = (agent.understanding as { risk_categories?: string[] } | null) ?? null;
  const preferredCategories = (understanding?.risk_categories ?? []).map((c) => c.toLowerCase());
  const tags = inferApplicabilityTags(agent);

  const pool = await prisma.probe.findMany({
    where: {
      enabled: true,
      source: { in: ['cortexview_kb', 'cortexview_curated'] },
    },
    // v2.2 — env.scanKbPoolSize defaults to Infinity → no Prisma cap.
    take: takeOrUnlimited(env.scanKbPoolSize),
  });
  if (pool.length === 0) return [];

  const scored = pool.map((p) => {
    let score = SEVERITY_RANK[p.severity] ?? 0;
    if (p.applicability.some((a) => tags.includes(a))) score += 3;
    const catLower = p.category.toLowerCase();
    if (preferredCategories.some((rc) => catLower.includes(rc.replace(/_/g, ' ')) || catLower.includes(rc))) {
      score += 4;
    }
    return { p, score };
  });
  scored.sort((x, y) => y.score - x.score);
  const finalLimit = Number.isFinite(limit) ? limit : scored.length;
  return scored.slice(0, finalLimit).map((s) => s.p);
}

/**
 * Per-org "learned" pull — Probe rows where `source='cortexview_learned'`
 * AND `metadata.orgId === agent.orgId`. Effectiveness lives in metadata.
 */
export async function getRelevantPatterns(
  agent: Agent,
  limit: number = env.scanPatternFinalLimit,
): Promise<Probe[]> {
  const understanding = (agent.understanding as { risk_categories?: string[] } | null) ?? null;
  const preferredCategories = understanding?.risk_categories ?? [];

  const pool = await prisma.probe.findMany({
    where: {
      source: 'cortexview_learned',
      // We filter by orgId via a JSON path predicate below in JS; the slug
      // also embeds the orgId prefix so the index helps without an extra column.
    },
    take: takeOrUnlimited(env.scanPatternPoolSize),
  });
  if (pool.length === 0) return [];

  type LearnedMeta = { effectiveness?: number; timesEffective?: number; timesSeen?: number; orgId?: string };
  const orgScoped = pool.filter((p) => {
    const m = (p.metadata as LearnedMeta | null) ?? {};
    return m.orgId === agent.orgId;
  });

  const scored = orgScoped.map((p) => {
    const m = (p.metadata as LearnedMeta | null) ?? {};
    const effectiveness = typeof m.effectiveness === 'number' ? m.effectiveness : 0.5;
    const timesEffective = typeof m.timesEffective === 'number' ? m.timesEffective : 1;
    const categoryBoost = preferredCategories.includes(p.category) ? 0.5 : 0;
    const score = effectiveness + categoryBoost + Math.log10(1 + timesEffective) * 0.1;
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const finalLimit = Number.isFinite(limit) ? limit : scored.length;
  return scored.slice(0, finalLimit).map((s) => s.p);
}

/** All learned patterns for an org, for the Knowledge UI. */
export async function listOrgPatterns(orgId: string): Promise<Probe[]> {
  type LearnedMeta = { orgId?: string; effectiveness?: number };
  const pool = await prisma.probe.findMany({
    where: { source: 'cortexview_learned' },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  });
  return pool.filter((p) => ((p.metadata as LearnedMeta | null) ?? {}).orgId === orgId);
}

export async function listOrgResearch(orgId: string) {
  return prisma.researchSnapshot.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

/** Delete a learned pattern (Probe row), respecting org scope via metadata. */
export async function deletePattern(orgId: string, probeId: string) {
  type LearnedMeta = { orgId?: string };
  const probe = await prisma.probe.findUnique({ where: { id: probeId } });
  if (!probe) return { count: 0 };
  if (probe.source !== 'cortexview_learned') return { count: 0 };
  const meta = (probe.metadata as LearnedMeta | null) ?? {};
  if (meta.orgId !== orgId) return { count: 0 };
  await prisma.probe.delete({ where: { id: probeId } });
  return { count: 1 };
}
