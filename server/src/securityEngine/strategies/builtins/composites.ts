/**
 * v2.2 — Composite strategies (chain runners + best-of-N selectors).
 */

import { register, REGISTRY, type Technique } from '../registryCore';

/**
 * Preserved from encoders.ts. Run a sub-chain of slugs on the payload.
 * Pure-deterministic — no async sub-techniques allowed.
 *
 * We reach into REGISTRY directly here (rather than importing
 * `applyStrategyChainSync` from `registry.ts`) to avoid a circular import:
 * `registry.ts` imports `./builtins`, which would import back into
 * `registry.ts` if we used the sync helper.
 */
const layer: Technique = {
  slug: 'composite.layer',
  family: 'composite',
  kind: 'deterministic',
  title: 'Layered composition',
  description: 'Run the given sub-chain of strategy slugs in order. params.steps = string[].',
  defaultParams: { steps: [] },
  apply: (payload, params, ctx) => {
    const steps = (params?.steps as string[] | undefined) ?? [];
    let out = payload;
    for (const slug of steps) {
      const t = REGISTRY.get(slug);
      if (!t) continue;
      const next = t.apply(out, undefined, ctx);
      if (next instanceof Promise) {
        throw new Error(`composite.layer: sub-technique "${slug}" is async; not supported in sync composite`);
      }
      out = next;
    }
    return out;
  },
};

register(layer);
