import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { ProbeDefinition } from './types';
import { CORTEXVIEW_CURATED_PROBES } from './probes/loaders/cortexviewCurated';
import { STRATEGY_DEFS } from './strategies/seeds';
import { DETECTOR_DEFS } from './detectors/seeds';
import { VERTICAL_PACKS } from './verticals/seeds';

/**
 * Idempotent seeder for the Security Engine: probes, strategies, detectors,
 * vertical packs, and probe→framework compliance mappings. Safe to re-run —
 * uses upsert by slug everywhere.
 */

function allProbeDefs(): ProbeDefinition[] {
  return [...CORTEXVIEW_CURATED_PROBES];
}

async function seedProbes(): Promise<Map<string, string>> {
  const slugToId = new Map<string, string>();
  for (const def of allProbeDefs()) {
    const row = await prisma.probe.upsert({
      where: { slug: def.slug },
      create: {
        slug: def.slug,
        source: def.source,
        version: def.version ?? 1,
        category: def.category,
        subcategory: def.subcategory ?? null,
        severity: def.severity,
        title: def.title,
        description: def.description,
        seedPayload: def.seedPayload,
        expectedFailIndicators: def.expectedFailIndicators ?? [],
        expectedPassIndicators: def.expectedPassIndicators ?? [],
        applicability: def.applicability ?? [],
        defaultDetectorIds: def.defaultDetectorIds ?? [],
        defaultStrategies: def.defaultStrategies ?? [],
        metadata: (def.metadata ?? undefined) as never,
      },
      update: {
        source: def.source,
        version: def.version ?? 1,
        category: def.category,
        subcategory: def.subcategory ?? null,
        severity: def.severity,
        title: def.title,
        description: def.description,
        seedPayload: def.seedPayload,
        expectedFailIndicators: def.expectedFailIndicators ?? [],
        expectedPassIndicators: def.expectedPassIndicators ?? [],
        applicability: def.applicability ?? [],
        defaultDetectorIds: def.defaultDetectorIds ?? [],
        defaultStrategies: def.defaultStrategies ?? [],
        metadata: (def.metadata ?? undefined) as never,
      },
    });
    slugToId.set(def.slug, row.id);
  }
  return slugToId;
}

async function seedStrategies(): Promise<void> {
  for (const def of STRATEGY_DEFS) {
    await prisma.strategy.upsert({
      where: { slug: def.slug },
      create: {
        slug: def.slug,
        family: def.family,
        kind: def.kind,
        title: def.title,
        description: def.description,
        implFn: def.implFn ?? null,
        orchestratorClass: def.orchestratorClass ?? null,
        paramSchema: (def.paramSchema ?? undefined) as never,
        defaultParams: (def.defaultParams ?? undefined) as never,
      },
      update: {
        family: def.family,
        kind: def.kind,
        title: def.title,
        description: def.description,
        implFn: def.implFn ?? null,
        orchestratorClass: def.orchestratorClass ?? null,
        paramSchema: (def.paramSchema ?? undefined) as never,
        defaultParams: (def.defaultParams ?? undefined) as never,
      },
    });
  }
}

async function seedDetectors(): Promise<void> {
  for (const def of DETECTOR_DEFS) {
    await prisma.detector.upsert({
      where: { slug: def.slug },
      create: {
        slug: def.slug,
        kind: def.kind,
        title: def.title,
        description: def.description,
        config: def.config as never,
      },
      update: {
        kind: def.kind,
        title: def.title,
        description: def.description,
        config: def.config as never,
      },
    });
  }
}

async function seedComplianceMappings(slugToId: Map<string, string>): Promise<void> {
  // Wipe-and-resow so removing a tag from the loader removes the row.
  const probeIds = [...slugToId.values()];
  if (probeIds.length === 0) return;
  await prisma.probeComplianceMapping.deleteMany({ where: { probeId: { in: probeIds } } });

  const rows: { probeId: string; framework: string; controlId: string; notes: string | null }[] = [];
  for (const def of allProbeDefs()) {
    const probeId = slugToId.get(def.slug);
    if (!probeId) continue;
    for (const tag of def.compliance ?? []) {
      rows.push({ probeId, framework: tag.framework, controlId: tag.controlId, notes: tag.notes ?? null });
    }
  }
  if (rows.length === 0) return;
  // createMany skipDuplicates because (probeId, framework, controlId) is unique.
  await prisma.probeComplianceMapping.createMany({ data: rows, skipDuplicates: true });
}

async function seedVerticalPacks(slugToId: Map<string, string>): Promise<void> {
  for (const pack of VERTICAL_PACKS) {
    const probeIds = pack.probeSlugs
      .map((slug) => slugToId.get(slug))
      .filter((id): id is string => !!id);
    await prisma.verticalPack.upsert({
      where: { slug: pack.slug },
      create: {
        slug: pack.slug,
        title: pack.title,
        description: pack.description,
        probeIds,
        recommendedStrategies: pack.recommendedStrategies,
      },
      update: {
        title: pack.title,
        description: pack.description,
        probeIds,
        recommendedStrategies: pack.recommendedStrategies,
      },
    });
  }
}

export async function seedSecurityEngine(): Promise<{
  probes: number;
  strategies: number;
  detectors: number;
  verticals: number;
  mappings: number;
}> {
  const slugToId = await seedProbes();
  await seedStrategies();
  await seedDetectors();
  await seedComplianceMappings(slugToId);
  await seedVerticalPacks(slugToId);
  const [probes, strategies, detectors, verticals, mappings] = await Promise.all([
    prisma.probe.count(),
    prisma.strategy.count(),
    prisma.detector.count(),
    prisma.verticalPack.count(),
    prisma.probeComplianceMapping.count(),
  ]);
  logger.info({ probes, strategies, detectors, verticals, mappings }, 'security engine seed complete');
  return { probes, strategies, detectors, verticals, mappings };
}
