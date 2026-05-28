import axios from 'axios';
import { safeHttpsAgent } from '../../../lib/urlValidation';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';

/**
 * CyberSecEval — Meta's PurpleLlama benchmark suite for LLM cybersecurity
 * risk. Spans multiple JSON files; we pull two representative subsets that
 * are widely cited and don't require model-specific generation:
 *
 *   - mitre_benchmark_100_per_category_with_augmentation_filtered.json
 *     (the MITRE ATT&CK-aligned attack-prompt set)
 *   - prompt_injection.json (basic + indirect prompt-injection cases)
 *
 * License: LLAMA-2 community license. Attribute back to Meta-Llama PurpleLlama.
 */

const REPO_BASE = 'https://raw.githubusercontent.com/meta-llama/PurpleLlama/main/CybersecurityBenchmarks/datasets';
const VERSION = 'main-2024-mitre-and-injection';

interface MitreItem {
  prompt: string;
  test_case_prompt?: string;
  mitre_category?: string;
  category?: string;
  mutated_prompt?: string;
  // ...other upstream fields ignored
}

interface InjectionItem {
  test_case_prompt: string;
  user_input?: string;
  judge_question?: string;
  injection_type?: string;
  injection_variant?: string;
  risk_category?: string;
}

async function fetchJson<T>(url: string): Promise<T[]> {
  try {
    const res = await axios.get<T[]>(url, { timeout: 60_000, maxContentLength: 100 * 1024 * 1024, maxBodyLength: 100 * 1024 * 1024, httpsAgent: safeHttpsAgent(), maxRedirects: 0, responseType: 'json' });
    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    logger.warn({ err, url }, 'CyberSecEval fetch failed for one shard');
    return [];
  }
}

export async function fetchCyberSecEval(): Promise<{ snapshotId: string; itemCount: number }> {
  const existing = await prisma.datasetSnapshot.findUnique({
    where: { source_version: { source: 'cybersec_eval', version: VERSION } },
  });
  if (existing) {
    logger.info({ id: existing.id, items: existing.itemCount }, 'CyberSecEval snapshot present; skipping');
    return { snapshotId: existing.id, itemCount: existing.itemCount };
  }

  const [mitre, injection] = await Promise.all([
    fetchJson<MitreItem>(`${REPO_BASE}/mitre/mitre_benchmark_100_per_category_with_augmentation_filtered.json`),
    fetchJson<InjectionItem>(`${REPO_BASE}/prompt_injection/prompt_injection.json`),
  ]);

  const total = mitre.length + injection.length;
  if (total === 0) throw new Error('CyberSecEval fetch produced zero items across all shards');

  const snapshot = await prisma.datasetSnapshot.create({
    data: {
      source: 'cybersec_eval',
      version: VERSION,
      itemCount: total,
      licenseUrl: 'https://github.com/meta-llama/PurpleLlama/blob/main/LICENSE',
      citation: 'Bhatt et al. "CyberSecEval: A Benchmark for Cybersecurity Risk in LLMs." 2023–2024.',
    },
  });

  const items: { datasetSnapshotId: string; externalId: string; payload: string; expectedHarm: string | null; category: string | null; metadata: never }[] = [];

  mitre.forEach((row, i) => {
    const payload = (row.mutated_prompt ?? row.test_case_prompt ?? row.prompt ?? '').trim();
    if (!payload) return;
    items.push({
      datasetSnapshotId: snapshot.id,
      externalId: `cse-mitre-${String(i + 1).padStart(5, '0')}`,
      payload,
      expectedHarm: row.mitre_category ?? null,
      category: row.category ?? 'mitre_attack',
      metadata: { shard: 'mitre', mitre_category: row.mitre_category } as never,
    });
  });

  injection.forEach((row, i) => {
    const payload = (row.test_case_prompt ?? row.user_input ?? '').trim();
    if (!payload) return;
    items.push({
      datasetSnapshotId: snapshot.id,
      externalId: `cse-injection-${String(i + 1).padStart(5, '0')}`,
      payload,
      expectedHarm: row.risk_category ?? row.injection_type ?? null,
      category: row.injection_type ?? 'prompt_injection',
      metadata: {
        shard: 'prompt_injection',
        judge_question: row.judge_question,
        variant: row.injection_variant,
      } as never,
    });
  });

  // Bulk insert in chunks.
  const CHUNK = 1000;
  let inserted = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK);
    const out = await prisma.datasetItem.createMany({ data: slice, skipDuplicates: true });
    inserted += out.count;
  }
  logger.info({ snapshotId: snapshot.id, inserted, total: items.length, mitreCount: mitre.length, injectionCount: injection.length }, 'CyberSecEval fetched');
  return { snapshotId: snapshot.id, itemCount: inserted };
}
