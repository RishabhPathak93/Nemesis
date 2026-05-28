import { Request, Response } from 'express';
import IORedis from 'ioredis';
import { prisma } from './prisma';
import { env } from './env';
import { logger } from './logger';
import { resolveLlmConfig, probeLlm } from './llm';
import { timingSafeEqualString } from './tokens';

type CheckStatus = 'ok' | 'down' | 'unknown';

interface HealthSnapshot {
  status: 'ok' | 'degraded';
  checks: {
    db: CheckStatus;
    redis: CheckStatus;
    llm: { status: CheckStatus; provider?: string; error?: string };
  };
  uptimeSec: number;
  timestamp: string;
}

const startedAt = Date.now();

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function checkDb(): Promise<CheckStatus> {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 1000, 'db');
    return 'ok';
  } catch (err) {
    logger.warn({ err }, 'health: db check failed');
    return 'down';
  }
}

let redisProbe: IORedis | undefined;

async function checkRedis(): Promise<CheckStatus> {
  try {
    if (!redisProbe) {
      redisProbe = new IORedis(env.redisUrl, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
        lazyConnect: false,
      });
      redisProbe.on('error', () => {
        // swallow — surfaces in checkRedis()
      });
    }
    const reply = await withTimeout(redisProbe.ping(), 1000, 'redis');
    return reply === 'PONG' ? 'ok' : 'down';
  } catch (err) {
    logger.warn({ err }, 'health: redis check failed');
    return 'down';
  }
}

interface LlmCheckCacheEntry {
  at: number;
  result: HealthSnapshot['checks']['llm'];
}
let llmCache: LlmCheckCacheEntry | undefined;
const LLM_CACHE_MS = 60_000;

async function checkLlm(): Promise<HealthSnapshot['checks']['llm']> {
  if (llmCache && Date.now() - llmCache.at < LLM_CACHE_MS) return llmCache.result;
  let result: HealthSnapshot['checks']['llm'];
  try {
    const orgs = await prisma.org.findMany({ take: 1, orderBy: { createdAt: 'asc' } });
    if (orgs.length === 0 && !env.llmProvider && !env.anthropicApiKey) {
      result = { status: 'unknown' };
    } else {
      const orgId = orgs[0]?.id;
      const cfg = orgId
        ? await resolveLlmConfig(orgId)
        : env.llmProvider
        ? { provider: env.llmProvider, apiKey: env.llmApiKey, model: env.llmModel || 'claude-opus-4-7' }
        : { provider: 'anthropic' as const, apiKey: env.anthropicApiKey, model: env.anthropicModel };
      const probe = await probeLlm(cfg);
      result = probe.ok ? { status: 'ok', provider: cfg.provider } : { status: 'down', provider: cfg.provider, error: probe.error };
    }
  } catch (err) {
    result = { status: 'down', error: err instanceof Error ? err.message : String(err) };
  }
  llmCache = { at: Date.now(), result };
  return result;
}

/** Shallow handler — for load balancers. Returns 200 unless the process is dying. */
export function healthHandler(_req: Request, res: Response): void {
  res.json({ ok: true, uptimeSec: Math.floor((Date.now() - startedAt) / 1000) });
}

/** Deep handler — exercises DB + Redis + LLM probe. Gated by X-Health-Token. */
export async function healthDeepHandler(req: Request, res: Response): Promise<void> {
  if (env.healthToken) {
    const provided = req.headers['x-health-token'];
    // NEM-2026-009: timing-safe compare to avoid byte-by-byte secret recovery.
    if (typeof provided !== 'string' || !timingSafeEqualString(provided, env.healthToken)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
  }
  const [db, redis, llm] = await Promise.all([checkDb(), checkRedis(), checkLlm()]);
  const isCriticalDown = db !== 'ok' || redis !== 'ok';
  const snapshot: HealthSnapshot = {
    status: isCriticalDown ? 'degraded' : 'ok',
    checks: { db, redis, llm },
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  };
  res.status(isCriticalDown ? 503 : 200).json(snapshot);
}
