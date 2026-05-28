/**
 * Shared types for Security Engine v2 (SE-1 foundation).
 * Loaders, seeders, and the controller all consume these shapes.
 */

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type ProbeSource = 'cortexview_kb' | 'cortexview_curated' | 'cortexview_learned';

/** Application contexts a probe is appropriate for. */
export type Applicability = 'chatbot' | 'rag' | 'agent' | 'tool_use' | 'multimodal';

export type ComplianceFramework =
  | 'OWASP_LLM_TOP10'
  | 'MITRE_ATLAS'
  | 'NIST_AI_RMF'
  | 'EU_AI_ACT'
  | 'OWASP_API_TOP10';

export interface ComplianceTag {
  framework: ComplianceFramework;
  controlId: string;       // e.g. "LLM01", "AML.T0040", "Art_15"
  notes?: string;
}

/** A probe definition before it's persisted to the DB. */
export interface ProbeDefinition {
  slug: string;            // unique; "<source>.<category>.<id>"
  source: ProbeSource;
  version?: number;
  category: string;
  subcategory?: string;
  severity: Severity;
  title: string;
  description: string;
  seedPayload: string;
  expectedFailIndicators?: string[];
  expectedPassIndicators?: string[];
  applicability?: Applicability[];
  defaultDetectorIds?: string[];
  defaultStrategies?: string[];
  compliance?: ComplianceTag[];
  metadata?: Record<string, unknown>;
}

export interface StrategyDefinition {
  slug: string;            // "encoding.base64", "multi_turn.crescendo"
  family: 'encoding' | 'multilingual' | 'framing' | 'multi_turn' | 'adversarial_suffix' | 'composite';
  kind: 'deterministic' | 'llm_assisted';
  title: string;
  description: string;
  implFn?: string | null;
  orchestratorClass?: string | null;
  paramSchema?: Record<string, unknown> | null;
  defaultParams?: Record<string, unknown> | null;
}

export interface DetectorDefinition {
  slug: string;            // "regex.pii_email", "classifier.toxicity", "llm_judge.cv_evaluator"
  kind: 'regex' | 'signature' | 'classifier' | 'llm_judge';
  title: string;
  description: string;
  config: Record<string, unknown>;
}

export interface VerticalPackDefinition {
  slug: string;            // "medical","financial","insurance","pharmacy","ecommerce","agent_with_tools","rag_chatbot"
  title: string;
  description: string;
  // Probe selection by slug (we resolve to ids at seed time)
  probeSlugs: string[];
  recommendedStrategies: string[];
}
