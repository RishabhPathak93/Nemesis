/**
 * v2.2 — BACKWARDS-COMPAT SHIM.
 *
 * Pre-v2.2, this file was the single source of truth for every deterministic
 * strategy. Many call sites import `applyStrategyChain`, `TRANSFORMERS`, or
 * individual transformer functions from here.
 *
 * The new home is `strategies/registry.ts` + `strategies/builtins/*.ts`. This
 * file preserves every legacy export so old callers still compile. New code
 * should import from `registry.ts`.
 *
 * NOTE: we keep the *sync* surface here, which means LLM-assisted strategies
 * (multilingual.translate) and orchestrator-style strategies (multi-turn,
 * suffix-corpus) won't be reachable via the legacy API — they were never in
 * encoders.ts to begin with. Use `applyStrategyChain` from `registry.ts` for
 * those (it's async).
 */

import {
  applyStrategyChainSync as registryApplyChainSync,
  getTechnique,
  listTechniques,
  type Technique,
} from './registry';

// Eagerly load builtins so this module's `TRANSFORMERS` map is populated by
// the time anyone reads it. (`getTechnique` lazy-loads internally; we call
// it once to trigger.)
getTechnique('encoding.base64');

type Transformer = (payload: string, params?: Record<string, unknown>) => string;

/** @deprecated Use `applyStrategyChain` from `registry.ts`. */
export const TRANSFORMERS: Record<string, Transformer> = Object.fromEntries(
  listTechniques()
    .filter((t: Technique) => t.kind === 'deterministic')
    .map((t: Technique) => [
      t.slug,
      (payload: string, params?: Record<string, unknown>) => {
        const out = t.apply(payload, params);
        // We've filtered to deterministic-only above — apply is sync.
        if (out instanceof Promise) {
          throw new Error(`unexpected async technique "${t.slug}" in compat shim`);
        }
        return out;
      },
    ]),
);

/** @deprecated Use `applyStrategyChain` from `registry.ts` (async) — needed for LLM-assisted techniques. */
export function applyStrategyChain(
  payload: string,
  slugs: string[],
  params: Record<string, Record<string, unknown>> = {},
): string {
  return registryApplyChainSync(payload, slugs, params);
}

// Individual function re-exports for the small set of call sites that
// imported them directly. They all live in the registry now.
function getTransformer(slug: string): Transformer {
  const t = getTechnique(slug);
  if (!t) throw new Error(`strategy "${slug}" not registered`);
  return (payload, params) => {
    const out = t.apply(payload, params);
    if (out instanceof Promise) throw new Error(`technique "${slug}" is async`);
    return out;
  };
}

export const base64Encode: Transformer = getTransformer('encoding.base64');
export const rot13Encode: Transformer = getTransformer('encoding.rot13');
export const hexEncode: Transformer = getTransformer('encoding.hex');
export const leetspeakTransform: Transformer = getTransformer('encoding.leetspeak');
export const morseEncode: Transformer = getTransformer('encoding.morse');
export const camelCaseTransform: Transformer = getTransformer('encoding.camel_case');
export const pigLatinTransform: Transformer = getTransformer('encoding.pig_latin');
export const asciiSmuggleEncode: Transformer = getTransformer('encoding.ascii_smuggle');
export const emojiSmuggleEncode: Transformer = getTransformer('encoding.emoji_smuggle');
export const unicodeHomoglyphTransform: Transformer = getTransformer('encoding.unicode_homoglyph');
export const citationFrame: Transformer = getTransformer('framing.citation');
export const authoritativeMarkupFrame: Transformer = getTransformer('framing.authoritative_markup');
export const mathPromptFrame: Transformer = getTransformer('framing.math_prompt');
export const roleplayFrame: Transformer = getTransformer('framing.roleplay');
export const layerCompose: Transformer = getTransformer('composite.layer');
