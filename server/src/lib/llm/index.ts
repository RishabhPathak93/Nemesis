import { prisma } from '../prisma';
import { decrypt } from '../crypto';
import { env } from '../env';
import { LlmClient, LlmProviderName, LlmResolvedConfig } from './types';
import { createAnthropicClient } from './providers/anthropic';
import { createOpenAiClient } from './providers/openai';
import { createOllamaClient } from './providers/ollama';
import { createGeminiClient } from './providers/gemini';

export type { LlmClient, LlmProviderName, LlmCallOptions, LlmResolvedConfig } from './types';
export { PIPELINE_TIMEOUTS, dynamicReportingTimeoutMs, dynamicPatternExtractionTimeoutMs } from './types';

/**
 * Promise.race wrapper used by every adapter so a stuck local model
 * surfaces as a clear error instead of hanging the worker indefinitely.
 *
 * Pass ms <= 0 (or non-finite) to disable the timeout entirely — used by
 * test generation, which is uncapped on purpose so the model can produce
 * as many cases as it sees fit, however long that takes.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (!ms || ms <= 0 || !Number.isFinite(ms)) return promise;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      },
    );
  });
}

const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  anthropic: 'claude-opus-4-7',
  openai: 'gpt-4o',
  openai_compatible: 'gpt-4o-mini',
  ollama: 'llama3.1:8b',
  gemini: 'gemini-2.0-flash',
};

/**
 * Resolves the effective LLM config for an org.
 *
 * Priority:
 *   1. Org-level llmProvider/llmApiKey/llmModel/llmBaseUrl (the new unified config)
 *   2. Legacy org.anthropicApiKey (backward compat — implicitly anthropic)
 *   3. Server-level env (LLM_PROVIDER + LLM_API_KEY etc.)
 *   4. Server-level ANTHROPIC_API_KEY (legacy fallback)
 */
export async function resolveLlmConfig(orgId: string): Promise<LlmResolvedConfig> {
  const org = await prisma.org.findUnique({ where: { id: orgId } });

  // 1. New per-org unified config
  if (org?.llmProvider) {
    const provider = org.llmProvider as LlmProviderName;
    let apiKey = '';
    if (org.llmApiKey) {
      try {
        apiKey = decrypt(org.llmApiKey);
      } catch {
        // L-07: a stored key that won't decrypt (rotated/corrupted
        // ENCRYPTION_KEY) must be an actionable error — not a silent fall-through
        // to an empty key, which some adapters turn into an unauthenticated call.
        throw new Error(
          'Your organisation\'s stored LLM API key could not be decrypted (the encryption key may have changed). Re-enter the key in Settings → LLM provider.',
        );
      }
    }
    return {
      provider,
      apiKey,
      model: org.llmModel || DEFAULT_MODELS[provider],
      baseUrl: org.llmBaseUrl || undefined,
    };
  }

  // 2. Legacy per-org Anthropic key
  if (org?.anthropicApiKey) {
    try {
      return {
        provider: 'anthropic',
        apiKey: decrypt(org.anthropicApiKey),
        model: env.anthropicModel,
      };
    } catch {
      /* fall through */
    }
  }

  // 3. Server-level unified env
  if (env.llmProvider) {
    return {
      provider: env.llmProvider,
      apiKey: env.llmApiKey,
      model: env.llmModel || DEFAULT_MODELS[env.llmProvider],
      baseUrl: env.llmBaseUrl || undefined,
    };
  }

  // 4. Server-level Anthropic fallback
  if (env.anthropicApiKey) {
    return {
      provider: 'anthropic',
      apiKey: env.anthropicApiKey,
      model: env.anthropicModel,
    };
  }

  throw new Error(
    'No LLM provider configured. Set one in Settings → LLM provider, or via env (LLM_PROVIDER + LLM_API_KEY, or ANTHROPIC_API_KEY).',
  );
}

export function buildLlmClient(cfg: LlmResolvedConfig): LlmClient {
  switch (cfg.provider) {
    case 'anthropic':
      return createAnthropicClient(cfg);
    case 'openai':
    case 'openai_compatible':
      return createOpenAiClient(cfg);
    case 'ollama':
      return createOllamaClient(cfg);
    case 'gemini':
      return createGeminiClient(cfg);
    default:
      throw new Error(`Unsupported LLM provider: ${cfg.provider}`);
  }
}

/** One-shot helper: resolve org config + return ready client. */
export async function getLlmClient(orgId: string): Promise<LlmClient> {
  const cfg = await resolveLlmConfig(orgId);
  return buildLlmClient(cfg);
}

/** Small delay between calls to keep below provider rate limits during large runs. */
export function rateLimitDelay(ms = 350): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Lightweight liveness probe used by the test-connection endpoint. */
export async function probeLlm(cfg: LlmResolvedConfig): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  try {
    const client = buildLlmClient(cfg);
    const reply = await client.call({
      system: 'You are a connection test. Reply with the single word: ok',
      user: 'ping',
      maxTokens: 10,
      temperature: 0,
      // Generous enough for cold-start of a local model, tight enough that a
      // truly broken endpoint fails the probe quickly.
      timeoutMs: 60_000,
    });
    return { ok: true, reply: reply.trim().slice(0, 80) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
