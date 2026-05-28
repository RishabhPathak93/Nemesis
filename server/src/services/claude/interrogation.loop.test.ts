import { describe, it, expect, vi } from 'vitest';
import { interrogateAgent, type InterrogationDeps } from './interrogation';
import type { AgentUnderstanding } from './understandingTypes';
import type { LlmClient } from '../../lib/llm';
import type { Agent } from '@prisma/client';

const agent = { id: 'a1', orgId: 'o1', name: 'Bot' } as unknown as Agent;
const base: AgentUnderstanding = {
  summary: 'base', attack_surfaces: [], risk_categories: [],
  recommended_focus_areas: [], risk_rationale: '',
};
const DISTILL = JSON.stringify({
  summary: 's', attack_surfaces: [], risk_categories: [], recommended_focus_areas: [],
  risk_rationale: '', discovered_purpose: 'p', observed_capabilities: [], observed_constraints: [],
  refusal_behavior: 'r', probe_reactions: [], confidence: 0.5,
});

/** interrogator returns these turns in order, then the distiller JSON. */
function scriptedClient(turns: string[], distill: string): LlmClient {
  const queue = [...turns];
  return {
    label: 'fake', provider: 'anthropic',
    call: async ({ user }) => {
      // The distiller prompt asks for "discovered_purpose"; the interrogator does not.
      if (user.includes('discovered_purpose')) return distill;
      return queue.shift() ?? JSON.stringify({ next_message: 'x', target_objective: 'purpose', done: true });
    },
  };
}

function cfg(overrides = {}) {
  return { enabled: true, maxTurns: 12, maxWallMs: 60_000, maxTranscriptChars: 6000, perCallTimeoutMs: 30_000, ...overrides };
}

describe('interrogateAgent', () => {
  it('stops early when the interrogator says done', async () => {
    const send = vi.fn(async () => 'agent reply');
    const client = scriptedClient(
      [
        JSON.stringify({ next_message: 'q1', target_objective: 'purpose', done: false }),
        JSON.stringify({ next_message: 'q2', target_objective: 'capabilities', done: true }),
      ],
      DISTILL,
    );
    const deps: InterrogationDeps = { client, send, config: cfg() };
    const res = await interrogateAgent(agent, base, deps);
    expect(send).toHaveBeenCalledTimes(2);      // two turns, then done
    expect(res.source).toBe('interactive');
    expect(res.transcript).toHaveLength(2);
  });

  it('honors the hard turn cap', async () => {
    const send = vi.fn(async () => 'reply');
    const never = JSON.stringify({ next_message: 'q', target_objective: 'purpose', done: false });
    const client = scriptedClient(Array(50).fill(never), DISTILL);
    const deps: InterrogationDeps = { client, send, config: cfg({ maxTurns: 3 }) };
    const res = await interrogateAgent(agent, base, deps);
    expect(send).toHaveBeenCalledTimes(3);
    expect(res.transcript).toHaveLength(3);
  });

  it('aborts to fallback after 2 consecutive agent errors', async () => {
    const send = vi.fn(async () => '[AGENT_ERROR] connection refused');
    const never = JSON.stringify({ next_message: 'q', target_objective: 'purpose', done: false });
    const client = scriptedClient(Array(50).fill(never), DISTILL);
    const deps: InterrogationDeps = { client, send, config: cfg() };
    const res = await interrogateAgent(agent, base, deps);
    expect(send).toHaveBeenCalledTimes(2);          // stopped after 2 errors
    expect(res.source).toBe('static_fallback');
  });
});
