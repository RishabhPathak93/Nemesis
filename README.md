# Nemesis AI

An adversarial-testing platform for AI agents. Nemesis AI connects to your organisation's AI agents and chatbots, understands their purpose and guardrails, auto-generates a tailored security test suite using Claude, runs those tests, and produces detailed security audit reports per agent.

## Architecture

- **client/** — React 18 + TypeScript + Vite + Tailwind + shadcn/ui
- **server/** — Node.js + Express + TypeScript + Prisma + Bull (Redis)
- **AI** — Anthropic Claude (`claude-opus-4-7`) used in 6 pipelines:
  1. **Understanding** — analyses the agent's profile and produces a structured security profile
  2. **Test Generation** — generates 30+ tailored adversarial test cases (now enriched with learned patterns + current web research)
  3. **Evaluation** — scores each test result pass/fail/partial with reasoning
  4. **Reporting** — produces an executive + technical security audit report
  5. **Pattern Extraction** *(adaptive)* — distils successful attacks from each run into reusable, generalised attack patterns
  6. **Threat Research** *(adaptive)* — generates targeted search queries, fetches web findings, and produces a Claude-summarised threat digest

## Adaptive intelligence

Nemesis AI learns over time and can ground its tests in current public research:

- **Learning.** When a test run completes, the platform analyses every attack that succeeded and distils them into reusable, agent-agnostic *attack patterns* stored in a per-org knowledge base. Future test generation pulls the most relevant high-effectiveness patterns (ranked by historical hit rate and category match) and feeds them to Claude as in-context exemplars to vary and adapt — never copy verbatim.
- **Web research.** With a search provider configured (Tavily or Brave), Nemesis AI builds a focused query from each agent's profile, runs a search, fetches plain-text excerpts of the top hits, and asks Claude to summarise them into a citation-grounded threat digest. The digest is cached as a `ResearchSnapshot` and injected into the next test-generation prompt.

Both features can be toggled per-organisation in **Settings → Adaptive intelligence** and managed in **Knowledge**. Research requires either a server-level `SEARCH_PROVIDER` + key in `.env`, or per-org credentials saved in Settings (encrypted at rest). See the **Knowledge** sidebar entry for browsing learned patterns and research snapshots, and to run ad-hoc research queries.

## Prerequisites

- Node.js 20+
- PostgreSQL 14+
- Redis 6+
- An Anthropic API key

## Setup

### 1. Install dependencies

```bash
cd server && npm install
cd ../client && npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` in both `server/` and `client/`:

```bash
cp .env.example server/.env
cp client/.env.example client/.env   # if missing, create from VITE_ block in .env.example
```

Fill in:
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `JWT_SECRET` — any long random string
- `ENCRYPTION_KEY` — 32-byte hex string (generate with `openssl rand -hex 32`)
- `ANTHROPIC_API_KEY` — your Anthropic key

### 3. Initialise the database

```bash
cd server
npx prisma migrate dev --name init
npx prisma generate
```

### 4. Run the stack

In three terminals:

```bash
# 1. Backend
cd server && npm run dev

# 2. Frontend
cd client && npm run dev

# 3. (Optional) Mock agent — runs on :4000
cd server && npm run mock-agent
```

Open http://localhost:5173.

## Using the Mock Agent

For local end-to-end testing without a real LLM endpoint, run the mock agent (`npm run mock-agent`). When connecting an agent in the UI, use:

- **Endpoint URL:** `http://localhost:4000/chat`
- **API Key:** `mock-key`
- **Request Format:** `{ "message": "{{prompt}}" }`
- **Response Path:** `reply`

The mock agent is intentionally vulnerable to several attack categories so reports show varied findings.

## Project Structure

See top-level folder layout — `client/` and `server/` are independent npm packages.

## License

Proprietary — Nemesis AI.
