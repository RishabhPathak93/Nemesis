import axios from 'axios';
import { LlmCallOptions, LlmClient, LlmResolvedConfig } from '../types';
import { withTimeout } from '../index';

/**
 * Strip <think>...</think> blocks emitted by reasoning models like deepseek-r1.
 * Those blocks are internal monologue and aren't part of the assistant's
 * actual answer — they also break our JSON extractors.
 */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * Minimal Ollama adapter using its native /api/chat endpoint.
 * Default base URL is http://localhost:11434 — no auth required typically.
 *
 * When `opts.onChunk` is set, the adapter switches to streaming mode and
 * invokes the callback with the cumulative response text as tokens arrive.
 * This lets long-running pipelines surface live progress (e.g. "N test
 * cases generated so far") without waiting for the full response.
 */
export function createOllamaClient(cfg: LlmResolvedConfig): LlmClient {
  const baseUrl = (cfg.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
  return {
    provider: 'ollama',
    label: `ollama · ${cfg.model}`,
    async call(opts: LlmCallOptions): Promise<string> {
      const timeoutMs = opts.timeoutMs ?? 180_000;
      const noTimeout = !timeoutMs || timeoutMs <= 0;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

      // An explicit numPredict pins the generation budget (used by reporting on
      // large failure sets, where the default JSON budget could truncate the
      // structured output mid-object). Otherwise: -1 lets a JSON response run to
      // natural stop, and non-JSON falls back to maxTokens.
      const generationBudget =
        opts.numPredict && opts.numPredict > 0
          ? opts.numPredict
          : opts.responseFormat === 'json'
            ? -1
            : opts.maxTokens ?? 4096;
      const ollamaOptions: Record<string, unknown> = {
        temperature: opts.temperature ?? 0.7,
        num_predict: generationBudget,
      };
      if (opts.numCtx && opts.numCtx > 0) {
        ollamaOptions.num_ctx = opts.numCtx;
      }

      const wantsStreaming = !!opts.onChunk;
      const body: Record<string, unknown> = {
        model: cfg.model,
        stream: wantsStreaming,
        options: ollamaOptions,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.user },
        ],
      };
      if (opts.responseFormat === 'json') {
        body.format = 'json';
      }

      // ────────────── Streaming branch ──────────────
      if (wantsStreaming) {
        const httpTimeout = noTimeout ? 0 : timeoutMs;
        const streamPromise = streamAndCollect(
          `${baseUrl}/api/chat`,
          body,
          headers,
          httpTimeout,
          opts.onChunk!,
        );
        const finalText = noTimeout
          ? await streamPromise
          : await withTimeout(streamPromise, timeoutMs, `ollama ${cfg.model}`);
        return stripThinking(finalText);
      }

      // ────────────── Non-streaming branch (existing) ──────────────
      const res = await withTimeout(
        axios.post(`${baseUrl}/api/chat`, body, {
          headers,
          timeout: noTimeout ? 0 : timeoutMs,
          validateStatus: () => true,
        }),
        timeoutMs,
        `ollama ${cfg.model}`,
      );
      if (res.status >= 400) {
        throw new Error(`Ollama HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`);
      }
      const raw = res.data?.message?.content;
      if (typeof raw !== 'string' || raw.length === 0) {
        throw new Error('Ollama returned no message content');
      }
      if (res.data?.done_reason === 'length') {
        console.warn(`[ollama] ${cfg.model} hit num_predict limit; response may be truncated.`);
      }
      return stripThinking(raw);
    },
  };
}

/**
 * Streams /api/chat and accumulates message.content chunks. Each chunk
 * triggers an `onChunk(cumulativeText)` call (throttled internally to ~250 ms
 * so we don't spam the caller). Resolves with the complete text on stream end.
 */
async function streamAndCollect(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  httpTimeout: number,
  onChunk: (cumulative: string) => void,
): Promise<string> {
  const res = await axios.post(url, body, {
    headers,
    timeout: httpTimeout,
    responseType: 'stream',
    validateStatus: () => true,
  });

  if (res.status >= 400) {
    let errBody = '';
    try {
      // M-12: bound the error-body read (5s / 8 KB) so a stalled error stream
      // (headers sent, body hangs) can't block the worker indefinitely.
      const readErr = (async () => {
        for await (const c of res.data) {
          errBody += c.toString();
          if (errBody.length > 8192) break;
        }
      })();
      await Promise.race([readErr, new Promise((r) => setTimeout(r, 5000))]);
    } catch {
      /* ignore */
    }
    try { (res.data as { destroy?: () => void }).destroy?.(); } catch { /* ignore */ }
    throw new Error(`Ollama HTTP ${res.status}: ${errBody.slice(0, 300)}`);
  }

  return new Promise<string>((resolve, reject) => {
    let cumulative = '';
    let buffer = '';
    let lastNotify = 0;

    res.data.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      // Ollama streams newline-delimited JSON objects.
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed) as { message?: { content?: string }; done?: boolean };
          if (obj.message?.content) {
            cumulative += obj.message.content;
            const now = Date.now();
            if (now - lastNotify > 250) {
              try {
                onChunk(cumulative);
              } catch {
                /* swallow callback errors */
              }
              lastNotify = now;
            }
          }
        } catch {
          // Not parseable — ignore (likely a partial line)
        }
      }
    });

    res.data.on('end', () => {
      // Flush any tail in the buffer
      const tail = buffer.trim();
      if (tail) {
        try {
          const obj = JSON.parse(tail) as { message?: { content?: string } };
          if (obj.message?.content) cumulative += obj.message.content;
        } catch {
          /* ignore */
        }
      }
      try {
        onChunk(cumulative);
      } catch {
        /* swallow */
      }
      resolve(cumulative);
    });

    res.data.on('error', (err: Error) => reject(err));
  });
}
