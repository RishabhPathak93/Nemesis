import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma, prismaRead } from '../lib/prisma';
import { FRAMEWORK_REGISTRY, type FrameworkKey } from '../securityEngine/compliance/frameworks';
import { auditFromRequest } from '../lib/audit';
import { fetchHarmBench } from '../securityEngine/datasets/fetchers/harmbench';
import { fetchAdvBench } from '../securityEngine/datasets/fetchers/advbench';
import { fetchDoNotAnswer } from '../securityEngine/datasets/fetchers/donotanswer';
import { fetchCyberSecEval } from '../securityEngine/datasets/fetchers/cybersec_eval';
import { crescendoOrchestrator } from '../securityEngine/orchestrators/crescendo';
import { skeletonKeyOrchestrator } from '../securityEngine/orchestrators/skeletonKey';
import { tapOrchestrator } from '../securityEngine/orchestrators/tap';
import { goatOrchestrator } from '../securityEngine/orchestrators/goat';
import { modelExtractionOrchestrator } from '../securityEngine/orchestrators/modelExtraction';
import { membershipInferenceOrchestrator } from '../securityEngine/orchestrators/membershipInference';
import { trainingDataReplayOrchestrator } from '../securityEngine/orchestrators/trainingDataReplay';
import { applyStrategyChain } from '../securityEngine/strategies/encoders';
import { translatePayload } from '../securityEngine/strategies/multilingual';

const ListProbesQuery = z.object({
  category: z.string().optional(),
  severity: z.string().optional(),
  source: z.string().optional(),
  applicability: z.string().optional(),
  framework: z.string().optional(),
  controlId: z.string().optional(),
  search: z.string().optional(),
  probeIds: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const ToggleProbeSchema = z.object({ disabled: z.boolean() });

/** PUT /api/security-engine/probes/:id/toggle — admin toggles per-org enable/disable. */
export async function toggleProbe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const probeId = req.params.id;
    const { disabled } = ToggleProbeSchema.parse(req.body);
    const probe = await prisma.probe.findUnique({ where: { id: probeId } });
    if (!probe) throw new Error('probe not found');
    const org = await prisma.org.findUnique({ where: { id: orgId }, select: { disabledProbeIds: true } });
    const current = new Set(org?.disabledProbeIds ?? []);
    if (disabled) current.add(probeId);
    else current.delete(probeId);
    await prisma.org.update({
      where: { id: orgId },
      data: { disabledProbeIds: [...current] },
    });
    await auditFromRequest(req, {
      action: disabled ? 'probe.disable' : 'probe.enable',
      targetType: 'probe',
      targetId: probeId,
      metadata: { slug: probe.slug },
    });
    res.json({ ok: true, disabled });
  } catch (err) { next(err); }
}

