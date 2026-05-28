import { describe, it, expect, vi } from 'vitest';
import type { Agent } from '@prisma/client';

// Mock the static base + llm + connector so the orchestrator is unit-testable.
vi.mock('./understanding', () => ({
  generateAgentUnderstanding: vi.fn(async () => ({
    summary: 'base', attack_surfaces: [], risk_categories: ['PROMPT_INJECTION'],
    recommended_focus_areas: [], risk_rationale: '',
  })),
}));
const fakeCall = vi.fn();
vi.mock('../../lib/llm', async (orig) => ({
  ...(await orig<typeof import('../../lib/llm')>()),
  getLlmClient: vi.fn(async () => ({ label: 'f', provider: 'anthropic', call: fakeCall })),
}));
const fakeSend = vi.fn();
vi.mock('../agentConnector', () => ({ sendToAgent: (...a: unknown[]) => fakeSend(...a) }));

import { buildAgentUnderstanding } from './understandingOrchestrator';
import { generateAgentUnderstanding } from './understanding';

const agent = { id: 'a1', orgId: 'o1', name: 'Bot' } as unknown as Agent;
const DISTILL = JSON.stringify({
  summary: 's', attack_surfaces: [], risk_categories: [], recommended_focus_areas: [],
  risk_rationale: '', discovered_purpose: 'p', observed_capabilities: [], observed_constraints: [],
  refusal_behavior: 'r', probe_reactions: [], confidence: 0.6,
});

describe('buildAgentUnderstanding', () => {
  it('returns an interactive profile when the agent answers', async () => {
    fakeSend.mockResolvedValue('I am a support bot');
    fakeCall.mockImplementation(async ({ user }: { user: string }) =>
      user.includes('discovered_purpose')
        ? DISTILL
        : JSON.stringify({ next_message: 'q', target_objective: 'purpose', done: false }));
    const out = await buildAgentUnderstanding(agent);
    expect(out.source).toBe('interactive');
    expect(out.discovered_purpose).toBe('p');
  });

  it('falls back to static when the agent is unreachable', async () => {
    fakeSend.mockResolvedValue('[AGENT_ERROR] refused');
    fakeCall.mockResolvedValue(JSON.stringify({ next_message: 'q', target_objective: 'purpose', done: false }));
    const out = await buildAgentUnderstanding(agent);
    expect(out.source).toBe('static_fallback');
    expect(out.summary).toBe('base');
  });

  it('returns static base unchanged when interrogation is disabled', async () => {
    const out = await buildAgentUnderstanding(agent, { config: { enabled: false } as never });
    expect(generateAgentUnderstanding).toHaveBeenCalled();
    expect(out.source).toBeUndefined(); // pure static base, untouched
  });
});
