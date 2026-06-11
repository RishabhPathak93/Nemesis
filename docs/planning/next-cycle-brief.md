# Nemesis AI — Next-Cycle Planning Brief

**Date:** 2026-06-09 (planning Tuesday) · **Facilitator:** Claude (brainstorm + review) · **Owner:** Rishabh
**Inputs:** 12-week roadmap (W3–W12), the security/QA audit (`nemesis-vapt/`), the Remediation Re-test feature, lab work.

This brief exists to move the cycle KPIs: viable ideas added + selected, % of selected items leaving today with
**clear scope + acceptance criteria**, PR review turnaround, **defects caught in review vs escaped to QA**, and
rework rate. Section 3 ships a review pass against this Tuesday's work as evidence for the review-effectiveness metric.

---

## 1 · Brainstorm → enhancement backlog (viable ideas)

Score = quick RICE-ish gut (Reach×Impact / Effort), 1–5. "Sel." = picked for next cycle.

| ID | Idea | Theme | Value (why it's good) | Effort | Score | Sel. |
|----|------|-------|-----------------------|--------|-------|------|
| **CI-1** | CI on every PR (`tsc + vitest + lint`) + remote git | Ops | **Unblocks every cycle KPI** — you can't measure PR turnaround / rework / defect-escape without PRs + CI gates | M | 5 | ✅ |
| **CI-2** | ESLint config + `lint` script (server + client) | Ops | Prereq for CI-1; catches a class of defects automatically (raises review effectiveness) | S | 4 | ✅ |
| **SP-1** | Scan Profiles — Quick / Standard / Thorough | UX | Solves the real pain we hit (865 cases unusable; env-hacking `RELEVANCE_TIER`); first-class run-intensity control with an est. count | M | 5 | ✅ |
| **EV-1** | Evaluator P/R/F1 calibration behind `EVAL_PROMPT_VERSION` | Accuracy | Cuts the false positives we observed (judge marked a clean refusal as fail); W2 golden snapshots already guard it | M | 4 | ✅ |
| **SEC-1** | H-05 — refresh token → HttpOnly cookie | Security | Closes the last deferred **High** from the audit; removes XSS-exfil of the long-lived token | M | 4 | ✅ |
| **TR-1** | Per-agent run history + posture trend (risk over time, Δ findings) | UX | Pairs with Re-test — show whether each scan improved/regressed; CISO-facing | M | 4 | ✅ |
| **LAB-1** | Dockerize DVRAG into compose (`--profile lab`) + 2 new vuln classes | Demo | Reliable, one-command lab + richer target; high sales/demo leverage, low effort | S | 4 | ⭐ |
| RR-1 | Detector tier-1 hardening + LLM-judge fallback (W6) | Accuracy | Lowers detector false-positive rate (benign slice) | M | 3 | — |
| RR-2 | Turn on `SUITE_RELEVANCE_LLM_RERANK`, measured (W4) | Accuracy | Validate the relevance re-rank with a real before/after | S | 3 | — |
| ML-1 | Multilingual into high-tier strategy families (W7) | Accuracy | Broadens coverage by ≥2 unique families | M | 3 | — |
| EX-1 | Findings export — CSV / JSON / **SARIF** | UX/Integrations | Drops findings into Jira/GitHub code-scanning pipelines | S | 3 | — |
| SCH-1 | Scheduled re-verification + regression alert | UX/Ops | Auto re-test findings on a cadence; webhook on regression | M | 3 | — |
| INT-1 | Slack + SIEM webhook destinations w/ "Send test" (W10) | Integrations | Push run/critical-finding events to ops tooling | M | 3 | — |
| OBS-1 | Grafana dashboard JSON + alert rules for `nemesis_*` metrics | Ops | Make W2 observability actionable | S | 2 | — |
| SEC-2 | M-04 DNS-rebinding IP pinning | Security | Hardens the SSRF TOCTOU (Medium, partly mitigated today) | M | 2 | — |
| REL-1 | M-08 cancellation: batch the poll + cancel-check before reporting | Reliability | Removes per-case N+1; respects late cancels | S | 2 | — |
| PIL-1 | Pilot install runbook + RC tag (W12) | Pilot | Gates "pilot-ready"; depends on CI-1 | M | 3 | — |

**Backlog added this session: 17 viable ideas. Selected for next cycle: 6 (+1 stretch).**

---

## 2 · Selected next-cycle items — scope + acceptance criteria

> Goal: 100% of these leave today with testable acceptance criteria. Each is independently shippable as one PR.

### CI-1 + CI-2 — CI pipeline + lint (Ops · M)
- **In scope:** `.github/workflows/ci.yml` running `npm ci → prisma generate → tsc --noEmit → vitest run → lint` (server) and `tsc -b → lint → build` (client) on PRs to `main`; ESLint config + `lint` script in both packages; create a git remote; branch-protect `main`.
- **Out of scope:** Deploy-on-merge, coverage gates, mass auto-reformat (must not touch engine code / W2 golden snapshots).
- **Acceptance:**
  - [ ] Opening a PR triggers CI; a green check is required to merge to `main`.
  - [ ] `npm run lint` exists in `server/` and `client/` and passes (max-warnings 0).
  - [ ] CI runs the 119 server tests + builds the client; a deliberately-broken PR goes red.
  - [ ] `git remote -v` shows `origin`; `main` is protected.

### SP-1 — Scan Profiles (UX · M)
- **In scope:** `run-tests` accepts `profile: 'quick'|'standard'|'thorough'`; a pure `profileToConfig()` mapping (tier thresholds + chain depth) threaded per-run (no global env hack); a profile selector + est. test-count on the "Run security test" control; profile stored on the run + shown on the report.
- **Out of scope:** Per-category selection (separate item EX-/future); changing the default behavior (default = `standard` == today).
- **Acceptance:**
  - [ ] `quick` produces a small suite (~1 case/probe), `thorough` the largest; unit test on `profileToConfig()`.
  - [ ] Default (no profile) is byte-identical to current suite generation (back-compat test).
  - [ ] UI shows the selected profile + an estimated case count before running; the chosen profile appears on the report.

### EV-1 — Evaluator calibration (Accuracy · M)  *(depends on W2 golden snapshots — done)*
- **In scope:** `EVAL_PROMPT_VERSION` flag (default = current); a v2 prompt tuned for fewer false-positives; `bench:eval` reporting P/R/F1 on the labeled set for v1 vs v2 with a ship/no-ship decision; refresh golden snapshots only on a deliberate, reviewed change.
- **Out of scope:** Rewriting the verdict engine; expanding the labeled set beyond ~50 cases.
- **Acceptance:**
  - [ ] `npm run bench:eval` prints v1 vs v2 macro-P/R/F1 on the labeled set + a recorded decision in `bench.json`.
  - [ ] v2 improves ≥1 of {P, R, F1} by ≥5% without dropping the others below baseline, OR is explicitly not shipped with rationale.
  - [ ] Default path unchanged unless `EVAL_PROMPT_VERSION=v2`; W2 golden tests still green (or refreshed intentionally).

### SEC-1 — H-05 refresh token → HttpOnly cookie (Security · M)
- **In scope:** Server sets `cv_rt` `HttpOnly; Secure; SameSite=Strict` on login/verify/refresh; `/auth/refresh` reads cookie-or-body (back-compat); logout clears it; client stops persisting `cv_refresh` and refreshes via the cookie (`withCredentials`).
- **Out of scope:** Moving the short-lived access token out of memory/localStorage (follow-up); SSO cookie redesign.
- **Acceptance:**
  - [ ] After login, the refresh token is **not** in `localStorage`; a `cv_rt` HttpOnly cookie is set.
  - [ ] Login → 15-min idle → silent refresh works via the cookie; logout invalidates it.
  - [ ] Verified locally end-to-end before any prod deploy; existing tests green.

### TR-1 — Run history + posture trend (UX · M)
- **In scope:** A per-agent "History" view listing past runs (date, profile, risk score, fail counts) with a sparkline of risk-over-time and a Δ vs the previous run (findings newly-introduced / resolved by `externalId`).
- **Out of scope:** Cross-agent org rollups; CSV export (EX-1).
- **Acceptance:**
  - [ ] Agent detail shows ≥2 prior runs with risk-score trend.
  - [ ] Selecting two runs shows "introduced N / resolved M" computed by `externalId`.
  - [ ] No new DB tables (reads existing TestRun/TestResult).

### LAB-1 ⭐ (stretch) — Dockerize DVRAG + 2 vuln classes (Demo · S)
- **Acceptance:** `docker compose --profile lab up` starts DVRAG on `:4001`; two new vuln classes (e.g. tool-call SSRF, upload-borne indirect injection) leak under attack; README updated.

---

## 3 · This Tuesday's review pass (review-effectiveness evidence)

Ran a fresh-eyes correctness + security review of the just-shipped work (Remediation Re-test + the riskiest audit
fixes). **Defects caught in review: 3 — all fixed pre-QA (0 escaped).**

| Sev | Defect | Caught where | Status |
|-----|--------|--------------|--------|
| Medium | Re-verify delta dropped `error`/missing re-tests from both buckets → "Resolved X of Y" + green all-clear could mislead | review | ✅ fixed (added `unevaluated` bucket + gated all-clear) |
| Low | `/reverify/:runId` with no `?parent=` fired `GET /test-runs//results` | review | ✅ fixed (guard) |
| Low | IPv4-mapped IPv6 (`::ffff:169.254.*`) bypassed metadata block in relaxed SSRF mode | review | ✅ fixed (normalize + block) |

Verified-correct (no change needed): the async/override-aware `requirePermission`, H-03 MFA grace math, M-02 MFA
lockout, the cartesian pre-built-case execution path, and the C-02 TC-NNN remap. Verdict: **fix-then-ship → shipped.**

---

## 4 · Making the KPIs measurable (instrumentation)

These metrics are mostly **un-measurable until CI-1 lands** — that's why it's the #1 pick.

| KPI | How we'll measure it next cycle |
|-----|-------------------------------|
| Viable ideas added / selected | This brief: **17 added, 6 (+1) selected**. Track in a `docs/planning/backlog.md`. |
| % items leaving Tuesday scoped | §2 — **100% (6/6 have scope + acceptance criteria)**. |
| PR review turnaround | After CI-1: GitHub PR `created → first review` timestamp (target < 1 business day). |
| Defects caught in review vs escaped to QA | Label review-found defects vs QA/issue-found; this Tuesday = **3 caught / 0 escaped**. |
| Rework rate | After CI-1: % of PRs needing ≥2 review rounds (force-push after "changes requested"). |
