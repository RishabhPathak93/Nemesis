import Anthropic from '@anthropic-ai/sdk';
import { LlmCallOptions, LlmClient, LlmResolvedConfig } from '../types';
import { withTimeout } from '../index';

/**
 * Some newer Claude generations (4.x, 4.6, 4.7, Mythos, etc.) deprecate the
 * `temperature` parameter — the API rejects requests that include it. The
 * older 3.x family still accepts it. We skip it pre-emptively for known
 * deprecations and additionally retry-without on any "deprecated"/"not
 * supported" error message in case future models do the same.
 */
function modelSupportsTemperature(model: string): boolean {
  // Anything that looks like claude-{opus|sonnet|haiku}-{4..9} or named
  // releases beyond 4 (mythos, etc.) is treated as no-temperature.
  if (/^claude-(opus|sonnet|haiku)-[4-9]/i.test(model)) return false;
  if (/^claude-mythos/i.test(model)) return false;
  return true;
}

function isTemperatureRejection(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const msg = (err as { message?: string }).message ?? '';
  return /temperature.*(deprecated|not\s+supported|invalid)/i.test(msg);
}

export function createAnthropicClient(cfg: LlmResolvedConfig): LlmClient {
  if (!cfg.apiKey) throw new Error('Anthropic API key is required');
  const sdk = new Anthropic({ apiKey: cfg.apiKey });

  return {
    provider: 'anthropic',
    label: `anthropic · ${cfg.model}`,
    async call(opts: LlmCallOptions): Promise<string> {
      const timeoutMs = opts.timeoutMs ?? 120_000;

      const baseParams: Anthropic.MessageCreateParamsNonStreaming = {
        model: cfg.model,
        max_tokens: opts.maxTokens ?? 4096,
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
      };

      // Conditionally include temperature.
      const supportsTemp = modelSupportsTemperature(cfg.model);
      const paramsWithTemp: Anthropic.MessageCreateParamsNonStreaming = supportsTemp
        ? { ...baseParams, temperature: opts.temperature ?? 0.7 }
        : baseParams;

      const send = (params: Anthropic.MessageCreateParamsNonStreaming) =>
        withTimeout(sdk.messages.create(params), timeoutMs, `Anthropic ${cfg.model}`);

      let res: Anthropic.Message;
      try {
        res = await send(paramsWithTemp);
      } catch (err) {
        // Safety net for future model deprecations we don't have a pattern for yet.
        if (supportsTemp && isTemperatureRejection(err)) {
          console.warn(
            `[anthropic] ${cfg.model} rejected temperature param — retrying without. Add this model to the deprecation list to avoid the round-trip next time.`,
          );
          res = await send(baseParams);
        } else {
          throw err;
        }
      }

      const block = res.content.find((b) => b.type === 'text');
      if (!block || block.type !== 'text') throw new Error('Anthropic returned no text content');
      return block.text;
    },
  };
}
