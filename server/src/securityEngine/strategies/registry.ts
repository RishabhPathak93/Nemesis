/**
 * v2.2 — Plug-in strategy registry (E1) public API.
 *
 * Internal storage lives in `registryCore.ts` to avoid a circular-import
 * TDZ when builtin modules call `register()` during their own module
 * initialisation.
 *
 * Adding a new technique:
 *   1. Write a file under `builtins/your-technique.ts` exporting a `Technique`
 *      and calling `register(yourTechnique)`.
 *   2. Add one `import './your-technique';` line to `builtins/index.ts`.
 *
 * No other module changes.
 */

import './builtins'; // side-effect: registers every builtin
import {
  REGISTRY,
  type Technique,
  type TechniqueFamily,
  type ApplyContext,
} from './registryCore';

// Re-export the public types so callers don't have to know about registryCore.
export type {
  Technique,
  TechniqueFamily,
  TechniqueKind,
  ApplyContext,
} from './registryCore';
export { register } from './registryCore';

export function getTechnique(slug: string): Technique | undefined {
  return REGISTRY.get(slug);
}

export function listTechniques(): Technique[] {
  return [...REGISTRY.values()];
}

export function listSlugsByFamily(family: TechniqueFamily): string[] {
  return [...REGISTRY.values()].filter((t) => t.family === family).map((t) => t.slug);
}

/**
 * Apply a chain of slugs to a seed payload. Unknown slugs are skipped
 * silently. Async: supports LLM-assisted techniques (translate, etc.).
 */
export async function applyStrategyChain(
  payload: string,
  slugs: string[],
  params: Record<string, Record<string, unknown>> = {},
  ctx?: ApplyContext,
): Promise<string> {
  let out = payload;
  for (const slug of slugs) {
    const t = REGISTRY.get(slug);
    if (!t) continue;
    out = await t.apply(out, params[slug], ctx);
  }
  return out;
}

/** Sync variant — throws if any technique returns a Promise. */
export function applyStrategyChainSync(
  payload: string,
  slugs: string[],
  params: Record<string, Record<string, unknown>> = {},
  ctx?: ApplyContext,
): string {
  let out = payload;
  for (const slug of slugs) {
    const t = REGISTRY.get(slug);
    if (!t) continue;
    const result = t.apply(out, params[slug], ctx);
    if (result instanceof Promise) {
      throw new Error(`technique "${slug}" is async; use applyStrategyChain (await) instead`);
    }
    out = result;
  }
  return out;
}

/** Test-only: clear the registry. */
export function _resetForTests(): void {
  REGISTRY.clear();
}
