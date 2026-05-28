/**
 * Internal storage for the technique registry. Split out from `registry.ts`
 * so that builtin modules can import `register()` without triggering the
 * `import './builtins'` side-effect that lives in `registry.ts`. Splitting
 * breaks the circular-init TDZ that ESM otherwise produces here.
 *
 * Importers should use `registry.ts`, not this file.
 */

import type { Prng } from '../../lib/prng';

export type TechniqueFamily =
  | 'encoding'
  | 'framing'
  | 'multilingual'
  | 'multi_turn'
  | 'adversarial_suffix'
  | 'composite';

export type TechniqueKind = 'deterministic' | 'llm_assisted';

export interface ApplyContext {
  prng?: Prng;
  callLlm?: (system: string, user: string) => Promise<string>;
}

export interface Technique {
  slug: string;
  family: TechniqueFamily;
  kind: TechniqueKind;
  title: string;
  description: string;
  defaultParams?: Record<string, unknown>;
  apply: (payload: string, params?: Record<string, unknown>, ctx?: ApplyContext) => string | Promise<string>;
}

export const REGISTRY = new Map<string, Technique>();

export function register(t: Technique): void {
  if (REGISTRY.has(t.slug) && process.env.NODE_ENV !== 'test') {
    // eslint-disable-next-line no-console
    console.warn(`[strategies] re-registering technique "${t.slug}"`);
  }
  REGISTRY.set(t.slug, t);
}
