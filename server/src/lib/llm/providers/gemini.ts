import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  type SafetySetting,
} from '@google/generative-ai';
import { LlmCallOptions, LlmClient, LlmResolvedConfig } from '../types';
import { withTimeout } from '../index';

/**
 * Adapter for Google Gemini (Generative Language API).
 *
 * Supports:
 *   - System + user prompts (mapped to systemInstruction + contents)
 *   - JSON mode via responseMimeType: 'application/json'
 *   - Streaming (generateContentStream) for live progress callbacks
 *   - Per-call timeoutMs (Promise.race; the SDK doesn't expose AbortSignal cleanly)
 *
 * Safety: CortexView is an authorised security-research tool. Its prompts
 * intentionally probe for prompt injection, jailbreak, harmful-content
 * elicitation, etc. Default Gemini safety thresholds (BLOCK_MEDIUM_AND_ABOVE)
 * silently swallow these prompts and return empty content. We set the four
 * documented categories to BLOCK_NONE so adversarial test prompts are
 * actually evaluated. If a model/account doesn't allow BLOCK_NONE the SDK
 * will reject — we surface the underlying error so the user can adjust
 * (e.g. switch to a paid-tier model or change account settings).
 */
const PERMISSIVE_SAFETY: SafetySetting[] = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

interface GeminiResponseLike {
  text(): string;
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
  candidates?: Array<{ finishReason?: string; safetyRatings?: Array<{ category: string; probability: string; blocked?: boolean }> }>;
}

/**
 * Pulls the assistant text out of a Gemini response, or throws a clear
 * error explaining why no text came back. Distinguishes between:
 *   - prompt blocked (input safety filter)
 *   - output blocked (candidate finishReason = SAFETY)
 *   - max-tokens cut-off (finishReason = MAX_TOKENS)
 *   - genuinely empty (model produced no tokens)
 */
function extractText(label: string, response: GeminiResponseLike): string {
  // Prompt blocked at the input layer
  const pf = response.promptFeedback;
  if (pf?.blockReason) {
    const ratings = response.candidates?.[0]?.safetyRatings
      ?.filter((r) => r.blocked)
      .map((r) => `${r.category}=${r.probability}`)
      .join(', ');
    throw new Error(
      `${label} blocked by safety filter (promptFeedback.blockReason=${pf.blockReason}${
        ratings ? `; ratings: ${ratings}` : ''
      }). ${pf.blockReasonMessage ?? ''}`,
    );
  }

  // No candidate at all
  const candidate = response.candidates?.[0];
  if (!candidate) {
    throw new Error(`${label} returned no candidate (likely a safety / quota issue with no further detail)`);
  }

  const finish = candidate.finishReason;
  if (finish && finish !== 'STOP' && finish !== 'MAX_TOKENS') {
    const blocked = candidate.safetyRatings
      ?.filter((r) => r.blocked)
      .map((r) => `${r.category}=${r.probability}`)
      .join(', ');
    throw new Error(
      `${label} finishReason=${finish}${blocked ? `; blocked categories: ${blocked}` : ''}`,
    );
  }

  let text = '';
  try {
    text = response.text();
  } catch (err) {
    throw new Error(
      `${label} response.text() threw — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!text || text.length === 0) {
    if (finish === 'MAX_TOKENS') {
      throw new Error(`${label} hit MAX_TOKENS before producing any output — increase maxTokens.`);
    }
    throw new Error(`${label} returned no text (finishReason=${finish ?? 'unknown'})`);
  }
  return text;
}

export function createGeminiClient(cfg: LlmResolvedConfig): LlmClient {
  if (!cfg.apiKey) throw new Error('Gemini API key is required');
  const sdk = new GoogleGenerativeAI(cfg.apiKey);

  return {
    provider: 'gemini',
    label: `gemini · ${cfg.model}`,
    async call(opts: LlmCallOptions): Promise<string> {
      const timeoutMs = opts.timeoutMs ?? 120_000;
      const label = `gemini ${cfg.model}`;

      const model = sdk.getGenerativeModel({
        model: cfg.model,
        systemInstruction: opts.system,
        safetySettings: PERMISSIVE_SAFETY,
        generationConfig: {
          temperature: opts.temperature ?? 0.7,
          maxOutputTokens: opts.maxTokens ?? 4096,
          ...(opts.responseFormat === 'json'
            ? { responseMimeType: 'application/json' }
            : {}),
        },
      });

      const request = {
        contents: [{ role: 'user' as const, parts: [{ text: opts.user }] }],
      };

      // ────────────── Streaming branch ──────────────
      if (opts.onChunk) {
        const streamPromise = (async () => {
          const result = await model.generateContentStream(request);
          let cumulative = '';
          let lastNotify = 0;
          for await (const chunk of result.stream) {
            try {
              const piece = chunk.text();
              if (piece) {
                cumulative += piece;
                const now = Date.now();
                if (now - lastNotify > 250) {
                  try {
                    opts.onChunk!(cumulative);
                  } catch {
                    /* swallow */
                  }
                  lastNotify = now;
                }
              }
            } catch {
              // Some chunks (e.g. block-reason markers) don't have text — skip
            }
          }
          try {
            opts.onChunk!(cumulative);
          } catch {
            /* swallow */
          }
          // Final aggregated response — also where prompt/safety blocks surface.
          const final = await result.response;
          // Prefer SDK aggregated text but fall back to cumulative on safety
          // metadata edge cases.
          try {
            return extractText(label, final as unknown as GeminiResponseLike);
          } catch (err) {
            if (cumulative.length > 0) return cumulative;
            throw err;
          }
        })();
        return withTimeout(streamPromise, timeoutMs, label);
      }

      // ────────────── Non-streaming branch ──────────────
      const result = await withTimeout(
        model.generateContent(request),
        timeoutMs,
        label,
      );
      return extractText(label, result.response as unknown as GeminiResponseLike);
    },
  };
}
