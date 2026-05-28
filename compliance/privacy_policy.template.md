# Privacy Policy — {{ORG_NAME}}

*Effective {{EFFECTIVE_DATE}} · Version {{VERSION}}*

This privacy policy describes how {{ORG_NAME}} (the "Operator") processes
personal data inside the CortexView AI security testing platform when
deployed in a self-hosted configuration.

## 1. Data we process

CortexView is an inward-facing security testing tool. The personal data we
process is limited to:

- **Account data** — email, display name, role, MFA secrets (encrypted at
  rest), refresh tokens (hashed at rest), session metadata (IP, user agent).
- **Audit log** — every authenticated mutation (e.g. signing in, creating an
  agent, running a test) is recorded with the actor's id, request id, IP,
  and a redacted metadata diff.
- **Login attempts** — successful and failed sign-in records (email, IP,
  reason) used for lockout and abuse detection.
- **Test data** — inputs you supply (the prompts, target agent endpoints,
  configured LLM API keys — encrypted at rest) and the responses your target
  agents produce.

## 2. Data we do NOT process

- We do not collect telemetry, analytics, crash reports, or product
  usage data. CortexView phones home to **nothing**. The only outbound
  traffic is to the LLM provider, search provider, and notification
  channels you explicitly configure.
- We do not sell, share, or rent personal data to third parties.

## 3. Lawful basis (GDPR Art 6)

Where GDPR applies, our lawful basis is **legitimate interest** under
Art 6(1)(f): operating a security testing platform. Where consent is the
appropriate basis (e.g. account creation), we collect explicit acceptance
of this policy via the in-product privacy gate.

## 4. Data subject rights (GDPR Arts 15–22, CCPA §1798.105)

Submit a Data Subject Request inside the product at
**Compliance → Data subject requests**. We support:

- **Access / portability** (Art 15, 20) — JSON export of your account data,
  authored audit rows, and test results.
- **Erasure** (Art 17) — anonymise the user record (email, name); retain
  audit-log rows with `actorId=NULL` for forensic continuity.
- **Restriction / objection** (Arts 18, 21) — contact your operator.

We process EXPORT requests synchronously. DELETE requests require admin
approval and run within 30 days.

## 5. Data retention

| Data class | Retention |
|---|---|
| Audit log | 365 days |
| Login attempts | 90 days |
| Refresh tokens (revoked/expired) | 7 days |
| Webhook deliveries | 90 days |
| Scheduled report runs | 180 days |
| Soft-deleted agents | 30 days |
| Test runs / results | per-org policy (default unbounded) |

Operators may shorten retention via `OrgPolicy.retentionDays*` overrides.

## 6. Encryption & security

- Secrets (LLM API keys, MFA secrets, webhook signing secrets, SAML/OIDC
  client secrets) are encrypted at rest with AES-256-GCM under
  `ENCRYPTION_KEY`. Operators rotate that key via the documented procedure
  (see OPERATOR.md §7).
- Transport security is the operator's responsibility (HTTPS via reverse
  proxy in production).
- MFA is mandatory at the org's discretion. Hardware-key (WebAuthn) and
  TOTP are both supported.

## 7. Sub-processors

CortexView itself has no sub-processors. The LLM provider you configure
(Anthropic / OpenAI / Gemini / your local Ollama) processes the content of
your tests. Review their privacy notices.

## 8. International transfers

If you configure an LLM or search provider outside your jurisdiction,
content of your tests may be transferred there. The operator is
responsible for the lawful basis of that transfer.

## 9. Contact

Privacy enquiries: {{PRIVACY_CONTACT_EMAIL}}
