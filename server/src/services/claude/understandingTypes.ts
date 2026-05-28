import { z } from 'zod';
import { PIPELINE_TIMEOUTS } from '../../lib/llm';

/** Distilled, machine-consumed profile stored in Agent.understanding. */
export interface AgentUnderstanding {
  summary: string;
  attack_surfaces: string[];
  risk_categories: string[];
  recommended_focus_areas: string[];
  risk_rationale: string;
  // Interactive-understanding additions (all optional for back-compat with
  // profiles produced before this feature shipped).
  discovered_purpose?: string;
  observed_capabilities?: string[];
  observed_constraints?: string[];
  refusal_behavior?: string;
  probe_reactions?: Array<{ type: string; what_happened: string; severity_hint: 'low' | 'medium' | 'high' }>;
  confidence?: number;
  source?: 'interactive' | 'static_fallback';
}

/** One interrogation turn, persisted to Agent.understandingTranscript. */
export interface Turn {
  turn: number;
  objective: string;
  message: string;
  reply: string;
  at: string; // ISO timestamp
}

export interface InterrogationResult {
  profile: AgentUnderstanding;
  transcript: Turn[];
  source: 'interactive' | 'static_fallback';
}

export interface InterrogationConfig {
  enabled: boolean;
  maxTurns: number;
  maxWallMs: number;
  maxTranscriptChars: number;
  perCallTimeoutMs: number;
}

/** Env-backed config. Reads process.env directly (matches PIPELINE_TIMEOUTS pattern). */
export const INTERROGATION_CONFIG: InterrogationConfig = {
  enabled: (process.env.UNDERSTANDING_INTERROGATION_ENABLED ?? 'true').toLowerCase() !== 'false',
  maxTurns: Number(process.env.UNDERSTANDING_MAX_TURNS ?? '12') || 12,
  maxWallMs: Number(process.env.UNDERSTANDING_MAX_WALL_MS ?? '') || PIPELINE_TIMEOUTS.understanding * 6,
  maxTranscriptChars: Number(process.env.UNDERSTANDING_MAX_TRANSCRIPT_CHARS ?? '6000') || 6000,
  perCallTimeoutMs: PIPELINE_TIMEOUTS.understanding,
};

/** What the interrogator LLM must return each turn. */
export const interrogatorTurnSchema = z.object({
  next_message: z.string().min(1),
  target_objective: z.string().min(1),
  done: z.boolean(),
});
export type InterrogatorTurn = z.infer<typeof interrogatorTurnSchema>;

/** What the distiller LLM must return (we attach `source` ourselves afterward). */
export const distilledProfileSchema = z.object({
  summary: z.string(),
  attack_surfaces: z.array(z.string()),
  risk_categories: z.array(z.string()),
  recommended_focus_areas: z.array(z.string()),
  risk_rationale: z.string(),
  discovered_purpose: z.string(),
  observed_capabilities: z.array(z.string()),
  observed_constraints: z.array(z.string()),
  refusal_behavior: z.string(),
  probe_reactions: z.array(z.object({
    type: z.string(),
    what_happened: z.string(),
    severity_hint: z.enum(['low', 'medium', 'high']),
  })),
  confidence: z.number().min(0).max(1),
});
