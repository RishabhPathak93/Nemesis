import { vi, describe, it, expect } from 'vitest';

/**
 * Covers the large-suite reporting degradation (benchmark 2026-06-11): a 76-case
 * run with 43 fail/partial findings produced a report with only generic
 * "Additional X" backfill findings, an EMPTY executive summary, and risk score 0
 * because the single structured-JSON call exceeded the model's output budget and
 * truncated.
 *
 * The map-reduce path (Fix 1) chunks the findings so no single call truncates,
 * the deterministic reduce (Fix 1) + risk floor (Fix 2) guarantee a non-zero
 * risk score, and the C-02 TC-NNN → realId remap is preserved per chunk.
 *
 * This test asserts:
 *   (a) findings are NOT all generic "Additional X" backfill, and
 *   (b) risk_score > 0.
 */
let scriptedReply = '';
vi.mock('../../lib/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/llm')>();
  return {
    ...actual,
    getLlmClient: vi.fn(async () => ({
      label: 'test',
      provider: 'anthropic' as const,
      call: async () => scriptedReply,
    })),
  };
});

import { generateReport, REPORT_CHUNK_THRESHOLD } from './reporting';

const agent = {
  id: 'a1', orgId: 'o1', name: 'Bot', agentType: 'support', model: 'm',
  systemPrompt: 'x', knownGuardrails: 'y', sensitiveDataScope: [], statedPurpose: 'p',
} as never;
const testRun = { id: 'r1', startedAt: new Date(0), completedAt: new Date(0) } as never;

const CATEGORIES = ['prompt_injection', 'data_exfil', 'role_manipulation', 'encoding_bypass'];
const SEVERITIES = ['critical', 'high', 'medium', 'high'];

/** Build a large diverse fail/partial set with cartesian-style externalIds. */
function makeLargeFailSet(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `res${i}`, testRunId: 'r1', testCaseId: `tc${i}`,
    result: i % 5 === 0 ? 'partial' : 'fail', confidence: 0.9,
    reasoning: `reasoning ${i}`, exploitationEvidence: `evidence ${i}`,
    agentResponse: `agent response ${i}`,
    testCase: {
      // cartesian-style internal id (the C-02 shape) — must survive the remap:
      externalId: `tc.acme_bank.raw.${String(i + 1).padStart(3, '0')}`,
      category: CATEGORIES[i % CATEGORIES.length],
      severity: SEVERITIES[i % SEVERITIES.length],
      name: `Case ${i}`, description: `Description ${i}.`,
    },
  })) as never[];
}

describe('reporting — large suite map-reduce', () => {
  it('does not degrade to all-generic findings + risk 0 on a large failure set', async () => {
    // The mocked LLM returns the SAME chunk-shaped reply for every chunk call.
    // It references TC-001, which only exists in the first chunk — so exactly one
    // genuine finding survives and the rest is covered by backfill.
    scriptedReply = JSON.stringify({
      key_findings: [{
        title: 'Prompt-injection compliance',
        severity: 'high',
        description: 'The agent followed an injected instruction.',
        evidence: 'agent complied with the override',
        recommendation: 'Add an instruction-isolation guard.',
        related_test_ids: ['TC-001'],
      }],
    });

    const n = 30; // > REPORT_CHUNK_THRESHOLD → exercises the chunked path
    expect(n).toBeGreaterThan(REPORT_CHUNK_THRESHOLD);
    const report = await generateReport(agent, testRun, makeLargeFailSet(n));

    // (a) findings are NOT all generic "Additional X" backfill — at least one
    // real LLM finding survived.
    const generic = report.key_findings.filter((f) => /^Additional /.test(f.title));
    const real = report.key_findings.filter((f) => !/^Additional /.test(f.title));
    expect(real.length).toBeGreaterThan(0);
    expect(generic.length).toBeLessThan(report.key_findings.length);

    // The surviving real finding was kept exactly once (not duplicated per chunk)…
    const injectionFindings = report.key_findings.filter((f) => f.title === 'Prompt-injection compliance');
    expect(injectionFindings).toHaveLength(1);
    // …and its prompt-id was remapped back to the real cartesian externalId (C-02).
    expect(injectionFindings[0].related_test_ids).toContain('tc.acme_bank.raw.001');

    // (b) risk score is non-zero (severity-weighted floor), never the bug's 0.
    expect(report.risk_score).toBeGreaterThan(0);

    // And the executive summary is not empty (the original bug emptied it).
    expect(report.executive_summary.trim().length).toBeGreaterThan(0);

    // Every fail/partial case is represented (real finding + backfill cover all).
    const referenced = new Set<string>();
    for (const f of report.key_findings) for (const id of f.related_test_ids) referenced.add(id);
    expect(referenced.size).toBe(n);
  });
});
