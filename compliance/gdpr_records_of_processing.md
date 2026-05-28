# GDPR Article 30 — Records of Processing

*{{ORG_NAME}} · CortexView platform · {{REPORTING_PERIOD}}*

This document is the Article 30 record of processing activities for the
operator's deployment of CortexView. Update on policy changes; review
half-yearly.

## 1. Controller

- **Name**: {{ORG_NAME}}
- **Contact**: {{PRIVACY_CONTACT_EMAIL}}
- **DPO** (if appointed): {{DPO_NAME}}, {{DPO_EMAIL}}

## 2. Purposes of processing

Operating an internal AI security testing platform. Processing of
personal data is incidental to that purpose and limited to the
account, audit, and operational data described in
`privacy_policy.template.md` §1.

## 3. Categories of data subjects

- Internal employees / contractors granted access to the platform.
- Indirect: any individuals named in test data the operator chooses
  to upload (rare; CortexView is target-agnostic).

## 4. Categories of personal data

| Category | Examples | Source |
|---|---|---|
| Account | email, name, role, MFA secret (encrypted) | provided by user / SSO |
| Activity | audit log, login attempts, IP, user agent | system-generated |
| Test inputs | agent endpoints, system prompts, attack prompts | provided by analyst |
| Test outputs | target agent responses (may incidentally include PII) | external LLM |

## 5. Recipients

- Operator's internal staff (admins, analysts).
- Configured LLM provider (Anthropic / OpenAI / Gemini / local Ollama).
- Configured search provider (Tavily / Brave) when adaptive research
  is enabled.
- Configured notification destinations (email / Slack / Teams / webhook).

## 6. International transfers

- Not by default. Becomes "yes" when the operator configures a
  cross-border LLM or search provider.
- Lawful-basis: SCCs / IDTA / supplementary measures, per the
  operator's contracts with those providers.

## 7. Retention

See `privacy_policy.template.md` §5.

## 8. Technical & organisational measures

See `soc2_controls_matrix.md` and `iso27001_isms_skeleton.md`.

Summary: encryption at rest for secrets, MFA, scoped API keys, audit
log, IP allowlist, retention sweeper, soft-delete with anonymisation
on right-to-be-forgotten.

## 9. Audit

- Audit log: 365-day retention, append-only.
- Access reviews: quarterly via the Compliance Evidence Collector.
- Incident reporting: 72-hour notification per Art 33 (when required).
