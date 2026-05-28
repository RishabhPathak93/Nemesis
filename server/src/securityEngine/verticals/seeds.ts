import type { VerticalPackDefinition } from '../types';

/**
 * Vertical packs — curated probe bundles per industry/scenario. Probe slugs
 * reference probes from the unified CortexView catalog (cortexview_kb +
 * cortexview_curated). The seeder filters out unknown slugs so partial
 * catalogs don't blow up.
 */

export const VERTICAL_PACKS: VerticalPackDefinition[] = [
  {
    slug: 'agent_with_tools',
    title: 'Agents with tool access',
    description: 'For agents that invoke external tools / APIs. Covers BOLA, BFLA, excessive agency, and agent-specific exfiltration risks.',
    probeSlugs: [
      'cortexview_curated.bola.cross_user_record',
      'cortexview_curated.bfla.privileged_action',
      'cortexview_curated.excessive_agency.contract_signoff',
      'cortexview_curated.ecommerce.price_override',
      'cortexview_kb.cv-llm01-025',  // Memory Poisoning (Persistent Indirect Injection)
      'cortexview_kb.cv-llm01-001',  // Direct Prompt Injection — Ignore Previous
      'cortexview_kb.cv-llm01-005',  // Base64 / Hex / ROT13 Encoded Jailbreak
      'cortexview_kb.cv-llm06-001',  // Confused Deputy — Privileged Tool Misuse
    ],
    recommendedStrategies: ['composite.layer', 'multi_turn.crescendo', 'framing.authoritative_markup'],
  },
  {
    slug: 'rag_chatbot',
    title: 'RAG-backed chatbot',
    description: 'For agents that retrieve from a corpus. Covers cross-document leakage, prompt extraction, and indirect prompt injection.',
    probeSlugs: [
      'cortexview_curated.rag_exfil.cross_doc',
      'cortexview_kb.cv-llm07-001',  // Direct System-Prompt Extraction
      'cortexview_kb.cv-llm01-004',  // ASCII / Unicode Tag Smuggling
      'cortexview_kb.cv-llm02-012',  // Cross-User Conversation Bleed
    ],
    recommendedStrategies: ['encoding.base64', 'encoding.ascii_smuggle', 'multi_turn.crescendo'],
  },
  {
    slug: 'medical',
    title: 'Medical / healthcare',
    description: 'Off-label use, hallucinated dosage, anchoring bias, and FDA-disclosure risks.',
    probeSlugs: [
      'cortexview_curated.medical.off_label',
      'cortexview_curated.harmful.suicide_method',
      'cortexview_kb.cv-llm09-003',  // Misleading Legal / Medical Output
      'cortexview_kb.cv-llm09-006',  // Citation Fabrication
    ],
    recommendedStrategies: ['framing.citation', 'multi_turn.crescendo'],
  },
  {
    slug: 'financial',
    title: 'Financial services',
    description: 'Investment-advice line, calculation hallucination, regulated-disclosure compliance.',
    probeSlugs: [
      'cortexview_curated.financial.unsupervised_advice',
      'cortexview_curated.rag_exfil.cross_doc',
      'cortexview_kb.cv-llm09-006',  // Citation Fabrication
      'cortexview_kb.cv-llm09-007',  // Stock-Pump Misinformation
    ],
    recommendedStrategies: ['framing.authoritative_markup', 'multi_turn.crescendo'],
  },
  {
    slug: 'ecommerce',
    title: 'E-commerce',
    description: 'Price manipulation, order fraud, PCI-adjacent data leakage.',
    probeSlugs: [
      'cortexview_curated.ecommerce.price_override',
      'cortexview_curated.bola.cross_user_record',
      'cortexview_kb.cv-llm02-003',  // PII / Credential Probing
    ],
    recommendedStrategies: ['composite.layer', 'multi_turn.crescendo'],
  },
  {
    slug: 'general_chatbot',
    title: 'General-purpose chatbot',
    description: 'Baseline coverage for any conversational AI: jailbreaks, harmful content, hate, bias, prompt injection.',
    probeSlugs: [
      'cortexview_kb.cv-llm01-008',  // DAN / Persona Jailbreak
      'cortexview_curated.violent_crime',
      'cortexview_kb.cv-llm01-005',  // Base64 Encoded Jailbreak
      'cortexview_curated.toxic_continuation',
      'cortexview_kb.cv-llm01-022',  // Hypothetical / Fictional Frame
      'cortexview_curated.harmful.malware_assist',
      'cortexview_curated.harmful.suicide_method',
      'cortexview_curated.hate.ethnic_slur_solicitation',
      'cortexview_kb.cv-llm09-005',  // Bias / Stereotype Amplification
      'cortexview_kb.cv-llm10-001',  // Token-Flood Long-Output Coercion
    ],
    recommendedStrategies: ['encoding.base64', 'multi_turn.crescendo', 'composite.best_of_n'],
  },
  {
    slug: 'developer_assistant',
    title: 'Developer / coding assistant',
    description: 'Hallucinated packages, malware code-write, XSS in emitted markdown.',
    probeSlugs: [
      'cortexview_kb.cv-llm09-002',  // Slopsquatting — Hallucinated Package Names
      'cortexview_curated.harmful.malware_assist',
      'cortexview_kb.cv-llm05-001',  // XSS via Unsanitized Model Output
      'cortexview_kb.cv-llm01-033',  // Glitch Token / Anomalous Vocab Trigger
    ],
    recommendedStrategies: ['composite.best_of_n', 'multi_turn.crescendo'],
  },
];
