import type { Agent } from '@prisma/client';
import type { LlmClient } from '../../lib/llm';
import { extractJson } from '../../lib/json';
import { buildInterrogatorPrompt, buildDistillerPrompt, packTranscriptForAgent } from './interrogationPrompts';
import {
  distilledProfileSchema,
  interrogatorTurnSchema,
  type AgentUnderstanding,
  type Turn,
  type InterrogationConfig,
  type InterrogationResult,
} from './understandingTypes';

function unionStrings(a: string[] = [], b: string[] = []): string[] {
  return Array.from(new Set([...a, ...b]));
}

/**
 * Fold the transcript into the extended profile, merged with the static base.
 * On any parse/validation failure, returns the base profile tagged
 * static_fallback so understanding never hard-fails here.
 */
export async function distillUnderstanding(
  base: AgentUnderstanding,
  transcript: Turn[],
  client: LlmClient,
  timeoutMs: number,
): Promise<AgentUnderstanding> {
  const { system, user } = buildDistillerPrompt(base, transcript);
  try {
    const raw = await client.call({
      system, user, maxTokens: 2048, temperature: 0.3, timeoutMs, responseFormat: 'json',
    });
    const parsed = distilledProfileSchema.parse(extractJson(raw));
    return {
      ...parsed,
      // Union the taxonomy + surfaces so we never lose what the base flagged.
      risk_categories: unionStrings(base.risk_categories, parsed.risk_categories),
      attack_surfaces: unionStrings(base.attack_surfaces, parsed.attack_surfaces),
      source: 'interactive',
    };
  } catch {
    return { ...base, source: 'static_fallback' };
  }
}

export interface InterrogationDeps {
  client: LlmClient;
  send: (agent: Agent, prompt: string) => Promise<string>;
  config: InterrogationConfig;
  onProgress?: (msg: string) => void | Promise<void>;
}

/**
 * Turn-by-turn interrogation loop. Drives a conversation with the live agent,
 * adaptively stopping when the interrogator is satisfied or a hard limit hits,
 * then distills the transcript. Never throws — degrades to static_fallback.
 */
export async function interrogateAgent(
  agent: Agent,
  base: AgentUnderstanding,
  deps: InterrogationDeps,
): Promise<InterrogationResult> {
  const { client, send, config, onProgress } = deps;
  const transcript: Turn[] = [];
  const startedAt = Date.now();
  let consecutiveErrors = 0;
  let aborted = false;

  for (let i = 0; i < config.maxTurns; i++) {
    if (Date.now() - startedAt > config.maxWallMs) break;
    const turnsRemaining = config.maxTurns - i;

    // 1) Plan the next message.
    let plan: { next_message: string; target_objective: string; done: boolean };
    try {
      const { system, user } = buildInterrogatorPrompt(base, transcript, turnsRemaining);
      const raw = await client.call({
        system, user, maxTokens: 1024, temperature: 0.6,
        timeoutMs: config.perCallTimeoutMs, responseFormat: 'json',
      });
      plan = interrogatorTurnSchema.parse(extractJson(raw));
    } catch {
      break; // interrogator failed — distill what we have
    }
    await onProgress?.(`Interrogating: ${plan.target_objective} (turn ${i + 1}/${config.maxTurns})`);

    // 2) Ask the agent (stateless connector → pack running transcript as memory).
    const packed = packTranscriptForAgent(transcript, plan.next_message, config.maxTranscriptChars);
    const reply = await send(agent, packed);

    if (reply.startsWith('[AGENT_ERROR')) {
      consecutiveErrors++;
      if (consecutiveErrors >= 2) { aborted = true; break; }
      continue; // transient — retry with a fresh plan
    }
    consecutiveErrors = 0;

    transcript.push({
      turn: i + 1, objective: plan.target_objective,
      message: plan.next_message, reply, at: new Date().toISOString(),
    });

    if (plan.done) break;
  }

  // No usable conversation → static fallback.
  if (transcript.length === 0 || aborted) {
    return { profile: { ...base, source: 'static_fallback' }, transcript, source: 'static_fallback' };
  }

  await onProgress?.('Distilling interrogation transcript…');
  const profile = await distillUnderstanding(base, transcript, client, config.perCallTimeoutMs);
  return { profile, transcript, source: profile.source ?? 'interactive' };
}
