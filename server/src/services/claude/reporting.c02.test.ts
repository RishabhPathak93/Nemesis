import { vi, describe, it, expect } from 'vitest';

/**
 * Covers C-02: cartesian/hybrid runs use `tc.<slug>.<chain>.<seq>` externalIds,
 * but the model is prompted with `TC-NNN` example ids. The reporter must present
 * stable TC-NNN prompt-ids, accept the model's `related_test_ids`, and map them
 * back to the real externalIds — so the finding is KEPT (not dropped as a
 * hallucination and replaced by a generic "Additional X" backfill).
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

import { generateReport } from './reporting';

const agent = {
  id: 'a1', orgId: 'o1', name: 'Bot', agentType: 'support', model: 'm',
  systemPrompt: 'x', knownGuardrails: 'y', sensitiveDataScope: [], statedPurpose: 'p',
} as never;
const testRun = { id: 'r1', startedAt: new Date(0), completedAt: new Date(0) } as never;

function failCase() {
  return {
    id: 'res1', testRunId: 'r1', testCaseId: 'tc1', result: 'fail', confidence: 0.9,
    reasoning: 'leaked', exploitationEvidence: 'secret', agentResponse: 'my secret is X',
    // cartesian-style internal externalId — the exact case C-02 broke on:
    testCase: {
      externalId: 'tc.acme_bank.raw.001', category: 'data_exfil', severity: 'high',
      name: 'Data exfiltration', description: 'Leaks data.',
    },
  } as never;
}

describe('reporting C-02 externalId remap', () => {
  it('keeps the LLM finding and maps prompt-id back to the real externalId', async () => {
    scriptedReply = JSON.stringify({
      executive_summary: 'Leak found.',
      overall_risk_rating: 'high',
      risk_score: 70,
      key_findings: [{
        title: 'Sensitive data disclosure',
        severity: 'high',
        description: 'The agent leaked a secret.',
        evidence: 'said "my secret is X"',
        recommendation: 'Filter output.',
        related_test_ids: ['TC-001'], // the prompt-facing id the model was shown
      }],
      category_breakdown: [{ category: 'data_exfil', total_tests: 1, failures: 1, pass_rate: 0, commentary: 'x' }],
      remediation_roadmap: [{ priority: 'immediate', action: 'fix', rationale: 'r' }],
      technical_notes: 'n',
      conclusion: 'c',
    });

    const report = await generateReport(agent, testRun, [failCase()]);

    // The LLM finding survived (NOT replaced by a generic "Additional ..." backfill)…
    const f = report.key_findings.find((k) => k.title === 'Sensitive data disclosure');
    expect(f).toBeTruthy();
    expect(report.key_findings.some((k) => /^Additional /.test(k.title))).toBe(false);
    // …and its related_test_ids were mapped back to the real internal externalId.
    expect(f!.related_test_ids).toContain('tc.acme_bank.raw.001');
  });
});
