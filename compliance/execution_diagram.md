# Nemesis AI — Execution Diagrams

Three views, increasing zoom: deployment topology → end-to-end test-run pipeline → per-probe inner loop.

Rendered with [Mermaid](https://mermaid.js.org) — GitHub, GitLab, Notion, Obsidian, VS Code, and `mermaid-cli` all render the fenced blocks below natively.

---

## 1. Deployment topology

The five-container stack on `nemesis.cortexview.ai`.

```mermaid
flowchart LR
  user([User browser]):::user

  subgraph EdgeCaddy["Caddy (TLS, 80/443)"]
    direction TB
    caddy[caddy:2-alpine]:::edge
  end

  subgraph ClientNginx["Client container (nginx 1.27, :8080)"]
    direction TB
    nginx["nginx serves SPA<br/>+ proxies /api"]:::edge
  end

  subgraph ServerAPI["Server container (Node 20, :3001)"]
    direction TB
    api["Express REST API<br/>auth · agents · runs · reports"]:::svc
    bull["Bull queues<br/>testRun · webhook · scheduled · retention · evidence"]:::svc
  end

  subgraph Stateful["Stateful services"]
    direction TB
    db[("Postgres 16<br/>cv-db vol")]:::data
    redis[("Redis 7<br/>cv-redis vol")]:::data
    brand[("cv-branding<br/>logos")]:::data
    cdy[("caddy-data<br/>ACME certs")]:::data
  end

  target([Target AI agent<br/>customer-owned]):::ext

  user -- "HTTPS" --> caddy
  caddy -- "HTTP" --> nginx
  nginx -- "/api/*" --> api
  nginx -- "/ (SPA)" --> user
  api <-- "session / cache / rate-limit" --> redis
  api <-- "ORM (Prisma)" --> db
  api <-- "read/write logos" --> brand
  bull <-- "enqueue / consume" --> redis
  bull -- "spawn worker" --> api
  caddy --- cdy

  api -- "outbound: probes / webhooks / dataset fetches<br/>(safeHttpsAgent, SSRF-validated)" --> target

  classDef edge fill:#fef3c7,stroke:#d97706,color:#78350f;
  classDef svc fill:#e0e7ff,stroke:#4338ca,color:#1e1b4b;
  classDef data fill:#dcfce7,stroke:#16a34a,color:#14532d;
  classDef user fill:#fff,stroke:#1f2937,color:#1f2937;
  classDef ext fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d;
```

---

## 2. End-to-end test run pipeline

What happens from the moment an admin clicks **Run security test** on an agent. Every box maps 1:1 to a TestRun.phase in the DB; the UI polls and renders the spinner label from `TestRun.phaseDetail`.

```mermaid
flowchart TD
  startNode([Admin: Run security test]):::user

  subgraph Sync["Synchronous HTTP path (<100 ms)"]
    direction TB
    auth["authMiddleware<br/>verify JWT · check tokenVersion"]:::sync
    ctrl[agentController.runTests]:::sync
    holder["Create placeholder<br/>TestSuite + PENDING TestRun"]:::sync
    enq["testRunQueue.add<br/>idempotent Bull jobId"]:::sync
    resp["Return 202<br/>{ testRunId, suiteId }"]:::sync
  end

  subgraph Worker["Async Bull worker (testRunQueue.process)"]
    direction TB
    p1["phase: preparing<br/>Starting suite generation"]:::phase
    p2[suiteBuilder.buildSuiteForAgent]:::phase
    p3["generateAgentUnderstanding<br/>LLM call: profile risk surface"]:::llm
    p4["Fetch context blocks:<br/>• learned patterns (org)<br/>• curated KB articles<br/>• research digest (optional)<br/>• Probe catalog (≤40)<br/>• Strategy chips"]:::phase
    p5["claude/testGeneration<br/>LLM call: generate N test cases"]:::llm
    p6["Materialise TestCases<br/>(probe_slug, severity, attack_prompt, ...)"]:::phase
    p7["phase: executing<br/>Running test i of N"]:::phase
    p8{{For each test case}}:::loop
    p9["Cancellation check<br/>(TestRun.status == CANCELLED?)"]:::phase
    pa["sendToAgent<br/>see Diagram 3"]:::network
    pb["detect + LLM judge<br/>verdict: pass · fail · partial · error"]:::llm
    pc[Persist TestResult]:::phase
    pd["Update phaseDetail<br/>(streaming progress)"]:::phase
    pe["phase: reporting<br/>Generating audit report"]:::phase
    pf["claude/reporting<br/>LLM call: exec summary + roadmap"]:::llm
    pg["Persist Report row<br/>+ categoryBreakdown JSON"]:::phase
    ph["Fire webhook events<br/>report.completed · run.completed"]:::phase
    pi["Optional: extractPatterns<br/>learn from failed cases"]:::phase
    pj["phase: null · status: COMPLETED"]:::done
  end

  startNode --> auth --> ctrl --> holder --> enq --> resp
  enq -. queue .-> p1
  p1 --> p2 --> p3 --> p4 --> p5 --> p6 --> p7 --> p8
  p8 --> p9
  p9 -- continue --> pa --> pb --> pc --> pd --> p8
  p9 -- "cancelled" --> pj
  p8 -- "all done" --> pe --> pf --> pg --> ph --> pi --> pj

  classDef sync fill:#e0e7ff,stroke:#4338ca,color:#1e1b4b;
  classDef phase fill:#f3e8ff,stroke:#7e22ce,color:#581c87;
  classDef llm fill:#fef3c7,stroke:#d97706,color:#78350f;
  classDef network fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d;
  classDef loop fill:#fff,stroke:#1f2937,color:#1f2937;
  classDef done fill:#dcfce7,stroke:#16a34a,color:#14532d;
  classDef user fill:#fff,stroke:#1f2937,color:#1f2937;
```

**Phase ↔ DB state table**

| `TestRun.phase` | `TestRun.status` | What's running | Typical duration |
|---|---|---|---|
| `preparing` | `RUNNING` | Suite generation (understanding + LLM-generated cases) | 5–60 s |
| `executing` | `RUNNING` | One probe-call per case + per-case judge | 1–5 s × case count |
| `reporting` | `RUNNING` | Final report LLM call | 5–30 s |
| `null` | `COMPLETED` / `FAILED` / `CANCELLED` | (terminal) | — |

---

## 3. Per-probe inner loop (the SSRF-guarded hot path)

What happens *inside* the `executing` phase, once per test case. This is where the patches from the pentest cycle (NEM-001, NEM-024) live.

```mermaid
flowchart TD
  in([Test case ready<br/>attackPrompt + probe_slug + strategy_chain]):::start

  st["Apply strategy_chain transforms<br/>(encoding · framing · translation · …)"]:::xform

  br{{agent.agentType}}:::decision
  br -- "web_chat (v2.1)" --> bc["browserChat.sendOnce<br/>Playwright session<br/>fill input → click send → wait bubble"]:::browser
  br -- "http (default)" --> http[agentConnector.sendToAgent]:::http

  subgraph SSRF["agentConnector.sendToAgent — SSRF guard"]
    direction TB
    g1["decrypt apiKey<br/>AES-256-GCM"]:::svc
    g2["substitute {{prompt}}<br/>into JSON template"]:::svc
    g3{"NODE_ENV == production?"}:::decision
    g4["assertPublicHttpsUrl<br/>• https only<br/>• reject loopback/RFC1918/<br/>  link-local/metadata aliases<br/>• re-resolve DNS<br/>  (rebinding defense)"]:::guard
    g5["axios.post<br/>httpsAgent: rejectUnauthorized<br/>maxRedirects: 0<br/>timeout: 30 s"]:::http
  end

  http --> g1 --> g2 --> g3
  g3 -- "yes" --> g4 --> g5
  g3 -- "no (dev)" --> g5

  g5 --> rsp[Parse response at responsePath]:::svc
  bc  --> rsp

  rsp --> judge["Detectors + LLM judge<br/>verdict + confidence + reasoning"]:::llm
  judge --> tres[Persist TestResult]:::done
  tres --> out([Next test case]):::start

  classDef start fill:#fff,stroke:#1f2937,color:#1f2937;
  classDef xform fill:#f3e8ff,stroke:#7e22ce,color:#581c87;
  classDef decision fill:#fde68a,stroke:#b45309,color:#78350f;
  classDef browser fill:#fce7f3,stroke:#be185d,color:#831843;
  classDef http fill:#e0e7ff,stroke:#4338ca,color:#1e1b4b;
  classDef svc fill:#e0e7ff,stroke:#4338ca,color:#1e1b4b;
  classDef guard fill:#fee2e2,stroke:#b91c1c,color:#7f1d1d;
  classDef llm fill:#fef3c7,stroke:#d97706,color:#78350f;
  classDef done fill:#dcfce7,stroke:#16a34a,color:#14532d;
```

---

## 4. Cross-cutting concerns (always-on middleware)

```mermaid
flowchart LR
  req([Incoming HTTP]):::start

  m1[requestId]:::mw
  m2["metricsMiddleware<br/>Prometheus"]:::mw
  m3[pino-http]:::mw
  m4["helmet<br/>hidePoweredBy"]:::mw
  m5["Server/X-Powered-By scrub<br/>NEM-019"]:::mw
  m6["generalLimiter<br/>express-rate-limit"]:::mw
  m7[CORS · clientOrigin only]:::mw
  m8[express.json 5 MB cap]:::mw
  m9["JSON parse 400 handler<br/>NEM-027"]:::mw
  m10[cookie-parser]:::mw
  m11["csrf double-submit<br/>NEM-017"]:::mw
  m12["authMiddleware<br/>JWT aud/iss/algo pinned<br/>tokenVersion check"]:::auth
  m13[requireRole / requirePermission / requireScope]:::auth

  ctrl[Controller handler]:::ctrl
  audit["(AuditLog<br/>append-only DB trigger<br/>NEM-016)"]:::data
  err["errorHandler<br/>(or Sentry)"]:::mw
  out([HTTP response<br/>Caddy strips Server/Via]):::start

  req --> m1 --> m2 --> m3 --> m4 --> m5 --> m6 --> m7 --> m8 --> m9 --> m10 --> m11 --> m12 --> m13 --> ctrl
  ctrl --> audit
  ctrl --> err --> out

  classDef start fill:#fff,stroke:#1f2937,color:#1f2937;
  classDef mw fill:#e0e7ff,stroke:#4338ca,color:#1e1b4b;
  classDef auth fill:#fef3c7,stroke:#d97706,color:#78350f;
  classDef ctrl fill:#f3e8ff,stroke:#7e22ce,color:#581c87;
  classDef data fill:#dcfce7,stroke:#16a34a,color:#14532d;
```

---

*Maintained alongside the pentest report. When a new finding lands a guard step, update the relevant diagram so the hot path stays readable.*
