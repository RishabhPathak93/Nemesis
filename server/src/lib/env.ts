import dotenv from 'dotenv';
dotenv.config();

/**
 * Parse an env var to a positive integer, with Number.POSITIVE_INFINITY as
 * the default when the var is unset OR explicitly set to a sentinel.
 *
 *   parseIntOrInf(undefined)       → Infinity   (unset → "no cap" per brief)
 *   parseIntOrInf("0")             → Infinity   (0 = "no cap" convention)
 *   parseIntOrInf("inf")           → Infinity
 *   parseIntOrInf("unlimited")     → Infinity
 *   parseIntOrInf("-1")            → Infinity
 *   parseIntOrInf("42")            → 42
 *   parseIntOrInf(undefined, 8)    → 8          (when an explicit small default is wanted)
 *
 * The second arg is the default override. Pass it for caps where the brief
 * tolerates a finite floor (e.g. adaptive children).
 */
function parseIntOrInf(raw: string | undefined, defaultIfUnset: number = Number.POSITIVE_INFINITY): number {
  if (raw == null || raw === '') return defaultIfUnset;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'inf' || trimmed === 'infinity' || trimmed === 'unlimited' || trimmed === '-1') {
    return Number.POSITIVE_INFINITY;
  }
  const n = parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n === 0) return Number.POSITIVE_INFINITY;
  return n;
}

