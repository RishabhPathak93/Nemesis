# Week 3 Brief — CI + remote git

## Where we left off
- **W2 acceptance: ✓** — golden tests pass (evaluator + reporting, 4 snapshots) and the
  `nemesis_queue_depth` / `nemesis_run_state` metrics are exposed (asserted by `lib/metrics.test.ts`,
  the CI-equivalent of `curl /metrics | grep`). OTel already present (opt-in).
- **Bonus:** `tests/setup.ts` now stubs required env → **31/31 suites, 119 tests green** (`npx vitest run`).
- **Open blockers:** none. Committed on branch `roadmap/w2-observability`.

## This week's goal
Put a CI workflow on every PR that runs `tsc + vitest + lint`, and push `main` to a remote so there's a
single source of truth.

## Acceptance test
```bash
git remote -v | grep origin            # a remote exists
gh workflow list | grep -i ci          # CI workflow registered
# open a no-op PR and watch checks:
gh pr checks --watch                   # all green
```

## Files to touch
- Create: `.github/workflows/ci.yml` (postgres + redis services; steps: server `npm ci` → `prisma migrate deploy` → `tsc --noEmit` → `vitest run` → `lint`; client `npm ci` → `lint` → `build`).
- Add `"lint"` script + ESLint config to `server/package.json` and `client/package.json`
  (`eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin`).
- (Manual, one-time) create the remote repo and `git push -u origin main`; branch-protect `main`.

## Files NOT to touch (back-compat)
- Engine/evaluator/reporting behavior (locked by W2 golden snapshots — a lint autofix must not change them).
- `docker-compose.prod.yml`, `caddy/Caddyfile`, `lib/email.ts`, `lib/graphMailer.ts`.

## TDD task list
1. Add minimal ESLint config + `lint` scripts; run locally and fix/относ ignore only obvious issues
   (don't mass-reformat or autofix engine code — keep the W2 golden snapshots stable).
2. Author `ci.yml`; the CI env needs `DATABASE_URL` etc. — but note tests now self-stub via
   `tests/setup.ts`, so unit tests run without a live DB (Prisma migrate step still wants a DB for any
   integration paths).
3. Create remote, push, open a smoke PR, confirm green, protect `main`.

## Heads-up / decisions for the operator
- **No git remote exists yet** — you'll need to create one (GitHub/GitLab/self-hosted) and provide push
  access, or tell me where to push. The prod deploy at `/opt/nemesis` is a separate checkout.
- Several **uncommitted changes still sit on `main`'s working tree** (the deployed dark-mode / MS-Graph /
  prod-compose work). Decide whether to land those on `main` before wiring CI, so CI runs against the
  real deployed code.

## End-of-session checklist
- [ ] CI workflow green on a PR; `main` protected
- [ ] `CLAUDE.md` updated (W3 entry)
- [ ] `NEXT_WEEK_BRIEF.md` rewritten for W4 (turn on `SUITE_RELEVANCE_LLM_RERANK`, measured)
- [ ] Changes committed
