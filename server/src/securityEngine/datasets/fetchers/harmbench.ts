import axios from 'axios';
import { safeHttpsAgent } from '../../../lib/urlValidation';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';

/**
 * HarmBench dataset fetcher (https://github.com/centerforaisafety/HarmBench).
 * Pulls the open behaviour CSV from the upstream repo, parses it, and
 * snapshots into DatasetSnapshot + DatasetItem rows.
 *
 * Operator-triggered only — never runs automatically. License: MIT (cite below).
 */

const HARMBENCH_URL = 'https://raw.githubusercontent.com/centerforaisafety/HarmBench/main/data/behavior_datasets/harmbench_behaviors_text_all.csv';
const HARMBENCH_VERSION = 'main-2024-text';

interface CsvRow {
  Behavior: string;
  FunctionalCategory: string;
  SemanticCategory: string;
  Tags: string;
  ContextString?: string;
  BehaviorID: string;
  [k: string]: string | undefined;
}

function parseCsv(text: string): CsvRow[] {
  // Lightweight CSV parser — handles quoted fields with embedded commas.
  const lines: string[] = [];
  let buf = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    if (c === '\n' && !inQuotes) {
      lines.push(buf);
      buf = '';
    } else {
      buf += c;
    }
  }
  if (buf.length > 0) lines.push(buf);
  if (lines.length === 0) return [];

  function splitRow(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (q && line[i + 1] === '"') { cur += '"'; i++; continue; }
        q = !q;
      } else if (c === ',' && !q) {
        out.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out;
  }

  const headers = splitRow(lines[0]).map((h) => h.trim());
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = splitRow(lines[i]);
    const row: CsvRow = {} as CsvRow;
    headers.forEach((h, idx) => { (row as Record<string, string>)[h] = (cells[idx] ?? '').trim(); });
    if (row.Behavior && row.BehaviorID) rows.push(row);
  }
  return rows;
}

export async function fetchHarmBench(): Promise<{ snapshotId: string; itemCount: number }> {
  // Idempotent: if this version exists, return its existing snapshot.
  const existing = await prisma.datasetSnapshot.findUnique({
    where: { source_version: { source: 'harmbench', version: HARMBENCH_VERSION } },
  });
  if (existing) {
    logger.info({ id: existing.id, items: existing.itemCount }, 'HarmBench snapshot already present; skipping fetch');
    return { snapshotId: existing.id, itemCount: existing.itemCount };
  }

  const res = await axios.get<string>(HARMBENCH_URL, { responseType: 'text', timeout: 60_000, maxContentLength: 100 * 1024 * 1024, maxBodyLength: 100 * 1024 * 1024, httpsAgent: safeHttpsAgent(), maxRedirects: 0 });
  const rows = parseCsv(res.data);
  if (rows.length === 0) throw new Error('HarmBench CSV parsed to zero rows');

  const snapshot = await prisma.datasetSnapshot.create({
    data: {
      source: 'harmbench',
      version: HARMBENCH_VERSION,
      itemCount: rows.length,
      licenseUrl: 'https://github.com/centerforaisafety/HarmBench/blob/main/LICENSE',
      citation: 'Mazeika et al. "HarmBench: A Standardized Evaluation Framework for Automated Red Teaming and Robust Refusal." 2024.',
    },
  });

  // Bulk-insert items via createMany (skipDuplicates handles re-runs gracefully).
  const items = rows.map((r) => ({
    datasetSnapshotId: snapshot.id,
    externalId: r.BehaviorID,
    payload: r.Behavior,
    expectedHarm: r.FunctionalCategory,
    category: r.SemanticCategory,
    metadata: { tags: r.Tags, context: r.ContextString } as never,
  }));

  // Postgres has a parameter limit; chunk into batches of 1000.
  const CHUNK = 1000;
  let inserted = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK);
    const result = await prisma.datasetItem.createMany({ data: slice, skipDuplicates: true });
    inserted += result.count;
  }
  logger.info({ snapshotId: snapshot.id, inserted, total: items.length }, 'HarmBench fetched');
  return { snapshotId: snapshot.id, itemCount: inserted };
}