function required(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

/**
 * Fail-closed sanity check for high-entropy secrets. NEM-2026-013.
 * 32 bytes ≈ 64 hex chars ≈ 44 base64 chars; that's the minimum we accept.
 */
function requireHighEntropy(key: string, minBytes = 32): string {
  const v = required(key);
  const len = Buffer.byteLength(v, 'utf8');
  if (len < minBytes) {
    throw new Error(
      `${key} must be at least ${minBytes} bytes of entropy ` +
        `(got ${len} bytes). Generate one with: openssl rand -hex ${minBytes}`,
    );
  }
  // Reject obvious dev defaults.
  if (/^(changeme|secret|password|test|dev|example)$/i.test(v)) {
    throw new Error(`${key} appears to be a default/example value — regenerate before deploying.`);
  }
  return v;
}

export const env = {
  port: parseInt(process.env.PORT || '3001', 10),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: requireHighEntropy('JWT_SECRET'),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  encryptionKey: requireHighEntropy('ENCRYPTION_KEY'),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-opus-4-7',
  // Unified LLM config (preferred over the legacy Anthropic-only pair above)
  llmProvider: (process.env.LLM_PROVIDER as 'anthropic' | 'openai' | 'openai_compatible' | 'ollama' | undefined) || undefined,
  llmApiKey: process.env.LLM_API_KEY || '',
  llmModel: process.env.LLM_MODEL || '',
  llmBaseUrl: process.env.LLM_BASE_URL || '',
  mockAgentPort: parseInt(process.env.MOCK_AGENT_PORT || '4000', 10),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  // Research providers — fall back to org-level config if these are unset
  searchProvider: (process.env.SEARCH_PROVIDER as 'tavily' | 'brave' | undefined) || undefined,
  tavilyApiKey: process.env.TAVILY_API_KEY || '',
  braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY || '',
  // Cap research depth to control cost
  researchMaxResults: parseInt(process.env.RESEARCH_MAX_RESULTS || '5', 10),
  researchMaxFetchBytes: parseInt(process.env.RESEARCH_MAX_FETCH_BYTES || '8000', 10),
  // v2.2 — scan-engine sizing. All default to "unlimited" (Infinity) per
  // the brief's hard requirement #1: "Remove every artificial cap." Operators
  // who want budget control set these explicitly in .env; production
  // deployments typically should.
  //
  // POSITIVE_INFINITY → Prisma `take: undefined` (which Prisma reads as "no
  // limit"), or the loop terminates only on natural exhaustion.
  scanProbeCatalogLimit:   parseIntOrInf(process.env.SCAN_PROBE_CATALOG_LIMIT),  // was: take(40)
  scanKbPoolSize:          parseIntOrInf(process.env.SCAN_KB_POOL_SIZE),         // was: take(400)
  scanKbFinalLimit:        parseIntOrInf(process.env.SCAN_KB_FINAL_LIMIT),       // was: slice(0,12)
  scanPatternPoolSize:     parseIntOrInf(process.env.SCAN_PATTERN_POOL_SIZE),    // was: take(60)
  scanPatternFinalLimit:   parseIntOrInf(process.env.SCAN_PATTERN_FINAL_LIMIT),  // was: slice(0,12)
  scanResearchFetchDepth:  parseIntOrInf(process.env.SCAN_RESEARCH_FETCH_DEPTH), // was: slice(0,3)
  scanResearchFindingsLimit: parseIntOrInf(process.env.SCAN_RESEARCH_FINDINGS_LIMIT), // was: slice(0,6)
  scanLlmJudgeChunkBytes:  parseInt(process.env.SCAN_LLM_JUDGE_CHUNK_BYTES || '4000', 10), // was: hard 3000 truncation
  // Orchestrator budgets — Infinity by default, operator can throttle.
  orchTapBranches:         parseIntOrInf(process.env.ORCH_TAP_BRANCHES),         // was: 3
  orchTapDepth:            parseIntOrInf(process.env.ORCH_TAP_DEPTH),            // was: 4
  orchTapThreshold:        parseInt(process.env.ORCH_TAP_THRESHOLD || '8', 10),  // judge score 1..10
  orchCrescendoMaxTurns:   parseIntOrInf(process.env.ORCH_CRESCENDO_MAX_TURNS),  // was: 8
  orchGoatMaxTurns:        parseIntOrInf(process.env.ORCH_GOAT_MAX_TURNS),       // was: 12
  orchBestOfN:             parseIntOrInf(process.env.ORCH_BEST_OF_N),            // BestOfN default count
  // Queue worker concurrency (D4). Defaults to os.cpus() in queues/testRunQueue.ts.
  queueConcurrency:        parseIntOrInf(process.env.QUEUE_CONCURRENCY),
  // Oracle re-eval threshold (C2). Below this, re-call the LLM judge.
  oracleReevalThreshold:   parseFloat(process.env.ORACLE_REEVAL_THRESHOLD || '0.7'),
  // Adaptive child cap (D6). 0 disables the adaptive layer; Infinity recurses
  // until exhaustion. Default = small finite to balance signal vs runtime.
  adaptiveMaxDerivatives:  parseIntOrInf(process.env.ADAPTIVE_MAX_DERIVATIVES, 8),
  // v2.2 — Hybrid scan: max mutation steps per test case before stopping
  // escalation. Each step = one LLM mutation call + one re-dispatch + one
  // oracle pass. Default 3 keeps per-case wall time bounded.
  hybridMaxAdaptiveSteps:  parseIntOrInf(process.env.HYBRID_MAX_ADAPTIVE_STEPS, 3),
  // v2.2 — Path to the cloudflared binary used by services/payloadHost.ts
  // for indirect-injection probes that need a publicly-fetchable URL.
  // Leave default ('cloudflared') unless installed at a non-PATH location.
  cloudflaredPath:         process.env.CLOUDFLARED_PATH || 'cloudflared',
  // v2.2 — Master switch for the tunneled payload host. Default true on
  // dev; set to 'false' in any env where you don't want cloudflared spawned.
  payloadHostEnabled:      (process.env.PAYLOAD_HOST_ENABLED ?? 'true').toLowerCase() !== 'false',
  // Operational hardening
  healthToken: process.env.HEALTH_TOKEN || '',
  rateLimitRedisEnabled: (process.env.RATE_LIMIT_REDIS ?? 'true').toLowerCase() !== 'false',
  // CSRF cookie security: set true when serving over HTTPS (production reverse proxy)
  cookieSecure: (process.env.COOKIE_SECURE ?? 'false').toLowerCase() === 'true',
  // v1.3 — branding storage (filesystem volume)
  brandingDir: process.env.CV_BRANDING_DIR || '/tmp/cortexview-branding',
  // v1.4 — observability gate token for /metrics
  metricsToken: process.env.METRICS_TOKEN || '',
};
