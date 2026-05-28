import rateLimit, { Options } from 'express-rate-limit';
import RedisStore, { RedisReply } from 'rate-limit-redis';
import IORedis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

let sharedClient: IORedis | undefined;
let storeFactoryWarned = false;

function getRedisClient(): IORedis | undefined {
  if (!env.rateLimitRedisEnabled) return undefined;
  if (sharedClient) return sharedClient;
  try {
    sharedClient = new IORedis(env.redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: false,
    });
    sharedClient.on('error', (err) => {
      logger.warn({ err: err.message }, 'rate-limit redis connection error');
    });
    return sharedClient;
  } catch (err) {
    logger.warn({ err }, 'rate-limit redis client init failed; falling back to in-memory store');
    return undefined;
  }
}

function buildStore(): Options['store'] | undefined {
  const client = getRedisClient();
  if (!client) {
    if (!storeFactoryWarned) {
      logger.info('rate limiter using in-memory store (single-replica only)');
      storeFactoryWarned = true;
    }
    return undefined;
  }
  return new RedisStore({
    sendCommand: (...args: string[]): Promise<RedisReply> =>
      client.call(args[0], ...args.slice(1)) as Promise<RedisReply>,
    prefix: 'cv:rl:',
  });
}

function makeLimiter(opts: { windowMs: number; max: number; key: string; skip?: Options['skip'] }) {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: opts.skip,
    store: buildStore(),
    keyGenerator: (req) => `${opts.key}:${req.ip}`,
    message: { error: 'Too many requests, slow down.' },
  });
}

/** 300 req/min/IP across the whole API. /health is exempt. */
export const generalLimiter = makeLimiter({
  windowMs: 60_000,
  max: 300,
  key: 'gen',
  skip: (req) => req.path === '/health' || req.path === '/health/deep',
});

/** Tight cap on auth endpoints to slow brute force. 20 req / 15 min / IP. */
export const authLimiter = makeLimiter({
  windowMs: 15 * 60_000,
  max: 20,
  key: 'auth',
});

/** Even tighter on password reset to slow enumeration / spam. 5 / 15 min / IP. */
export const passwordResetLimiter = makeLimiter({
  windowMs: 15 * 60_000,
  max: 5,
  key: 'pwreset',
});