/** GET /api/security-engine/probes — paginated list with filters. Org-disabled probes are flagged. */
export async function listProbes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const q = ListProbesQuery.parse(req.query);
    const pageSize = q.limit ?? q.pageSize;
    const page = q.page;

    const where: Record<string, unknown> = { enabled: true };
    if (q.category) where.category = q.category;
    if (q.severity) where.severity = q.severity;
    if (q.source) where.source = q.source;
    if (q.applicability) where.applicability = { has: q.applicability };
    if (q.probeIds) where.id = { in: q.probeIds.split(',').filter(Boolean) };
    if (q.search) where.OR = [
      { title: { contains: q.search, mode: 'insensitive' } },
      { description: { contains: q.search, mode: 'insensitive' } },
      { slug: { contains: q.search, mode: 'insensitive' } },
    ];
    if (q.framework || q.controlId) {
      where.complianceMappings = {
        some: {
          ...(q.framework ? { framework: q.framework } : {}),
          ...(q.controlId ? { controlId: q.controlId } : {}),
        },
      };
    }

    const [probes, total] = await Promise.all([
      prismaRead.probe.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ severity: 'desc' }, { source: 'asc' }, { slug: 'asc' }],
        include: { complianceMappings: true },
      }),
      prismaRead.probe.count({ where }),
    ]);

    const org = await prisma.org.findUnique({ where: { id: orgId }, select: { disabledProbeIds: true } });
    const disabled = new Set(org?.disabledProbeIds ?? []);
    res.json({
      probes: probes.map((p) => ({ ...p, orgDisabled: disabled.has(p.id) })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      count: probes.length,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/security-engine/probes/facets — distinct values for filter dropdowns. */
export async function listProbeFacets(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const where = { enabled: true };
    const [sources, categories, frameworks] = await Promise.all([
      prismaRead.probe.findMany({ where, distinct: ['source'], select: { source: true }, orderBy: { source: 'asc' } }),
      prismaRead.probe.findMany({ where, distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } }),
      prismaRead.probeComplianceMapping.findMany({ distinct: ['framework'], select: { framework: true }, orderBy: { framework: 'asc' } }),
    ]);
    res.json({
      sources: sources.map((p) => p.source),
      categories: categories.map((p) => p.category),
      frameworks: frameworks.map((p) => p.framework),
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/security-engine/strategies — list. */
export async function listStrategies(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const strategies = await prisma.strategy.findMany({
      where: { enabled: true },
      orderBy: [{ family: 'asc' }, { slug: 'asc' }],
    });
    res.json({ strategies, count: strategies.length });
  } catch (err) {
    next(err);
  }
}

/** GET /api/security-engine/detectors — list. */
export async function listDetectors(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const detectors = await prisma.detector.findMany({
      where: { enabled: true },
      orderBy: [{ kind: 'asc' }, { slug: 'asc' }],
    });
    res.json({ detectors, count: detectors.length });
  } catch (err) {
    next(err);
  }
}

/** GET /api/security-engine/verticals — list packs with resolved probe titles. */
export async function listVerticals(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const packs = await prisma.verticalPack.findMany({
      where: { enabled: true },
      orderBy: [{ slug: 'asc' }],
    });
    const allIds = [...new Set(packs.flatMap((p) => p.probeIds))];
    const probes = allIds.length
      ? await prisma.probe.findMany({
          where: { id: { in: allIds } },
          select: { id: true, slug: true, title: true, severity: true, category: true },
        })
      : [];
    const byId = new Map(probes.map((p) => [p.id, p]));
    res.json({
      verticals: packs.map((pack) => ({
        ...pack,
        probes: pack.probeIds.map((id) => byId.get(id)).filter(Boolean),
      })),
      count: packs.length,
    });
  } catch (err) {
    next(err);
  }
}

const PromoteDatasetItemSchema = z.object({
  datasetItemId: z.string().min(1),
  category: z.string().min(1),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  applicability: z.array(z.string()).optional(),
  defaultDetectorIds: z.array(z.string()).optional(),
  title: z.string().min(1).optional(),
});

/**
 * POST /api/security-engine/datasets/promote — turn a `DatasetItem` row into
 * a `Probe`. The new probe is sourced as `cortexview` (since it's curated by
 * the operator) and points back at the originating dataset item.
 */
export async function promoteDatasetItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = PromoteDatasetItemSchema.parse(req.body);
    const item = await prisma.datasetItem.findUnique({
      where: { id: body.datasetItemId },
      include: { dataset: true },
    });
    if (!item) throw new Error(`dataset item ${body.datasetItemId} not found`);
    if (item.probeId) {
      throw new Error('this dataset item is already linked to a probe');
    }
    const slug = `cortexview.${item.dataset.source}.${item.externalId.toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 80)}`;
    const titleFallback = item.payload.slice(0, 80) + (item.payload.length > 80 ? '…' : '');
    const probe = await prisma.probe.create({
      data: {
        slug,
        source: 'cortexview',
        category: body.category,
        severity: body.severity,
        title: body.title ?? `${item.dataset.source}: ${titleFallback}`,
        description: `Promoted from ${item.dataset.source}@${item.dataset.version} item ${item.externalId}.`,
        seedPayload: item.payload,
        applicability: body.applicability ?? ['chatbot', 'rag'],
        defaultDetectorIds: body.defaultDetectorIds ?? ['regex.refusal_keywords', 'llm_judge.cv_evaluator'],
        metadata: { promotedFromDatasetItemId: item.id, datasetSource: item.dataset.source } as never,
      },
    });
    await prisma.datasetItem.update({
      where: { id: item.id },
      data: { probeId: probe.id },
    });
    await auditFromRequest(req, {
      action: 'probe.promoted_from_dataset',
      targetType: 'probe',
      targetId: probe.id,
      metadata: { datasetItemId: item.id, datasetSource: item.dataset.source },
    });
    res.status(201).json(probe);
  } catch (err) { next(err); }
}

