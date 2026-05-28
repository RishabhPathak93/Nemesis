import type { LlmClient } from '../../lib/llm';
import { extractJson } from '../../lib/json';
import { buildDistillerPrompt } from './interrogationPrompts';
import { distilledProfileSchema, type AgentUnderstanding, type Turn } from './understandingTypes';

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
