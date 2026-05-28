import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { HttpError } from '../middleware/errorHandler';
import {
  listOrgPatterns,
  listOrgResearch,
  deletePattern,
} from '../services/learning/knowledgeBase';
import { extractPatternsFromRun } from '../services/learning/extractPatterns';
import { researchAdHoc } from '../services/research/researcher';
import { resolveSearchProvider } from '../services/research/webSearch';

/**
 * After the Knowledge/Library/Datasets merge, all three "adversarial content"
 * surfaces share one underlying model: `Probe`. This controller is a thin,
 * back-compat shim:
 *
 *   /knowledge/articles            → Probe rows where source is a curated catalog
 *   /knowledge/patterns            → Probe rows where source='cortexview_learned'
 *   /knowledge/research            → ResearchSnapshot (genuinely distinct)
 *
 * Frontends should migrate to `/security-engine/probes` for full filtering;
 * we keep these endpoints alive for backward compatibility with old clients
 * and the existing `Knowledge.tsx` page.
 */

const CURATED_SOURCES = ['cortexview_kb', 'cortexview_curated'];

const adhocResearchSchema = z.object({
  topic: z.string().min(3).max(300),
});

const extractSchema = z.object({
  testRunId: z.string().min(1),
});

export async function getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const [patterns, research, provider, org, articles] = await Promise.all([
      listOrgPatterns(orgId).then((rows) => rows.length),
      prisma.researchSnapshot.count({ where: { orgId } }),
      resolveSearchProvider(orgId),
      prisma.org.findUnique({ where: { id: orgId } }),
      prisma.probe.count({ where: { enabled: true, source: { in: CURATED_SOURCES } } }),
    ]);
    res.json({
      patternCount: patterns,
      researchCount: research,
      articleCount: articles,
      learningEnabled: !!org?.enableLearning,
      researchEnabled: !!org?.enableResearch,
      researchProvider: provider?.provider ?? null,
      researchReady: !!provider,
    });
  } catch (err) {
    next(err);
  }
}

/** Curated catalog probes — replaces the legacy KnowledgeArticle list. */
export async function listArticles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { q, severity, category, limit } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = { enabled: true, source: { in: CURATED_SOURCES } };
    if (severity && severity !== 'all') where.severity = severity.toLowerCase();
    if (category && category !== 'all') where.category = category;
    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q, mode: 'insensitive' } },
        { category: { contains: q, mode: 'insensitive' } },
      ];
    }
    const cap = Math.min(parseInt(limit || '300', 10) || 300, 1000);
    const probes = await prisma.probe.findMany({
      where,
      take: cap,
      orderBy: [{ severity: 'desc' }, { source: 'asc' }, { slug: 'asc' }],
      include: { complianceMappings: true },
    });
    // Project to the legacy shape so existing UI keeps working without changes.
    res.json(probes.map((p) => ({
      id: p.id,
      externalId: p.slug,
      title: p.title,
      category: p.category,
      subcategory: p.subcategory,
      severity: p.severity,
      description: p.description,
      payloads: [p.seedPayload],
      variations: [],
      expectedSafeBehavior: p.expectedPassIndicators?.join('; ') ?? null,
      expectedVulnerableBehavior: p.expectedFailIndicators?.join('; ') ?? null,
      targets: p.applicability,
      frameworks: p.complianceMappings.reduce<Record<string, string[]>>((acc, m) => {
        const key = m.framework.toLowerCase();
        (acc[key] ||= []).push(m.controlId);
        return acc;
      }, {}),
      source: p.source,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })));
  } catch (err) {
    next(err);
  }
}

export async function getArticle(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const probe = await prisma.probe.findFirst({
      where: { id: req.params.id, source: { in: CURATED_SOURCES } },
      include: { complianceMappings: true },
    });
    if (!probe) throw new HttpError(404, 'Probe not found');
    res.json(probe);
  } catch (err) {
    next(err);
  }
}

export async function listCategories(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await prisma.probe.groupBy({
      by: ['category'],
      where: { enabled: true, source: { in: CURATED_SOURCES } },
      _count: { _all: true },
      orderBy: { _count: { category: 'desc' } },
    });
    res.json(rows.map((r) => ({ category: r.category, count: r._count._all })));
  } catch (err) {
    next(err);
  }
}

export async function listPatterns(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const patterns = await listOrgPatterns(req.user!.orgId);
    // Project to the legacy AttackPattern shape so existing UI keeps working.
    res.json(patterns.map((p) => {
      const m = (p.metadata as { effectiveness?: number; rationale?: string; applicableContext?: string; timesSeen?: number; timesEffective?: number; sourceTestCaseId?: string } | null) ?? {};
      return {
        id: p.id,
        orgId: req.user!.orgId,
        category: p.category,
        severity: p.severity,
        name: p.title,
        pattern: p.seedPayload,
        rationale: m.rationale ?? p.description,
        applicableContext: m.applicableContext ?? '',
        effectiveness: m.effectiveness ?? 0.5,
        timesSeen: m.timesSeen ?? 1,
        timesEffective: m.timesEffective ?? 1,
        sourceTestCaseId: m.sourceTestCaseId ?? null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
    }));
  } catch (err) {
    next(err);
  }
}

export async function removePattern(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.user!.role !== 'ADMIN') throw new HttpError(403, 'Admin only');
    await deletePattern(req.user!.orgId, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function listResearch(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const snapshots = await listOrgResearch(req.user!.orgId);
    res.json(snapshots);
  } catch (err) {
    next(err);
  }
}

export async function runAdhocResearch(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { topic } = adhocResearchSchema.parse(req.body);
    const provider = await resolveSearchProvider(req.user!.orgId);
    if (!provider) throw new HttpError(400, 'Research is disabled or no search provider configured for this org');
    const digest = await researchAdHoc(req.user!.orgId, topic);
    if (!digest) throw new HttpError(502, 'Research returned no results');
    res.status(201).json(digest);
  } catch (err) {
    next(err);
  }
}

/** Manually re-extract patterns from a past run (e.g. after enabling learning). */
export async function extractFromRun(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { testRunId } = extractSchema.parse(req.body);
    const run = await prisma.testRun.findUnique({
      where: { id: testRunId },
      include: { suite: { include: { agent: true } } },
    });
    if (!run || run.suite.agent.orgId !== req.user!.orgId) {
      throw new HttpError(404, 'Test run not found');
    }
    const patterns = await extractPatternsFromRun(testRunId);
    res.json({ extracted: patterns.length, patterns });
  } catch (err) {
    next(err);
  }
}
