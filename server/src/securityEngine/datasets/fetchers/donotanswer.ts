import axios from 'axios';
import { safeHttpsAgent } from '../../../lib/urlValidation';
import { prisma } from '../../../lib/prisma';
import { logger } from '../../../lib/logger';

/**
 * DoNotAnswer dataset (https://github.com/Libr-AI/do-not-answer). 939 prompts
 * organised by harm category that responsible models should refuse.
 *
 * Operator-triggered only. License: MIT.
 */

const URL = 'https://raw.githubusercontent.com/Libr-AI/do-not-answer/main/datasets/data_en.csv';
const VERSION = 'main-2023-data-en';

interface CsvRow {
  id?: string;
  question: string;
  risk_area?: string;
  types_of_harm?: string;
  specific_harms?: string;
  [k: string]: string | undefined;
}

function parseCsv(text: string): CsvRow[] {
  const lines: string[] = [];
  let buf = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    if (c === '\n' && !inQuotes) { lines.push(buf); buf = ''; }
    else buf += c;
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
      } else if (c === ',' && !q) { out.push(cur); cur = ''; }
      else cur += c;
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
    const row: CsvRow = { question: '' };
    headers.forEach((h, idx) => { (row as Record<string, string>)[h] = (cells[idx] ?? '').trim(); });
    if (row.question) rows.push(row);
  }
  return rows;
}

export async function fetchDoNotAnswer(): Promise<{ snapshotId: string; itemCount: number }> {
  const existing = await prisma.datasetSnapshot.findUnique({
    where: { source_version: { source: 'donotanswer', version: VERSION } },
  });
  if (existing) {
    logger.info({ id: existing.id, items: existing.itemCount }, 'DoNotAnswer snapshot present; skipping');
    return { snapshotId: existing.id, itemCount: existing.itemCount };
  }

  const res = await axios.get<string>(URL, { responseType: 'text', timeout: 60_000, maxContentLength: 100 * 1024 * 1024, maxBodyLength: 100 * 1024 * 1024, httpsAgent: safeHttpsAgent(), maxRedirects: 0 });
  const rows = parseCsv(res.data);
  if (rows.length === 0) throw new Error('DoNotAnswer CSV parsed to zero rows');

  const snapshot = await prisma.datasetSnapshot.create({
    data: {
      source: 'donotanswer',
      version: VERSION,
      itemCount: rows.length,
      licenseUrl: 'https://github.com/Libr-AI/do-not-answer/blob/main/LICENSE',
      citation: 'Wang et al. "Do-Not-Answer: Evaluating Safeguards in LLMs." 2023.',
    },
  });

  const items = rows.map((r, i) => ({
    datasetSnapshotId: snapshot.id,
    externalId: r.id || `dna-${String(i + 1).padStart(4, '0')}`,
    payload: r.question,
    expectedHarm: r.types_of_harm ?? null,
    category: r.risk_area ?? 'do_not_answer',
    metadata: { specific_harms: r.specific_harms } as never,
  }));

  const CHUNK = 1000;
  let inserted = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK);
    const out = await prisma.datasetItem.createMany({ data: slice, skipDuplicates: true });
    inserted += out.count;
  }
  logger.info({ snapshotId: snapshot.id, inserted, total: items.length }, 'DoNotAnswer fetched');
  return { snapshotId: snapshot.id, itemCount: inserted };
}
