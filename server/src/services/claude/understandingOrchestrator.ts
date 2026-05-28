import type { Agent } from '@prisma/client';
import { getLlmClient } from '../../lib/llm';
import { sendToAgent } from '../agentConnector';
import { generateAgentUnderstanding } from './understanding';
import { interrogateAgent } from './interrogation';
import { INTERROGATION_CONFIG, type AgentUnderstanding, type InterrogationConfig, type Turn } from './understandingTypes';

export interface BuildUnderstandingOptions {
  onProgress?: (msg: string) => void | Promise<void>;
  config?: InterrogationConfig;
  /** Receives the raw transcript so the caller can persist it. */
  onTranscript?: (transcript: Turn[]) => void | Promise<void>;
}

/**
 * Single entry point for agent understanding. Runs the static base analysis,
 * then (unless disabled) deepens it by interrogating the live agent. Falls
 * back to the static base if the agent is unreachable.
 */
export async function buildAgentUnderstanding(
  agent: Agent,
  opts: BuildUnderstandingOptions = {},
): Promise<AgentUnderstanding> {
  const config = opts.config ?? INTERROGATION_CONFIG;
  await opts.onProgress?.('Analysing agent profile…');
  const base = await generateAgentUnderstanding(agent);

  if (!config.enabled) return base;

  const client = await getLlmClient(agent.orgId);
  const result = await interrogateAgent(agent, base, {
    client, send: sendToAgent, config, onProgress: opts.onProgress,
  });
  await opts.onTranscript?.(result.transcript);
  return result.profile;
}
