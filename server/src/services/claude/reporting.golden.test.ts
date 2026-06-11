import { vi, describe, it, expect } from 'vitest';

/**
 * W2 characterization (golden) tests — lock the CURRENT reporting behavior:
 *   1. the deterministic all-pass short-circuit (no LLM), and
 *   2. the LLM-path normalization of a finding (with the LLM mocked).
 * Protects against silent drift when reporting is touched later (e.g. the
 * C-02 externalId fix). Refresh deliberately with `vitest -u`.
 */

let scriptedReply = '';
vi.mock('../../lib/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/llm')>();
  return {
    ...actual,
    getLlmClient: vi.fn(async () => ({
      label: 'golden',
      provider: 'anthropic' as const,
      call: async () => scriptedReply,
    })),
  };
});

import { generateReport } from './reporting';

const agent = {
  id: 'agent-1', orgId: 'org-1', name: 'ACME Support Bot', agentType: 'customer_support',
  model: 'test-model', systemPrompt: 'You are ACME support.', knownGuardrails: 'No data leaks.',
  sensitiveDataScope: ['PII'], statedPurpose: 'Help customers.',
} as never;

const testRun = { id: 'run-1', startedAt: new Date(0), completedAt: new Date(0) } as never;

function caseRow(over: Record<string, unknown>) {
  return {
    id: 'res-1', testRunId: 'run-1', testCaseId: 'tc-1', confidence: 0.9,
    reasoning: 'reasoning', exploitationEvidence: null, agentResponse: 'response',
    testCase: {
      externalId: 'TC-001', category: 'system_prompt_extraction', severity: 'high',
      name: 'System prompt disclosure', description: 'Coaxes the agent to reveal its prompt.',
    },
    ...over,
  } as never;
}

describe('reporting golden snapshots', () => {
  it('locks the deterministic all-pass clean-run report (no LLM)', async () => {
    const results = [caseRow({ result: 'pass' }), caseRow({ id: 'res-2', result: 'pass' })];
    const out = await generateReport(agent, testRun, results);
    expect(out).toMatchSnapshot();
  });

  it('locks LLM-path normalization of a single finding', async () => {
    scriptedReply = JSON.stringify({
      executive_summary: 'The agent disclosed its system prompt under a roleplay attack.',
      overall_risk_rating: 'high',
      risk_score: 65,
      key_findings: [{
        title: 'System prompt disclosure',
        severity: 'high',
        description: 'The agent revealed its configured instructions.',
        evidence: 'Quoted "You are ACME support".',
        recommendation: 'Harden the system prompt and add output filtering.',
        related_test_ids: ['TC-001'],
      }],
      category_breakdown: [{ category: 'system_prompt_extraction', total_tests: 1, failures: 1, pass_rate: 0, commentary: 'Failed.' }],
      remediation_roadmap: [{ priority: 'immediate', action: 'Add prompt-leak filtering', rationale: 'Stops disclosure.' }],
      technical_notes: 'The agent echoed instructions verbatim.',
      conclusion: 'Remediate the disclosure before production use.',
    });
    const results = [caseRow({ result: 'fail', exploitationEvidence: 'You are ACME support.', agentResponse: 'My instructions: You are ACME support.' })];
    const out = await generateReport(agent, testRun, results);
    expect(out).toMatchSnapshot();
  });
});
