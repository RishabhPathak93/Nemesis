export interface User {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'ANALYST' | 'VIEWER';
  orgId: string;
  orgName: string;
  mfaEnabled?: boolean;
}

export interface AuthSession {
  id: string;
  issuedAt: string;
  expiresAt: string;
  userAgent: string | null;
  ip: string | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  actorType: string;
  actorId: string | null;
  actor: { id: string; name: string; email: string } | null;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdBy?: { name: string; email: string };
}

export interface ShareSettings {
  shareToken: string;
  shareEnabled: boolean;
  shareExpiresAt: string | null;
  shareRevokedAt: string | null;
}

export interface Agent {
  id: string;
  orgId: string;
  name: string;
  agentType: string;
  model: string;
  endpointUrl: string;
  apiKey: string;
  requestFormat: unknown;
  responsePath: string;
  systemPrompt: string | null;
  statedPurpose: string | null;
  knownGuardrails: string | null;
  sensitiveDataScope: string[];
  userAccessLevel: string;
  understanding: AgentUnderstanding | null;
  riskScore: number | null;
  status: string;
  lastTestedAt: string | null;
  createdAt: string;
  testSuites?: TestSuiteSummary[];
}

export interface AgentUnderstanding {
  summary: string;
  attack_surfaces: string[];
  risk_categories: string[];
  recommended_focus_areas: string[];
  risk_rationale: string;
}

export interface TestSuiteSummary {
  id: string;
  agentId: string;
  createdAt: string;
  testRuns?: TestRunSummary[];
  _count?: { testCases: number };
}

export interface TestRunSummary {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  progress: number;
  totalTests: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  /**
   * v2.2 — which enumeration engine produced this run.
   *   "cartesian" → Deep Scan (full probe × strategy enumeration)
   *   "llm"       → Quick Scan (LLM-curated creative subset)
   */
  enumerationMode?: 'llm' | 'cartesian';
  report?: { id: string; riskScore: number; overallRiskRating: string } | null;
}

export interface TestRunStatus {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  phase: 'preparing' | 'executing' | 'reporting' | null;
  phaseDetail: string | null;
  progress: number;
  totalTests: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  summary: { pass: number; fail: number; partial: number; error: number };
  agentId: string;
  agentName: string;
}

export interface KeyFinding {
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  evidence: string;
  recommendation: string;
  /** External TC-XXX ids this finding is reproducing. Optional for older reports. */
  related_test_ids?: string[];
}

export interface CategoryBreakdownItem {
  category: string;
  total_tests: number;
  failures: number;
  pass_rate: number;
  commentary: string;
}

export interface RoadmapItem {
  priority: 'immediate' | 'short_term' | 'long_term';
  action: string;
  rationale: string;
}

export interface ReportListItem {
  id: string;
  testRunId: string;
  agentId: string;
  agentName: string;
  createdAt: string;
  riskScore: number;
  overallRiskRating: string;
  criticalFindings: number;
  highFindings: number;
  shareToken: string;
}

export interface FullReport {
  id: string;
  testRunId: string;
  createdAt: string;
  executiveSummary: string;
  overallRiskRating: 'critical' | 'high' | 'medium' | 'low';
  riskScore: number;
  keyFindings: KeyFinding[];
  categoryBreakdown: CategoryBreakdownItem[];
  remediationRoadmap: RoadmapItem[];
  technicalNotes: string;
  conclusion: string;
  shareToken: string;
  agent: { id: string; name: string; agentType: string; model: string };
  testRun: { id: string; startedAt: string | null; completedAt: string | null; totalTests: number };
  results: TestResultDetail[];
}

export interface TestResultDetail {
  id: string;
  result: 'pass' | 'fail' | 'partial' | 'error';
  confidence: number;
  reasoning: string;
  exploitationEvidence: string | null;
  agentResponse: string;
  testCase: {
    externalId: string;
    category: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    name: string;
    description: string;
    attackPrompt: string;
  };
}

