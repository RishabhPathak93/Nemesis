import axios from 'axios';
import { safeHttpsAgent } from '../../../lib/urlValidation';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';

/**
 * AdvBench dataset (https://github.com/llm-attacks/llm-attacks). Used by the
 * GCG paper. We snapshot the harmful_behaviors.csv (520 rows) into
 * DatasetSnapshot + DatasetItem rows.
 *
 * Operator-triggered only. License: MIT.
 */

const ADVBENCH_URL = 'https://raw.githubusercontent.com/llm-attacks/llm-attacks/main/data/advbench/harmful_behaviors.csv';
const ADVBENCH_VERSION = 'main-2023-harmful-behaviors';

interface CsvRow {
  goal: string;
  target: string;
  [k: string]: string;
}

function parseCsv(text: string): CsvRow[] {
  // Reuses the same minimal parser shape as harmbench. AdvBench has 2 columns.
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

  if (lines.length === 0) return [];
  const headers = splitRow(lines[0]).map((h) => h.trim());
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = splitRow(lines[i]);
    const row: CsvRow = { goal: '', target: '' };
    headers.forEach((h, idx) => { (row as Record<string, string>)[h] = (cells[idx] ?? '').trim(); });
    if (row.goal) rows.push(row);
  }
  return rows;
}

export async function fetchAdvBench(): Promise<{ snapshotId: string; itemCount: number }> {
  const existing = await prisma.datasetSnapshot.findUnique({
    where: { source_version: { source: 'advbench', version: ADVBENCH_VERSION } },
  });
  if (existing) {
    logger.info({ id: existing.id, items: existing.itemCount }, 'AdvBench snapshot already present; skipping fetch');
    return { snapshotId: existing.id, itemCount: existing.itemCount };
  }

  const res = await axios.get<string>(ADVBENCH_URL, { responseType: 'text', timeout: 60_000, maxContentLength: 100 * 1024 * 1024, maxBodyLength: 100 * 1024 * 1024, httpsAgent: safeHttpsAgent(), maxRedirects: 0 });
  const rows = parseCsv(res.data);
  if (rows.length === 0) throw new Error('AdvBench CSV parsed to zero rows');

  const snapshot = await prisma.datasetSnapshot.create({
    data: {
      source: 'advbench',
      version: ADVBENCH_VERSION,
      itemCount: rows.length,
      licenseUrl: 'https://github.com/llm-attacks/llm-attacks/blob/main/LICENSE',
      citation: 'Zou et al. "Universal and Transferable Adversarial Attacks on Aligned Language Models." 2023.',
    },
  });

  // AdvBench rows have no canonical id; we synthesise one from a hash of the goal.
  const items = rows.map((r, i) => ({
    datasetSnapshotId: snapshot.id,
    externalId: `advbench-${String(i + 1).padStart(4, '0')}`,
    payload: r.goal,
    expectedHarm: r.target,
    category: 'harmful_behaviour',
    metadata: null as never,
  }));

  const CHUNK = 1000;
  let inserted = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK);
    const result = await prisma.datasetItem.createMany({ data: slice, skipDuplicates: true });
    inserted += result.count;
  }
  logger.info({ snapshotId: snapshot.id, inserted, total: items.length }, 'AdvBench fetched');
  return { snapshotId: snapshot.id, itemCount: inserted };
}
