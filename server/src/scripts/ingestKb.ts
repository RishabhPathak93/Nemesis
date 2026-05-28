/**
 * Bulk-ingest a CortexView knowledge-base JSON file into the unified
 * `Probe` table. Idempotent: re-running upserts by `slug` (derived from the
 * test-case `id`).
 *
 *   npx tsx src/scripts/ingestKb.ts ../cortexview_kb.json
 *
 * Optional flags:
 *   --source "<label>"   Override the persisted `source` label. Default: "cortexview_kb".
 *   --truncate           Wipe rows with the chosen source label before importing.
 *
 * Each test case in the JSON becomes a Probe row. Per-payload variations are
 * stored in Probe.metadata.variations[]; framework alignment goes into
 * ProbeComplianceMapping rows.
 */
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';

interface RawTestCase {
  id: string;
  title: string;
  category: string;
  subcategory?: string;
  frameworks?: Record<string, unknown>;
  severity: string;
  cvss_estimate?: number | string;
  target?: string[];
  attack_vector?: string;
  preconditions?: string;
  description: string;
  payloads?: string[];
  variations?: string[];
  expected_vulnerable_behavior?: string;
  expected_safe_behavior?: string;
  detection_signatures?: Record<string, unknown>;
  automation_hints?: Record<string, unknown>;
  mitigations?: string[];
  references?: string[];
}

interface RawKb {
  knowledge_base: {
    name?: string;
    version?: string;
    schema_version?: string;
    generated_on?: string;
    total_test_cases?: number;
    vendor?: string;
    description?: string;
  };
  test_cases: RawTestCase[];
}

function parseArgs(argv: string[]): { file: string; source: string; truncate: boolean } {
  const args = argv.slice(2);
  let file: string | null = null;
  let source = 'cortexview_kb';
  let truncate = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--source') source = args[++i] ?? source;
    else if (a === '--truncate') truncate = true;
    else if (!a.startsWith('--')) file = a;
  }
  if (!file) {
    console.error('Usage: tsx src/scripts/ingestKb.ts <kb.json> [--source <label>] [--truncate]');
    process.exit(1);
  }
  return { file, source, truncate };
}

function normaliseSeverity(v: string): string {
  const s = String(v || 'low').toLowerCase();
  return ['critical', 'high', 'medium', 'low', 'informational'].includes(s) ? s : 'medium';
}

function frameworkRows(externalId: string, fws: Record<string, unknown> | undefined): { framework: string; controlId: string }[] {
  if (!fws || typeof fws !== 'object') return [];
  const out: { framework: string; controlId: string }[] = [];
  for (const [k, v] of Object.entries(fws)) {
    const fw =
      k === 'owasp_llm_top10_2025' ? 'OWASP_LLM_TOP10' :
      k === 'mitre_atlas' ? 'MITRE_ATLAS' :
      k === 'nist_ai_100_2' ? 'NIST_AI_RMF' :
      k === 'eu_ai_act' ? 'EU_AI_ACT' :
      k === 'owasp_api_top10' ? 'OWASP_API_TOP10' :
      k.toUpperCase();
    if (Array.isArray(v)) {
      for (const id of v) out.push({ framework: fw, controlId: String(id) });
    } else if (typeof v === 'string') {
      out.push({ framework: fw, controlId: v });
    }
    void externalId;
  }
  return out;
}

async function main(): Promise<void> {
  const { file, source, truncate } = parseArgs(process.argv);
  const absFile = path.resolve(file);
  if (!fs.existsSync(absFile)) {
    console.error(`File not found: ${absFile}`);
    process.exit(1);
  }
  const raw: RawKb = JSON.parse(fs.readFileSync(absFile, 'utf8'));
  if (!raw.knowledge_base || !Array.isArray(raw.test_cases)) {
    console.error('Unexpected JSON shape — expected { knowledge_base, test_cases[] }.');
    process.exit(1);
  }

  console.log(`Ingesting ${raw.test_cases.length} cases from "${raw.knowledge_base.name ?? 'unnamed'}" v${raw.knowledge_base.version ?? '?'}`);
  console.log(`  → source label: ${source}`);

  if (truncate) {
    const removed = await prisma.probe.deleteMany({ where: { source } });
    console.log(`  → truncated ${removed.count} existing Probe rows with source=${source}`);
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let mappings = 0;

  for (const tc of raw.test_cases) {
    if (!tc.id || !tc.title || !tc.category || !tc.description) {
      skipped++;
      continue;
    }
    const slug = `${source}.${tc.id.toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 80)}`;
    const seedPayload = (tc.payloads ?? [])[0] ?? tc.description;
    const data = {
      slug,
      source,
      category: tc.category,
      subcategory: tc.subcategory ?? null,
      severity: normaliseSeverity(tc.severity),
      title: tc.title,
      description: tc.description,
      seedPayload,
      applicability: Array.isArray(tc.target) ? tc.target.map(String) : ['chatbot'],
      expectedPassIndicators: tc.expected_safe_behavior ? [tc.expected_safe_behavior] : [],
      expectedFailIndicators: tc.expected_vulnerable_behavior ? [tc.expected_vulnerable_behavior] : [],
      defaultDetectorIds: ['llm_judge.cv_evaluator'],
      metadata: {
        externalId: tc.id,
        cvssEstimate: tc.cvss_estimate,
        attackVector: tc.attack_vector,
        preconditions: tc.preconditions,
        variations: tc.variations ?? [],
        detectionSignatures: tc.detection_signatures,
        automationHints: tc.automation_hints,
        mitigations: tc.mitigations ?? [],
        references: tc.references ?? [],
      } as never,
    };

    const existing = await prisma.probe.findUnique({ where: { slug } });
    let probeId: string;
    if (existing) {
      const u = await prisma.probe.update({ where: { slug }, data });
      probeId = u.id;
      updated++;
    } else {
      const c = await prisma.probe.create({ data });
      probeId = c.id;
      inserted++;
    }

    // Framework mappings → ProbeComplianceMapping rows.
    const fws = frameworkRows(tc.id, tc.frameworks);
    if (fws.length > 0) {
      await prisma.probeComplianceMapping.deleteMany({ where: { probeId } });
      await prisma.probeComplianceMapping.createMany({
        data: fws.map((f) => ({ probeId, framework: f.framework, controlId: f.controlId })),
        skipDuplicates: true,
      });
      mappings += fws.length;
    }

    if ((inserted + updated) % 50 === 0) {
      process.stdout.write(`  … ${inserted + updated}/${raw.test_cases.length}\r`);
    }
  }
  process.stdout.write(`  … ${inserted + updated}/${raw.test_cases.length}\n`);

  const totalForSource = await prisma.probe.count({ where: { source } });
  const totalAll = await prisma.probe.count();
  console.log('');
  console.log(`Done. Inserted=${inserted}, updated=${updated}, skipped=${skipped}, complianceMappings=${mappings}.`);
  console.log(`Probe row counts: source=${source} → ${totalForSource}, total → ${totalAll}.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Ingest failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
