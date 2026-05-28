/**
 * SE-4 — multi-turn orchestrator interface. An orchestrator drives a
 * conversation against a target agent and returns the most-harmful
 * response captured during the run, plus a per-turn transcript.
 */

export interface OrchestratorContext {
  orgId: string;
  targetAgentId: string;
  /** The seed payload (post strategy chain). */
  seed: string;
  /** Optional thread id; orchestrator persists ConversationTurn rows under it. */
  threadId: string;
  /** Optional cap on turns. */
  maxTurns?: number;
}

export interface OrchestratorTurn {
  turn: number;
  role: 'attacker' | 'target' | 'judge';
  content: string;
  metadata?: Record<string, unknown>;
}

export interface OrchestratorResult {
  /** The most concerning target response captured. */
  worstResponse: string;
  /** Turn-by-turn transcript (also persisted to ConversationTurn). */
  transcript: OrchestratorTurn[];
  /** Was the target induced to comply with the harmful intent at any turn? */
  succeeded: boolean;
  /** Reason text from the orchestrator's internal judgement. */
  rationale: string;
  turnsUsed: number;
}

export type Orchestrator = (ctx: OrchestratorContext) => Promise<OrchestratorResult>;
