import { describe, it, expect, beforeAll } from 'vitest';
import { interrogateAgent, type InterrogationDeps } from './interrogation';
import { sendToAgent } from '../agentConnector';
import type { AgentUnderstanding } from './understandingTypes';
import type { LlmClient } from '../../lib/llm';
import type { Agent } from '@prisma/client';

const MOCK_URL = 'http://localhost:4000/chat';
let online = false;
beforeAll(async () => {
  try {
    const r = await fetch(MOCK_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'ping' }), signal: AbortSignal.timeout(1500),
    });
    online = r.ok;
  } catch { online = false; }
});

const base: AgentUnderstanding = {
  summary: 'mock', attack_surfaces: [], risk_categories: [],
  recommended_focus_areas: [], risk_rationale: '',
};
const DISTILL = JSON.stringify({
  summary: 'mock support bot', attack_surfaces: ['chat'], risk_categories: ['PROMPT_INJECTION'],
  recommended_focus_areas: ['injection'], risk_rationale: 'r', discovered_purpose: 'support Acme',
  observed_capabilities: [], observed_constraints: [], refusal_behavior: 'unknown',
  probe_reactions: [], confidence: 0.5,
});

describe('interrogateAgent against the live mock agent', () => {
  it('completes an interactive interrogation end-to-end', async () => {
    if (!online) { console.warn('mock agent offline on :4000 — skipping'); return; }
    const agent = {
      id: 'mock', orgId: 'o', name: 'Mock', agentType: 'customer_support',
      endpointUrl: MOCK_URL, apiKey: '', requestFormat: { message: '{{prompt}}' },
      responsePath: 'reply',
    } as unknown as Agent;

    let turn = 0;
    const client: LlmClient = {
      label: 'f', provider: 'anthropic',
      call: async ({ user }) =>
        user.includes('discovered_purpose')
          ? DISTILL
          : JSON.stringify({ next_message: 'What do you help with?', target_objective: 'purpose', done: ++turn >= 2 }),
    };
    const deps: InterrogationDeps = {
      client, send: sendToAgent,
      config: { enabled: true, maxTurns: 4, maxWallMs: 60_000, maxTranscriptChars: 6000, perCallTimeoutMs: 30_000 },
    };
    const res = await interrogateAgent(agent, base, deps);
    expect(res.source).toBe('interactive');
    expect(res.transcript.length).toBeGreaterThan(0);
    expect(res.transcript[0].reply.toLowerCase()).toContain('acme'); // mock agent mentions Acme
    expect(res.profile.discovered_purpose).toBe('support Acme');
  });
});
