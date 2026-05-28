/**
 * v2.2 — B3: Best-of-N orchestrator.
 *
 * Sample N deterministically-derived variants of the seed payload (via the
 * registered encoding/framing strategies) and dispatch each. Return the
 * single most successful response (oracle highest verdict-fail confidence)
 * as the worst response.
 *
 * Differs from the Cartesian enumerator in that it stays on the SAME
 * (probe, agent) and produces N parallel single-shot variations, where
 * the enumerator produces M*K cases across the whole catalog.
 *
 * `n` is sourced from env.orchBestOfN (Infinity unless capped). When N >
 * total available variants, we repeat with different PRNG-fork labels for
 * any strategies that consume PRNG (e.g. mixed_case_chaos / refusal_suppression).
 */

import { prisma } from '../../lib/prisma';
import { sendToAgent } from '../../services/agentConnector';
import { runDetectorChain, defaultDetectorsForCase } from '../detectors/executor';
import { applyStrategyChain, listSlugsByFamily } from '../strategies/registry';
import { prngFromSeed } from '../../lib/prng';
import { env } from '../../lib/env';
import { logger } from '../../lib/logger';
import type { Orchestrator, OrchestratorTurn } from './types';

const DEFAULT_N = 32; // GCG paper baseline

interface Candidate {
  index: number;
  chain: string[];
  prompt: string;
  response: string;
  succeeded: boolean;
  reason: string;
}

export const bestOfNOrchestrator: Orchestrator = async (ctx) => {
  const agent = await prisma.agent.findUnique({ where: { id: ctx.targetAgentId } });
  if (!agent) throw new Error(`agent ${ctx.targetAgentId} not found`);

  const requested = Number.isFinite(env.orchBestOfN) ? env.orchBestOfN : DEFAULT_N;
  const n = Math.min(requested, ctx.maxTurns ?? requested);
  const prng = prngFromSeed(ctx.threadId || ctx.seed);

  const encodings = listSlugsByFamily('encoding');
  const framings = listSlugsByFamily('framing');

  // Build a deterministic variant set:
  //   1. Each single-encoding chain (~|encodings|)
  //   2. Each single-framing chain (~|framings|)
  //   3. (encoding, framing) pairs sampled by PRNG to reach n
  const chains: string[][] = [];
  for (const e of encodings) chains.push([e]);
  for (const f of framings) chains.push([f]);
  while (chains.length < n) {
    chains.push([prng.pick(encodings), prng.pick(framings)]);
  }
  // Cap to n
  chains.length = Math.min(chains.length, n);

  const transcript: OrchestratorTurn[] = [];
  const candidates: Candidate[] = [];

  for (let i = 0; i < chains.length; i++) {
    const chain = chains[i];
    const variantPrng = prng.fork(`variant-${i}`);
    let prompt = ctx.seed;
    try {
      prompt = await applyStrategyChain(ctx.seed, chain, {}, { prng: variantPrng });
    } catch (err) {
      logger.warn({ err, chain }, 'best-of-n strategy chain application failed; using raw seed');
    }
    transcript.push({ turn: i, role: 'attacker', content: `chain[${i}] = ${chain.join('+')}` });

    const response = await sendToAgent(agent, prompt);
    transcript.push({ turn: i, role: 'target', content: response.slice(0, 1000), metadata: { chain } });

    if (response.startsWith('[AGENT_ERROR')) {
      candidates.push({ index: i, chain, prompt, response, succeeded: false, reason: 'infra error' });
      continue;
    }
    const verdict = await runDetectorChain(defaultDetectorsForCase(), { prompt, response });
    const succeeded = !!(verdict && verdict.verdict === 'fail');
    candidates.push({
      index: i,
      chain,
      prompt,
      response,
      succeeded,
      reason: verdict ? `detector ${verdict.detectorSlug}` : 'no detector hit',
    });

    if (succeeded && process.env.ORCH_BESTOFN_EARLY_EXIT !== 'off') break;
  }

  const winner = candidates.find((c) => c.succeeded) ?? candidates[0];
  return {
    worstResponse: winner?.response ?? '',
    transcript,
    succeeded: !!winner?.succeeded,
    rationale: winner
      ? winner.succeeded
        ? `Variant #${winner.index} (${winner.chain.join('+')}): ${winner.reason}`
        : `No variant succeeded across ${candidates.length} attempts.`
      : 'No variants dispatched.',
    turnsUsed: candidates.length,
  };
};