function normaliseSeverity(raw: string | null | undefined): 'low' | 'medium' | 'high' | 'critical' {
  const s = (raw ?? '').toLowerCase();
  if (s.includes('critical') || s.includes('severe')) return 'critical';
  if (s.includes('high')) return 'high';
  if (s.includes('low') || s.includes('minor')) return 'low';
  return 'medium';
}

/**
 * POST /api/security-engine/datasets/promote-all?source=harmbench — promote all
 * unpromoted items from the latest snapshot of a dataset into Probes.
 */
export async function promoteDatasetSource(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const source = String(req.query.source ?? '').toLowerCase();
    if (!source) throw new Error('source query param is required');
    const snapshot = await prisma.datasetSnapshot.findFirst({
      where: { source },
      orderBy: { fetchedAt: 'desc' },
    });
    if (!snapshot) throw new Error(`no snapshot found for source "${source}" — refresh first`);
    const items = await prisma.datasetItem.findMany({
      where: { datasetSnapshotId: snapshot.id, probeId: null },
    });
    let promoted = 0;
    for (const item of items) {
      const slug = `cortexview.${source}.${item.externalId.toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 80)}`;
      const exists = await prisma.probe.findUnique({ where: { slug } });
      if (exists) {
        await prisma.datasetItem.update({ where: { id: item.id }, data: { probeId: exists.id } });
        continue;
      }
      const titleFallback = item.payload.slice(0, 80) + (item.payload.length > 80 ? '…' : '');
      const probe = await prisma.probe.create({
        data: {
          slug,
          source: 'cortexview',
          category: item.category ?? 'misc',
          severity: normaliseSeverity(item.expectedHarm),
          title: `${source}: ${titleFallback}`,
          description: `Promoted from ${source}@${snapshot.version} item ${item.externalId}.`,
          seedPayload: item.payload,
          applicability: ['chatbot', 'rag'],
          defaultDetectorIds: ['regex.refusal_keywords', 'llm_judge.cv_evaluator'],
          metadata: { promotedFromDatasetItemId: item.id, datasetSource: source } as never,
        },
      });
      await prisma.datasetItem.update({ where: { id: item.id }, data: { probeId: probe.id } });
      promoted++;
    }
    await auditFromRequest(req, {
      action: 'dataset.promote_all',
      targetType: 'dataset',
      targetId: snapshot.id,
      metadata: { source, snapshotId: snapshot.id, promoted, totalCandidates: items.length },
    });
    res.json({ ok: true, source, promoted, totalCandidates: items.length, snapshotVersion: snapshot.version });
  } catch (err) { next(err); }
}

/** GET /api/security-engine/datasets/:source/items — paginated dataset items for promotion UI. */
export async function listDatasetItems(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const source = req.params.source;
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
    const cursor = req.query.cursor as string | undefined;
    const items = await prismaRead.datasetItem.findMany({
      where: { dataset: { source } },
      orderBy: { id: 'asc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, externalId: true, payload: true, category: true,
        expectedHarm: true, probeId: true,
        dataset: { select: { source: true, version: true } },
      },
    });
    const nextCursor = items.length > limit ? items[limit].id : null;
    res.json({ items: items.slice(0, limit), nextCursor });
  } catch (err) { next(err); }
}

