/**
 * Compliance framework control catalogues — used by the heatmap UI to render
 * the rows. Probe→control mappings live on each ProbeDefinition.compliance[]
 * and are persisted as ProbeComplianceMapping rows.
 */

export interface ControlEntry {
  id: string;          // canonical id used in mappings
  title: string;
  shortDescription: string;
}

export const OWASP_LLM_TOP10_2025: ControlEntry[] = [
  { id: 'LLM01', title: 'Prompt Injection', shortDescription: 'Direct or indirect manipulation of model inputs to override intended behaviour.' },
  { id: 'LLM02', title: 'Sensitive Information Disclosure', shortDescription: 'Leakage of confidential, proprietary, or personal data via model outputs.' },
  { id: 'LLM03', title: 'Supply Chain', shortDescription: 'Compromise via fine-tuning data, third-party plugins, or hallucinated dependencies.' },
  { id: 'LLM04', title: 'Data and Model Poisoning', shortDescription: 'Adversarial training data or memory contamination that biases the model.' },
  { id: 'LLM05', title: 'Improper Output Handling', shortDescription: 'Unsafe propagation of model output into downstream systems (XSS, SSRF, code).' },
  { id: 'LLM06', title: 'Excessive Agency', shortDescription: 'Agents granted too much autonomy / privilege over external actions.' },
  { id: 'LLM07', title: 'System Prompt Leakage', shortDescription: 'Exposure of internal prompts, rules, and credentials embedded in them.' },
  { id: 'LLM08', title: 'Vector and Embedding Weaknesses', shortDescription: 'RAG-specific risks: cross-document leakage, embedding inversion, retrieval poisoning.' },
  { id: 'LLM09', title: 'Misinformation', shortDescription: 'Hallucinations, fabricated citations, confident wrong answers.' },
  { id: 'LLM10', title: 'Unbounded Consumption', shortDescription: 'Resource exhaustion via amplification (token-burn, query loops, infinite output).' },
];

export const MITRE_ATLAS: ControlEntry[] = [
  { id: 'AML.T0010', title: 'ML Supply Chain Compromise', shortDescription: 'Compromise of training data, model file, or dependency.' },
  { id: 'AML.T0040', title: 'ML Model Inference API Access', shortDescription: 'Adversarial use of legitimate inference access.' },
  { id: 'AML.T0048', title: 'External Harms', shortDescription: 'AI-enabled real-world harm (financial, physical, reputational).' },
  { id: 'AML.T0051', title: 'LLM Prompt Injection', shortDescription: 'Direct or indirect injection used to subvert guardrails.' },
  { id: 'AML.T0054', title: 'LLM Jailbreak', shortDescription: 'Bypass of safety alignment via adversarial prompting.' },
];

export const NIST_AI_RMF: ControlEntry[] = [
  { id: 'GV-1.4', title: 'Govern — AI risk-management policies (resourcing)', shortDescription: 'Policies for AI risk decisions, roles, and resourcing.' },
  { id: 'GV-3.2', title: 'Govern — Roles and responsibilities', shortDescription: 'Accountability for AI risk decisions across the lifecycle.' },
  { id: 'MS-1.2', title: 'Measure — Approved methods are applied', shortDescription: 'Verification that the AI system functions as intended.' },
  { id: 'MS-1.3', title: 'Measure — Validity and reliability', shortDescription: 'Performance of the AI system across known conditions.' },
  { id: 'MS-2.2', title: 'Measure — Privacy risk', shortDescription: 'Identifying and controlling privacy-related risks.' },
  { id: 'MS-2.6', title: 'Measure — Safety risk', shortDescription: 'Risks of AI-enabled harm to people, property, or environment.' },
  { id: 'MS-2.7', title: 'Measure — Bias and fairness', shortDescription: 'Identifying and managing harmful bias.' },
  { id: 'MS-2.10', title: 'Measure — Security risk', shortDescription: 'Risks of AI-system compromise or misuse for attack.' },
];

export const EU_AI_ACT: ControlEntry[] = [
  { id: 'Art_9', title: 'Risk Management System', shortDescription: 'Mandatory continuous risk-management for high-risk AI systems.' },
  { id: 'Art_10', title: 'Data and Data Governance', shortDescription: 'Quality criteria for training, validation, and testing data.' },
  { id: 'Art_13', title: 'Transparency and Provision of Information to Users', shortDescription: 'Disclosure of capabilities, limitations, and behavioural drift.' },
  { id: 'Art_14', title: 'Human Oversight', shortDescription: 'Effective human oversight of high-risk AI systems.' },
  { id: 'Art_15', title: 'Accuracy, Robustness, and Cybersecurity', shortDescription: 'Resistance to errors, faults, and adversarial attempts.' },
];

export const OWASP_API_TOP10: ControlEntry[] = [
  { id: 'API1', title: 'Broken Object Level Authorization', shortDescription: 'Object-level access checks bypassed.' },
  { id: 'API2', title: 'Broken Authentication', shortDescription: 'Auth flaws permitting impersonation.' },
  { id: 'API3', title: 'Broken Object Property Level Authorization', shortDescription: 'Excessive data exposure / mass assignment.' },
  { id: 'API4', title: 'Unrestricted Resource Consumption', shortDescription: 'Lack of rate-limit / quota.' },
  { id: 'API5', title: 'Broken Function Level Authorization', shortDescription: 'Privileged endpoints reachable as a regular user.' },
  { id: 'API8', title: 'Security Misconfiguration', shortDescription: 'Insecure defaults, excessive permissions.' },
];

export const FRAMEWORK_REGISTRY = {
  OWASP_LLM_TOP10: OWASP_LLM_TOP10_2025,
  MITRE_ATLAS,
  NIST_AI_RMF,
  EU_AI_ACT,
  OWASP_API_TOP10,
} as const;

export type FrameworkKey = keyof typeof FRAMEWORK_REGISTRY;
