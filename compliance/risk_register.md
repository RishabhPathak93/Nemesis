# Risk Register — CortexView

*Maintained by the operator. Last updated {{LAST_UPDATED}}.*

| ID | Risk | Likelihood | Impact | Inherent | Mitigation | Residual | Owner | Review date |
|---|---|---|---|---|---|---|---|---|
| R-01 | Compromise of `ENCRYPTION_KEY` | Low | High | High | OPERATOR.md §7 rotation; KMS envelope (v2.0) | Medium | Security | {{REVIEW_DATE}} |
| R-02 | Mass account compromise (credential stuffing) | Medium | High | High | MFA, lockout @10, IP allowlist, SSO-only mode | Low | Security | {{REVIEW_DATE}} |
| R-03 | Webhook receiver compromise | Medium | Medium | Medium | HMAC-SHA256 signing, 24h secret-rotation overlap | Low | Eng | {{REVIEW_DATE}} |
| R-04 | LLM provider data leakage | Low | Medium | Low | Operator picks provider; no telemetry from CV; Privacy gate | Low | Compliance | {{REVIEW_DATE}} |
| R-05 | Stale soft-deleted data lingering | Low | Low | Low | Retention sweeper; `record.purged_by_retention` audit | Very low | Eng | {{REVIEW_DATE}} |
| R-06 | Insider abuse (impersonation, lateral access) | Low | High | Medium | Time-bounded `ImpersonationSession`; full audit; SSO-only mode | Low | Security | {{REVIEW_DATE}} |
| R-07 | DDoS on public endpoints | Medium | Medium | Medium | `express-rate-limit` + Redis-backed counters; Helm HPA | Low | Eng | {{REVIEW_DATE}} |
| R-08 | Prompt-injection of CortexView itself | Low | High | Medium | We **are** the security testing tool; exposure is configuration-only | Low | Eng | {{REVIEW_DATE}} |
| R-09 | Supply-chain compromise of Node deps | Medium | High | High | npm audit on every release; pinned major versions; `npm audit fix --force` reviewed | Medium | Eng | {{REVIEW_DATE}} |
| R-10 | Backup integrity failure | Low | Critical | Medium | restic verify; off-site copy; quarterly restore drill | Low | Ops | {{REVIEW_DATE}} |

## Mitigation status

A mitigation moves a risk's score from **inherent** (no controls) to
**residual** (with controls). Residual high or critical entries
require management sign-off (`Compliance → Evidence` exports the list
quarterly).

## New risk discovery

When a new risk is identified (e.g. via penetration test, audit
finding, vulnerability disclosure), file it here with a
`{{REVIEW_DATE}}` of `today + 30 days`.
