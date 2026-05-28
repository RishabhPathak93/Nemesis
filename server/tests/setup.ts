// Vitest global setup. Keeps tests deterministic + isolated.
import { beforeAll, afterAll } from 'vitest';

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
