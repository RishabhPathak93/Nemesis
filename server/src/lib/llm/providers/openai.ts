import OpenAI from 'openai';
import { LlmCallOptions, LlmClient, LlmResolvedConfig } from '../types';
import { withTimeout } from '../index';

/**
 * Adapter for any OpenAI Chat Completions-compatible endpoint.
 * Handles cloud OpenAI as well as Groq, Together, OpenRouter, Anyscale,
 * Azure OpenAI, vLLM, LM Studio — anything that speaks the OpenAI API shape.
 */
export function createOpenAiClient(cfg: LlmResolvedConfig): LlmClient {
  const labelPrefix = cfg.baseUrl ? 'openai-compat' : 'openai';
  return {
    provider: cfg.baseUrl ? 'openai_compatible' : 'openai',
    label: `${labelPrefix} · ${cfg.model}`,
    async call(opts: LlmCallOptions): Promise<string> {
      const timeoutMs = opts.timeoutMs ?? 120_000;
      const sdk = new OpenAI({
        apiKey: cfg.apiKey || 'no-auth',
        baseURL: cfg.baseUrl || undefined,
        timeout: timeoutMs, // SDK-level HTTP timeout
        maxRetries: 0,
      });
      const res = await withTimeout(
        sdk.chat.completions.create({
          model: cfg.model,
          max_tokens: opts.maxTokens ?? 4096,
          temperature: opts.temperature ?? 0.7,
          stream: false,
          messages: [
            { role: 'system', content: opts.system },
            { role: 'user', content: opts.user },
          ],
          ...(opts.responseFormat === 'json'
            ? { response_format: { type: 'json_object' } as const }
            : {}),
        }),
        timeoutMs,
        `${labelPrefix} ${cfg.model}`,
      );
      const text = res.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || text.length === 0) {
        throw new Error('OpenAI-compatible endpoint returned no text content');
      }
      return text;
    },
  };
}
