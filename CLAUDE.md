# Nemesis AI — Working Notes (CLAUDE.md)

Self-hosted adversarial-testing platform for AI agents. Node/Express + Prisma (Postgres) +
Bull/Redis + multi-provider LLM client; React + Vite + Tailwind client. See `README.md` for the
product overview and `docs/` for specs/plans.

## Deployment

- **Production:** `https://nemesis.cortexview.ai` (DigitalOcean droplet `168.144.83.127`), deployed via
  Docker Compose `docker-compose.prod.yml` behind **Caddy** (auto-TLS) at `/opt/nemesis`. The strict
  Caddy CSP is `script-src 'self'` — **no inline scripts** (the pre-paint theme lives in
  `client/public/theme-init.js`, loaded as an external file).
- **Email:** Microsoft Graph (application/client-credentials) via `server/src/lib/graphMailer.ts`,
  used as the env-level transport in `server/src/lib/email.ts` (falls back to SMTP, then log-only).
- **LLM:** intentionally **unconfigured** in prod (`LLM_PROVIDER` empty) — the AI pipelines stay idle
  until a key is added in Settings or `.env`.
- **Reporting model — minimum capability:** the report roll-up emits structured JSON. The reporting
  pipeline (`server/src/services/claude/reporting.ts`) now **map-reduces large failure sets** — when
  fail/partial findings exceed `REPORT_CHUNK_THRESHOLD` (20) it batches them (`REPORT_CHUNK_SIZE` 12)
  per LLM call and computes the aggregate fields (risk score, category breakdown, roadmap)
  deterministically, so no single call can truncate. For Ollama it auto-sizes `num_ctx`
  (`reportingNumCtx`, ≥16k up to 32k) and `num_predict` (`reportingNumPredict`, 4k–12k). **Run the
  reporting model with a context window of at least 16k tokens** (32k recommended for big suites) and
  an instruction-following model in the **8B+** class; a 4k-context model will still degrade JSON. The
  risk score is floored from failure severities (`deriveRiskScore`) — a real-failure run **never**
  reports risk 0, even if the LLM output is empty/truncated/unparseable.
- **Local dev:** `docker compose up -d --build` (project `nemesis-ai`, client published on `:8080`).
  A Vite dev proxy + `client/.env.development` let `npm run dev` (`:5173`) run against the docker API.

## 12-Week Roadmap

Source: `C:\Users\RISHABH\Desktop\New folder (3)\Nemesis-AI-12wk-Roadmap` (spec + 3 phase plans).
Strategy A — foundations-first, accuracy-heavy. One focused chunk per week, strictly back-compat
(new behavior behind flags), every improvement measured before/after. Each week ends by writing
`NEXT_WEEK_BRIEF.md` for the next session.

### Where things stand

- **2026-06-04 (W1): baselines locked.** `npm run bench:baseline` (in `server/`) emits the four roadmap
  baselines — `evalF1Baseline`, `concentrationBaseline`, `runP95MsBaseline`, `queueThroughputBaseline`.
  Harness: `server/src/bench/baseline.ts` (+ `baseline.test.ts`, 2 tests green). Labeled set seeded at
  `server/src/bench/labeled-set/eval-cases.seed.json` (12 cases: 5 fail / 5 pass / 2 partial, snapshotted
  from local demo runs). Baseline values recorded under `w1Baselines` in `server/bench.json`
  (evalF1=0.75, concentration=0.007, runP95Ms=7.2e6, throughput=0). `bench:baseline` reads the DB for the
  last 3 metrics and degrades to 0 if the DB is unreachable.
- **2026-06-05 (W2): legacy behavior frozen + observability.** Golden snapshots lock the current
  evaluator (`evaluation.golden.test.ts`, 2 snaps) and reporting (`reporting.golden.test.ts`, 2 snaps)
  output — they mock `getLlmClient`, so a fixed LLM reply pins the deterministic parse/normalize layer
  (refresh deliberately with `vitest -u`). New Prometheus metrics `nemesis_queue_depth` (gauge),
  `nemesis_run_state` (transition counter), `nemesis_agent_latency_ms` in `lib/metrics.ts`, wired into
  the run worker (`queues/testRunQueue.ts`), asserted by `lib/metrics.test.ts`. OTel already existed
  (`lib/otel.ts`, opt-in via `OTEL_EXPORTER_OTLP_ENDPOINT`). **Also fixed the test env**: `tests/setup.ts`
  now stubs `DATABASE_URL`/`REDIS_URL`/`JWT_SECRET`/`ENCRYPTION_KEY`, taking the suite from 16/28 to
  **31/31 files, 119 tests green** (the QA-audit gap). Next: **W3 — CI + remote git**.

## Known issues (from the security/QA audit — `nemesis-vapt/`)
Track for upcoming weeks. Criticals: **C-02** reporting drops real findings on cartesian/hybrid runs
(externalId `TC-\d+` vs `tc.<slug>` mismatch — refresh the reporting golden snapshot when fixed);
**C-01** queue retry cascade-deletes prior results (resumability). Highs: SSRF fail-open outside prod,
unguarded research fetcher, org-MFA/permission-override not enforced, refresh token in localStorage.
M-03 (evaluator prompt not fenced) maps to **W5/W6**. Prod still has `ALLOW_SIGNUP=true` — lock down
once invites are in use.
