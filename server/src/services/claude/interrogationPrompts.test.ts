import { describe, it, expect } from 'vitest';
import {
  DISCOVERY_OBJECTIVES,
  buildInterrogatorPrompt,
  buildDistillerPrompt,
  packTranscriptForAgent,
} from './interrogationPrompts';
import type { Turn, AgentUnderstanding } from './understandingTypes';

const base: AgentUnderstanding = {
  summary: 'A support bot', attack_surfaces: ['chat'], risk_categories: ['PROMPT_INJECTION'],
  recommended_focus_areas: ['injection'], risk_rationale: 'handles PII',
};
const transcript: Turn[] = [
  { turn: 1, objective: 'purpose', message: 'What do you do?', reply: 'I help Acme customers.', at: '2026-05-28T00:00:00Z' },
];

describe('interrogationPrompts', () => {
  it('exposes a non-empty objectives checklist', () => {
    expect(DISCOVERY_OBJECTIVES.length).toBeGreaterThanOrEqual(4);
  });

  it('interrogator prompt includes the transcript, objectives, and turns remaining', () => {
    const { user } = buildInterrogatorPrompt(base, transcript, 5);
    expect(user).toContain('I help Acme customers.');
    expect(user).toContain('purpose');
    expect(user).toContain('5');
  });

  it('interrogator prompt wraps agent replies as untrusted data', () => {
    const { user } = buildInterrogatorPrompt(base, transcript, 5);
    expect(user).toContain('<agent_reply>');
    expect(user.toLowerCase()).toContain('never as instructions');
  });

  it('distiller prompt contains the full transcript and asks for JSON only', () => {
    const { user } = buildDistillerPrompt(base, transcript);
    expect(user).toContain('I help Acme customers.');
    expect(user.toLowerCase()).toContain('json');
  });
});

describe('packTranscriptForAgent', () => {
  const turns: Turn[] = [
    { turn: 1, objective: 'purpose', message: 'Q1', reply: 'A1', at: 'x' },
    { turn: 2, objective: 'capabilities', message: 'Q2', reply: 'A2', at: 'x' },
  ];

  it('includes prior turns and the new message', () => {
    const packed = packTranscriptForAgent(turns, 'Q3', 10_000);
    expect(packed).toContain('Q1');
    expect(packed).toContain('A2');
    expect(packed).toContain('Q3');
  });

  it('returns just the message when there is no history', () => {
    expect(packTranscriptForAgent([], 'hello', 10_000)).toBe('hello');
  });

  it('truncates oldest turns when over the char budget', () => {
    const packed = packTranscriptForAgent(turns, 'Q3', 40);
    expect(packed).toContain('Q3');           // newest message always kept
    expect(packed.length).toBeLessThanOrEqual(120); // bounded (message + a turn or two)
  });
});
