import { describe, it, expect } from 'vitest';
import client from 'prom-client';
import './metrics'; // registers the collectors as a side-effect

/**
 * W2 acceptance (metrics half): the run-pipeline observability series are
 * present on the Prometheus registry, so `GET /metrics` surfaces them.
 * Equivalent to the roadmap's
 *   curl /metrics | grep -E "^nemesis_queue_depth|^nemesis_run_state"
 * but runnable in CI without a live server.
 */
describe('W2 observability metrics', () => {
  it('exposes nemesis_queue_depth and nemesis_run_state', async () => {
    const text = await client.register.metrics();
    expect(text).toMatch(/^nemesis_queue_depth\{queue="test_runs"\} \d/m);
    expect(text).toMatch(/^nemesis_run_state\{from="queued",to="(running|completed|failed)"\} \d/m);
  });
});