/** GET /api/security-engine/datasets — list all dataset snapshots (admin). */
export async function listDatasets(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const datasets = await prisma.datasetSnapshot.findMany({
      orderBy: { fetchedAt: 'desc' },
      select: { id: true, source: true, version: true, itemCount: true, fetchedAt: true, licenseUrl: true, citation: true },
    });
    res.json({ datasets });
  } catch (err) { next(err); }
}

/** POST /api/security-engine/datasets/refresh?source=harmbench — fetch + snapshot. */
export async function refreshDataset(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const source = String(req.query.source ?? '').toLowerCase();
    let result: { snapshotId: string; itemCount: number };
    switch (source) {
      case 'harmbench':
        result = await fetchHarmBench();
        break;
      case 'advbench':
        result = await fetchAdvBench();
        break;
      case 'donotanswer':
        result = await fetchDoNotAnswer();
        break;
      case 'cybersec_eval':
        result = await fetchCyberSecEval();
        break;
      default:
        throw new Error(`unsupported source "${source}" — supported: harmbench, advbench, donotanswer, cybersec_eval`);
    }
    await auditFromRequest(req, {
      action: 'dataset.fetch.success',
      targetType: 'dataset',
      targetId: result.snapshotId,
      metadata: { source, itemCount: result.itemCount },
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    await auditFromRequest(req, { action: 'dataset.fetch.failure', metadata: { error: err instanceof Error ? err.message : String(err) } });
    next(err);
  }
}

const DryRunSchema = z.object({
  agentId: z.string(),
  probeSlug: z.string().optional(),
  payload: z.string().optional(),
  strategyChain: z.array(z.string()).optional(),
  strategyParams: z.record(z.record(z.unknown())).optional(),
  orchestrator: z.enum(['single', 'crescendo', 'skeleton_key', 'tap', 'goat', 'model_extraction', 'membership_inference', 'training_data_replay']).default('single'),
  maxTurns: z.number().int().min(1).max(20).optional(),
  translateLanguage: z.string().optional(),
});

/** POST /api/security-engine/dry-run — preview a probe×strategy chain against a target without committing a TestRun. */
export async function dryRun(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const body = DryRunSchema.parse(req.body);
    const agent = await prisma.agent.findFirst({ where: { id: body.agentId, orgId } });
    if (!agent) throw new Error('agent not found in your org');

    let seed = body.payload ?? '';
    if (body.probeSlug) {
      const p = await prisma.probe.findUnique({ where: { slug: body.probeSlug } });
      if (!p) throw new Error(`probe ${body.probeSlug} not found`);
      seed = p.seedPayload;
    }
    if (!seed) throw new Error('either probeSlug or payload is required');

    if (body.translateLanguage) {
      seed = await translatePayload(orgId, seed, body.translateLanguage);
    }
    if (body.strategyChain && body.strategyChain.length > 0) {
      seed = applyStrategyChain(seed, body.strategyChain, body.strategyParams ?? {});
    }

    const threadId = `dryrun_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (body.orchestrator === 'crescendo') {
      const out = await crescendoOrchestrator({ orgId, targetAgentId: agent.id, seed, threadId, maxTurns: body.maxTurns });
      await auditFromRequest(req, {
        action: 'engine.dry_run',
        metadata: { orchestrator: 'crescendo', probeSlug: body.probeSlug, succeeded: out.succeeded, turnsUsed: out.turnsUsed },
      });
      res.json({ orchestrator: 'crescendo', threadId, ...out });
      return;
    }
    if (body.orchestrator === 'skeleton_key') {
      const out = await skeletonKeyOrchestrator({ orgId, targetAgentId: agent.id, seed, threadId });
      await auditFromRequest(req, {
        action: 'engine.dry_run',
        metadata: { orchestrator: 'skeleton_key', probeSlug: body.probeSlug, succeeded: out.succeeded },
      });
      res.json({ orchestrator: 'skeleton_key', threadId, ...out });
      return;
    }
    if (body.orchestrator === 'tap') {
      const out = await tapOrchestrator({ orgId, targetAgentId: agent.id, seed, threadId, maxTurns: body.maxTurns });
      await auditFromRequest(req, {
        action: 'engine.dry_run',
        metadata: { orchestrator: 'tap', probeSlug: body.probeSlug, succeeded: out.succeeded, turnsUsed: out.turnsUsed },
      });
      res.json({ orchestrator: 'tap', threadId, ...out });
      return;
    }
    if (body.orchestrator === 'goat') {
      const out = await goatOrchestrator({ orgId, targetAgentId: agent.id, seed, threadId, maxTurns: body.maxTurns });
      await auditFromRequest(req, {
        action: 'engine.dry_run',
        metadata: { orchestrator: 'goat', probeSlug: body.probeSlug, succeeded: out.succeeded, turnsUsed: out.turnsUsed },
      });
      res.json({ orchestrator: 'goat', threadId, ...out });
      return;
    }
    if (body.orchestrator === 'model_extraction') {
      const out = await modelExtractionOrchestrator({ orgId, targetAgentId: agent.id, seed, threadId, maxTurns: body.maxTurns });
      await auditFromRequest(req, {
        action: 'engine.dry_run',
        metadata: { orchestrator: 'model_extraction', succeeded: out.succeeded, turnsUsed: out.turnsUsed },
      });
      res.json({ orchestrator: 'model_extraction', threadId, ...out });
      return;
    }
    if (body.orchestrator === 'membership_inference') {
      const out = await membershipInferenceOrchestrator({ orgId, targetAgentId: agent.id, seed, threadId, maxTurns: body.maxTurns });
      await auditFromRequest(req, {
        action: 'engine.dry_run',
        metadata: { orchestrator: 'membership_inference', succeeded: out.succeeded, turnsUsed: out.turnsUsed },
      });
      res.json({ orchestrator: 'membership_inference', threadId, ...out });
      return;
    }
    if (body.orchestrator === 'training_data_replay') {
      const out = await trainingDataReplayOrchestrator({ orgId, targetAgentId: agent.id, seed, threadId, maxTurns: body.maxTurns });
      await auditFromRequest(req, {
        action: 'engine.dry_run',
        metadata: { orchestrator: 'training_data_replay', succeeded: out.succeeded, turnsUsed: out.turnsUsed },
      });
      res.json({ orchestrator: 'training_data_replay', threadId, ...out });
      return;
    }

    // Single-turn: just send the transformed payload.
    const { sendToAgent } = await import('../services/agentConnector');
    const response = await sendToAgent(agent, seed);
    await auditFromRequest(req, {
      action: 'engine.dry_run',
      metadata: { orchestrator: 'single', probeSlug: body.probeSlug },
    });
    res.json({ orchestrator: 'single', transformedPayload: seed, response });
  } catch (err) { next(err); }
}

/** GET /api/security-engine/compliance/heatmap — cross-tab framework × probe coverage. */
export async function complianceHeatmap(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const allMappings = await prismaRead.probeComplianceMapping.findMany({
      include: { probe: { select: { id: true, slug: true, title: true, severity: true, source: true } } },
    });

    const heatmap: Record<string, Record<string, { control: { id: string; title: string; shortDescription: string }; probes: typeof allMappings[number]['probe'][] }>> = {};
    for (const fwKey of Object.keys(FRAMEWORK_REGISTRY) as FrameworkKey[]) {
      heatmap[fwKey] = {};
      for (const ctrl of FRAMEWORK_REGISTRY[fwKey]) {
        heatmap[fwKey][ctrl.id] = { control: ctrl, probes: [] };
      }
    }
    for (const m of allMappings) {
      if (!heatmap[m.framework]) continue;
      if (!heatmap[m.framework][m.controlId]) {
        heatmap[m.framework][m.controlId] = {
          control: { id: m.controlId, title: m.controlId, shortDescription: '(custom mapping)' },
          probes: [],
        };
      }
      heatmap[m.framework][m.controlId].probes.push(m.probe);
    }

    res.json({ heatmap });
  } catch (err) {
    next(err);
  }
}