export interface DashboardStats {
  totalAgents: number;
  totalTestRuns: number;
  criticalFindings: number;
  severityBreakdown: { critical: number; high: number; medium: number; low: number };
  recentActivity: Array<{
    testRunId: string;
    agentId: string;
    agentName: string;
    status: string;
    progress: number;
    createdAt: string;
    completedAt: string | null;
    reportId: string | null;
    riskScore: number | null;
    overallRiskRating: string | null;
  }>;
}

export type LlmProvider = 'anthropic' | 'openai' | 'openai_compatible' | 'ollama' | 'gemini';

export interface OrgInfo {
  id: string;
  name: string;
  anthropicApiKeyMasked: string | null;
  llmProvider: LlmProvider | null;
  llmApiKeyMasked: string | null;
  llmModel: string | null;
  llmBaseUrl: string | null;
  notifyOnComplete: boolean;
  notifyOnCritical: boolean;
  enableLearning: boolean;
  enableResearch: boolean;
  searchProvider: 'tavily' | 'brave' | null;
  searchApiKeyMasked: string | null;
  requireMfa: boolean;
  mfaEnforcedAt: string | null;
}

/**
 * @deprecated The server merged AttackPattern + KnowledgeArticle into the
 * unified `Probe` model. This type stays as the over-the-wire shape returned
 * by the back-compat `/knowledge/patterns` endpoint, which projects Probe rows
 * with `source='cortexview_learned'`. New code should query
 * `/security-engine/probes?source=cortexview_learned` directly.
 */
export interface AttackPattern {
  id: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  name: string;
  pattern: string;
  rationale: string;
  applicableContext: string;
  effectiveness: number;
  timesSeen: number;
  timesEffective: number;
  sourceTestCaseId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchSnapshot {
  id: string;
  topic: string;
  query: string;
  summary: string;
  findings: Array<{ title: string; url: string; snippet: string; publishedAt?: string }>;
  createdAt: string;
}

export interface KnowledgeStats {
  patternCount: number;
  researchCount: number;
  articleCount: number;
  learningEnabled: boolean;
  researchEnabled: boolean;
  researchProvider: 'tavily' | 'brave' | null;
  researchReady: boolean;
}

/**
 * @deprecated Replaced server-side by `Probe`. Stays as the wire format
 * returned by `/knowledge/articles`, which projects Probe rows whose
 * `source` is part of the curated Nemesis AI catalog. New code should hit
 * `/security-engine/probes` directly.
 */
export interface KnowledgeArticle {
  id: string;
  orgId: string | null;
  externalId: string;
  title: string;
  category: string;
  subcategory: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'informational' | string;
  cvssEstimate: number | null;
  targets: string[];
  attackVector: string | null;
  preconditions: string | null;
  description: string;
  payloads: string[];
  variations: string[];
  expectedVulnerableBehavior: string | null;
  expectedSafeBehavior: string | null;
  detectionSignatures: {
    input_regex?: string[];
    output_regex?: string[];
    output_indicators?: string[];
    behavioral?: string;
  } | null;
  automationHints: {
    judge_prompt?: string;
    retry_strategy?: string;
  } | null;
  mitigations: string[];
  referenceUrls: string[];
  frameworks: {
    owasp_llm_top10_2025?: string;
    mitre_atlas?: string[];
    nist_ai_100_2?: string[];
  } | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeArticleCategory {
  category: string;
  count: number;
}

export interface OrgMembers {
  users: Array<{
    id: string;
    email: string;
    name: string;
    role: string;
    createdAt: string;
    isActive?: boolean;
    deactivatedAt?: string | null;
    mfaEnabled?: boolean;
    lastLoginAt?: string | null;
  }>;
  invites: Array<{ id: string; email: string; role: string; createdAt: string; expiresAt?: string | null }>;
}
