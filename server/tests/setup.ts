// Vitest global setup. Keeps tests deterministic + isolated.
import { beforeAll, afterAll } from 'vitest';

// Stub required env vars BEFORE any test module transitively imports
// `lib/env.ts` (which throws on missing required vars). Dummy values — no test
// should open a real DB/Redis connection; DB-touching suites mock prisma /
// getLlmClient. Fixes ~12 suites that previously failed to collect with
// "Missing required env var: DATABASE_URL".
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/nemesis_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_SECRET ??= 'test-jwt-secret-not-for-prod-aaaaaaaaaaaaaaaaaaaaaaaa';
process.env.ENCRYPTION_KEY ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// Mute pino logs during tests unless TEST_LOG=1
if (process.env.TEST_LOG !== '1') {
  process.env.LOG_LEVEL = 'silent';
}

// Pin a deterministic seed for any code path that reads it.
process.env.NEMESIS_TEST_SEED = process.env.NEMESIS_TEST_SEED ?? '0xC0FFEE';

beforeAll(() => {
  // placeholder for future DB-isolation hooks
});

afterAll(() => {
  // placeholder
});
