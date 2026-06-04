# Week 2 Brief — Observability + characterization tests

## Where we left off
- **W1 acceptance: ✓** — `cd server && npm run bench:baseline` emits all four baselines
  (`evalF1Baseline`, `concentrationBaseline`, `runP95MsBaseline`, `queueThroughputBaseline`); the
  grep check returns `4`. `baseline.test.ts` green (2 tests). Values in `server/bench.json` →
  `w1Baselines`.
- **Open blockers:** none.
- **Note:** `bench:baseline` needs DB access. Locally the docker DB isn't host-published; bridge it
  with a transient proxy, e.g.
  `docker run -d --rm --name nemesis-db-proxy --network nemesis-ai_default -p 5433:5432 alpine/socat tcp-listen:5432,fork,reuseaddr tcp-connect:nemesis-ai-db-1:5432`
  then run with `DATABASE_URL=postgresql://cortexview:<pw>@localhost:5433/cortexview`.

## This week's goal
Lock current evaluator + reporting behavior with golden-snapshot tests (so W5 prompt tuning is safe),
and expose `/metrics` (Prometheus) + minimal OTel traces on the run worker.

## Acceptance test
```bash
cd server && npx vitest run src/services/claude/evaluation.golden.test.ts src/services/claude/reporting.golden.test.ts \
  && curl -s http://localhost:3001/metrics | grep -E "^nemesis_queue_depth|^nemesis_run_state" | wc -l
```
Expected: golden tests PASS (≥2 assertions); `grep` returns `≥2`.
(Port note: plan says `:3003`; **our server listens on `:3001`** — use that, or hit the prod/Caddy
host. Adapt the curl accordingly.)

## Files to touch
- Create: `server/src/services/claude/evaluation.golden.test.ts`, `reporting.golden.test.ts`
- Create: `server/src/services/claude/__golden__/*.json` (+ `README.md`)
- Create: `server/src/lib/observability/metrics.ts`, `server/src/lib/observability/otel.ts`
- Create: `server/src/middleware/metricsEndpoint.ts`
- Create (helper): `server/src/bench/capture-golden.ts`
- Modify: `server/src/index.ts` (mount `/metrics`, init OTel), `server/src/queues/testRunQueue.ts`
  (bump counters), `server/src/services/agentConnector.ts` (time outbound calls)

## Files NOT to touch (back-compat)
- `server/src/services/claude/evaluation.ts` and `reporting.ts` **behavior** — W2 only snapshots them;
  prompt changes are W5, behind `EVAL_PROMPT_VERSION`.
- `server/src/lib/email.ts` / `graphMailer.ts`, `docker-compose.prod.yml`, `caddy/Caddyfile`.
- Note: the repo **already has** `src/lib/metrics.ts` + `src/lib/otel.ts` and mounts `/metrics` in
  `index.ts` — check these first; you may only need to ADD the `nemesis_queue_depth` / `nemesis_run_state`
  collectors rather than build observability from scratch. Verify before creating duplicates.

## TDD task list (from phase1 plan, Week 2)
1. Capture golden snapshots from 3 demo runs (scripted LLM client replays stored `agentResponse`).
2. Write golden tests (red) for evaluator + reporting; assert byte-equality vs snapshots.
3. Add `capture-golden.ts`, generate snapshots → green.
4. Add Prom collectors `nemesis_queue_depth`, `nemesis_run_state`, `nemesis_agent_latency_ms`.
5. Bump counters in the run worker; time `sendToAgent` in `agentConnector.ts`.
6. Minimal OTel (ConsoleSpanExporter), gated by `NEMESIS_DISABLE_OTEL`.
7. Run acceptance; verify.

## End-of-session checklist
- [ ] Acceptance test green (golden tests + `/metrics` counters present)
- [ ] `CLAUDE.md` updated with what's now true (W2 entry)
- [ ] `NEXT_WEEK_BRIEF.md` rewritten for W3 (CI + remote git)
- [ ] Changes committed (scoped to W2 files)
