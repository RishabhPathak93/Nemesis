/**
 * v2.2 — A5: Orchestrator dispatcher for the main scan loop.
 *
 * A TestCase whose `strategyChain` contains a multi-turn or composite
 * orchestrator slug (e.g. `multi_turn.crescendo`, `composite.best_of_n`,
 * `adversarial_suffix.suffix_corpus`) takes a different path through the
 * runner: instead of `sendToAgent` + oracle on a single response, the
 * orchestrator drives the conversation itself and returns the worst
 * captured response, which the oracle then evaluates as normal.
 *
 * Slug → orchestrator mapping is in `ORCHESTRATORS`. To add a new
 * orchestrator: implement the `Orchestrator` interface, register here.
 */

import { randomBytes } from 'node:crypto';
import { crescendoOrchestrator } from '../securityEngine/orchestrators/crescendo';
import { tapOrchestrator } from '../securityEngine/orchestrators/tap';
import { goatOrchestrator } from '../securityEngine/orchestrators/goat';
import { skeletonKeyOrchestrator } from '../securityEngine/orchestrators/skeletonKey';
import { bestOfNOrchestrator } from '../securityEngine/orchestrators/bestOfN';
import { suffixCorpusOrchestrator } from '../securityEngine/orchestrators/suffixCorpus';
import type { Orchestrator, OrchestratorResult } from '../securityEngine/orchestrators/types';
import { logger } from '../lib/logger';

const ORCHESTRATORS: Record<string, Orchestrator> = {
  'multi_turn.crescendo': crescendoOrchestrator,
  'multi_turn.tap': tapOrchestrator,
  'multi_turn.goat': goatOrchestrator,
  'multi_turn.skeleton_key': skeletonKeyOrchestrator,
  'composite.best_of_n': bestOfNOrchestrator,
  'adversarial_suffix.suffix_corpus': suffixCorpusOrchestrator,
};

/** Returns the orchestrator slug if the chain triggers one, else null. */
export function pickOrchestrator(strategyChain: string[]): string | null {
  for (const slug of strategyChain) {
    // Strip params (e.g. `multilingual.translate:zu`) before lookup.
    const key = slug.split(':')[0];
    if (key in ORCHESTRATORS) return key;
  }
  return null;
}

export interface DispatchArgs {
  orgId: string;
  targetAgentId: string;
  seed: string;
  threadId?: string;
  maxTurns?: number;
}

/**
 * Run the named orchestrator and return the worst captured response (which
 * the oracle then evaluates). Errors are surfaced as `[AGENT_ERROR …]` so
 * the oracle treats the case as infra-error rather than security finding.
 */
export async function dispatchOrchestrator(
  slug: string,
  args: DispatchArgs,
): Promise<OrchestratorResult> {
  const orch = ORCHESTRATORS[slug];
  if (!orch) {
    return {
      worstResponse: `[AGENT_ERROR] unknown orchestrator slug "${slug}"`,
      transcript: [],
      succeeded: false,
      rationale: 'unknown orchestrator',
      turnsUsed: 0,
    };
  }
  const threadId = args.threadId || `dispatch_${randomBytes(6).toString('hex')}`;
  try {
    return await orch({
      orgId: args.orgId,
      targetAgentId: args.targetAgentId,
      seed: args.seed,
      threadId,
      maxTurns: args.maxTurns,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, slug, agentId: args.targetAgentId }, 'orchestrator failed');
    return {
      worstResponse: `[AGENT_ERROR] orchestrator ${slug} failed: ${msg}`,
      transcript: [],
      succeeded: false,
      rationale: `orchestrator failed: ${msg}`,
      turnsUsed: 0,
    };
  }
}

export const _ORCHESTRATOR_SLUGS = Object.keys(ORCHESTRATORS);
