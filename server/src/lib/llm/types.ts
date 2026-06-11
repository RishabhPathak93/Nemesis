/**
 * Provider-agnostic LLM call interface used by every CortexView pipeline.
 * All adapters in lib/llm/providers/* implement this.
 */
export type LlmProviderName = 'anthropic' | 'openai' | 'openai_compatible' | 'ollama' | 'gemini';

export interface LlmCallOptions {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * Hard ceiling on this single call, in milliseconds. Default 120_000 (2 min).
   * Each adapter applies this both at the HTTP layer and via a Promise.race
   * abort so a stuck local model can't lock up the worker forever.
   */
  timeoutMs?: number;
  /**
   * Force the model to emit valid JSON.
   *   - Ollama: passes `format: "json"` (constrained decoding, prevents truncation drift)
   *   - OpenAI / OpenAI-compatible: passes `response_format: { type: "json_object" }`
   *   - Anthropic: no-op (Claude is highly compliant; prompt already says "return only JSON")
   * Use for any pipeline whose response is parsed via extractJson.
   */
  responseFormat?: 'json' | 'text';
  /**
   * Override the model's context window length. Currently honoured by Ollama
   * (passed as `num_ctx`); ignored by hosted providers (they manage context
   * server-side). Set this when a long prompt would otherwise be truncated by
   * a small default (e.g. Mistral 7B's 4096-token default loadout).
   */
  numCtx?: number;
  /**
   * Cap on the number of tokens the model may GENERATE for this call (distinct
   * from numCtx, which sizes the whole context window). Currently honoured by
   * Ollama (passed as `num_predict`); ignored by hosted providers, which use
   * `maxTokens` instead. Set this for pipelines whose structured-JSON output is
   * large enough to risk hitting the model's default generation budget and
   * truncating mid-object (e.g. reporting on a large failure set). When unset,
   * Ollama keeps its existing behaviour (-1 / run-to-stop for JSON responses).
   */
  numPredict?: number;
  /**
   * Streaming progress callback. When set, the adapter (currently Ollama)
   * uses streaming mode and invokes this with the cumulative response text
   * as tokens arrive. Used by test generation to surface a live "N cases
   * generated so far" count to the UI without waiting for the full response.
   */
  onChunk?: (cumulativeText: string) => void;
}

/**
 * Sensible per-pipeline call ceilings. Sized for ~8B local models on CPU
 * (which can be 2–3× slower than 7B); cloud models or GPUs will finish
 * far faster than the ceiling. Tunable via env (PIPELINE_TIMEOUT_MULT)
 * if you're running a much slower or faster setup.
 *
 * The reporting and patternExtraction values are *baselines* — the worker
 * computes a dynamic ceiling per run from the actual test-case / failure
 * count and overrides via LlmCallOptions.timeoutMs. testGeneration is the
 * hardest to predict (output size depends on the model's choice) so it's
 * generous by default — let the model produce as many cases as it wants.
 */
const MULT = Number(process.env.PIPELINE_TIMEOUT_MULT ?? '1') || 1;
export const PIPELINE_TIMEOUTS = {
  understanding: Math.round(180_000 * MULT),
  testGeneration: Math.round(1_800_000 * MULT), // 30 min — let the model produce as many cases as it wants
  evaluation: Math.round(180_000 * MULT),
  reporting: Math.round(600_000 * MULT),       // baseline; worker scales by case count
  patternExtraction: Math.round(360_000 * MULT), // baseline; worker scales by failure count
  research: Math.round(180_000 * MULT),
} as const;

/**
 * Compute a dynamic reporting-call timeout from the number of test results.
 * Roughly: 90 s base + 25 s per result, with a sane floor and ceiling so
 * runaway suites don't lock the worker forever and tiny suites don't get
 * cut off prematurely.
 */
export function dynamicReportingTimeoutMs(resultCount: number): number {
  const ms = 90_000 + Math.max(0, resultCount) * 25_000;
  return Math.min(Math.max(ms, 120_000), 3_600_000); // 2 min … 60 min
}

/**
 * Compute a dynamic pattern-extraction timeout from the number of fail/partial
 * results that will be analysed. Smaller jobs finish quickly; large failure
 * sets need more headroom.
 */
export function dynamicPatternExtractionTimeoutMs(failedCount: number): number {
  const ms = 60_000 + Math.max(0, failedCount) * 15_000;
  return Math.min(Math.max(ms, 90_000), 1_800_000); // 90 s … 30 min
}

export interface LlmClient {
  /** Friendly name (provider + model) for logs/UI. */
  readonly label: string;
  /** Underlying provider (so callers can branch if absolutely required). */
  readonly provider: LlmProviderName;
  /** Single text-completion-style call. Returns the assistant's text content. */
  call(opts: LlmCallOptions): Promise<string>;
}

export interface LlmResolvedConfig {
  provider: LlmProviderName;
  apiKey: string; // may be empty for Ollama
  model: string;
  baseUrl?: string;
}
