/**
 * v2.2 — Lifecycle smoke tests for PayloadHost.
 *
 * We don't actually spawn cloudflared here — that would (a) make tests
 * non-hermetic and (b) require the binary on every CI runner. We only
 * verify:
 *   - Singleton behaviour
 *   - Verify-then-fail when cloudflared is absent
 *   - stop() is idempotent
 *   - host() throws before start()
 *
 * The real-tunnel path is exercised by the integration scan + bench scripts.
 */
import { describe, it, expect } from 'vitest';
import { PayloadHost } from './payloadHost';

describe('PayloadHost', () => {
  it('exposes a process-wide singleton', () => {
    expect(PayloadHost.instance()).toBe(PayloadHost.instance());
  });

  it('host() before start() throws a clear error', () => {
    const host = PayloadHost.instance();
    expect(() => host.host('hello')).toThrow(/not started/i);
  });

  it('stop() is idempotent (safe before any start)', async () => {
    const host = PayloadHost.instance();
    await expect(host.stop()).resolves.toBeUndefined();
    await expect(host.stop()).resolves.toBeUndefined();
  });

  it('verifyCloudflared() against a bogus binary disables the host', async () => {
    const prev = process.env.CLOUDFLARED_PATH;
    process.env.CLOUDFLARED_PATH = '/nonexistent/path/to/cloudflared';
    // Force a new instance by resetting the singleton via reflection — the
    // class doesn't expose this on purpose, so we test the public path.
    // Instead we just verify the existing instance reports disabled after
    // verify against a bad path. (Test isolation: this test must run before
    // any test that successfully starts the host.)
    try {
      const host = PayloadHost.instance();
      const ok = await host.verifyCloudflared();
      // If a real cloudflared happens to be on PATH the test runner still
      // wouldn't pick up the override (execFile resolves the path string
      // verbatim), so this assertion is reliable.
      expect(ok).toBe(false);
      expect(host.isDisabled()).toBe(true);
      expect(host.disabledMessage()).toMatch(/cloudflared/i);
    } finally {
      if (prev === undefined) delete process.env.CLOUDFLARED_PATH;
      else process.env.CLOUDFLARED_PATH = prev;
    }
  });
});
