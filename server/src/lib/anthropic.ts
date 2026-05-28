import Anthropic from '@anthropic-ai/sdk';
import { env } from './env';
import { decrypt } from './crypto';
import { prisma } from './prisma';

/**
 * Returns an Anthropic client configured with the org's API key (if set),
 * falling back to the server's env key.
 */
export async function getAnthropicClient(orgId: string): Promise<Anthropic> {
  const org = await prisma.org.findUnique({ where: { id: orgId } });
  let apiKey = env.anthropicApiKey;
  if (org?.anthropicApiKey) {
    try {
      apiKey = decrypt(org.anthropicApiKey);
    } catch {
      // fall back to env
    }
  }
  if (!apiKey) throw new Error('No Anthropic API key configured for this org or server');
  return new Anthropic({ apiKey });
}

export const ANTHROPIC_MODEL = env.anthropicModel;

/**
 * Helper that calls Claude with a system + user prompt and returns the text content.
 */
export async function callClaude(
  client: Anthropic,
  opts: {
    system: string;
    user: string;
    maxTokens?: number;
    temperature?: number;
  },
): Promise<string> {
  const res = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.7,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  });
  const textBlock = res.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('No text block in Claude response');
  return textBlock.text;
}

/** Small delay between API calls to stay within rate limits during large runs. */
export function rateLimitDelay(ms = 350): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
