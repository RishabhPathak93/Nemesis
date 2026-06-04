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
  last 3 metrics and degrades to 0 if the DB is unreachable. Next: **W2 — observability + golden snapshots**.
