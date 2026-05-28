# Data Processing Addendum — {{ORG_NAME}}

*Version {{VERSION}} · Effective {{EFFECTIVE_DATE}}*

This DPA forms part of the agreement between {{CUSTOMER_NAME}} (Controller)
and {{ORG_NAME}} (Processor) for the use of CortexView in a self-hosted
configuration.

## 1. Subject matter

The Processor provides the CortexView AI security testing platform. The
Controller deploys the platform inside its own infrastructure. The
Processor receives no personal data outside the support context.

## 2. Duration

This DPA remains in effect for the term of the underlying licence
agreement. On termination, the Processor returns or deletes any personal
data it received during support engagements, per Art 28(3)(g).

## 3. Nature and purpose of processing

The Processor's processing is limited to:

- Providing software updates and security patches to the platform.
- Responding to support requests when the Controller voluntarily shares
  data (e.g. log excerpts, audit trails, configuration) with the
  Processor for triage.

The Processor does not access the Controller's running CortexView
deployment unless explicitly granted access by the Controller.

## 4. Categories of data subjects

End users of the Controller's deployment of CortexView, including:
- Employees and contractors of the Controller granted access to the
  platform.
- Subjects of any test data the Controller has uploaded (rare —
  CortexView is target-agnostic and does not require subject data).

## 5. Categories of personal data

- Email, display name, role, IP addresses (in audit / login logs).
- Free-text descriptions of agents, test cases, and reports.

## 6. Sub-processors

None. The Controller is responsible for the LLM provider, search
provider, notification destinations, and infrastructure it configures.

## 7. Data subject rights

The Processor implements technical measures to assist the Controller
with Arts 15–22 obligations, including the in-product Data Subject
Request flow and the per-user export / anonymisation jobs.

## 8. Security

The Processor maintains the technical and organisational measures
described in OPERATOR.md and the SOC 2 controls matrix. The platform
ships with: encryption at rest for all secrets, MFA, scoped API keys,
audit logging, soft-delete with retention windows, IP allowlisting,
WebAuthn/SAML/OIDC, and quarterly dependency updates.

## 9. Personal data breach

The Processor will notify the Controller without undue delay (and no
later than 72 hours) of any personal data breach affecting the
Controller's data of which the Processor becomes aware.

## 10. International transfers

The Processor does not transfer personal data internationally. Where
the Controller configures non-domestic LLM or search providers, the
Controller is responsible for the transfer's lawful basis.

## 11. Audit rights

The Controller may audit the Processor's compliance with this DPA
once per year, on 30 days' notice, at the Controller's expense. The
Processor's SOC 2 Type II report (when issued) is accepted in lieu.

---

Signed by:

Controller (`{{CUSTOMER_NAME}}`): __________________________ · __________
Processor (`{{ORG_NAME}}`):       __________________________ · __________
