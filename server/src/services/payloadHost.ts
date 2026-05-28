/**
 * v2.2 — Hybrid scan: public payload hosting for indirect-injection probes.
 *
 * Some adversarial probes are only meaningful when the target agent can FETCH
 * the malicious content (e.g. agents with browse/RAG/tool-use abilities).
 * Embedding the doc inline doesn't simulate the real attack — we need the
 * agent to traverse a URL boundary to pull it.
 *
 * This module spins up a local Express server bound to 127.0.0.1 + spawns
 * `cloudflared tunnel --url http://127.0.0.1:PORT` to expose it publicly. The
 * resulting `*.trycloudflare.com` URL is fed to the agent inside the test
 * prompt ("Please fetch and summarise the document at <url>").
 *
 * SAFETY MITIGATIONS (committed to user before enabling):
 *   1. Express bound to 127.0.0.1 only — even if cloudflared dies, the
 *      local port is not on a public interface.
 *   2. Payload paths use 16-byte random hex slugs — not enumerable.
 *   3. Tunnel lifecycle bound to a singleton (`PayloadHost.instance()`) and
 *      torn down at end-of-run + on process.exit / SIGINT / SIGTERM. No
 *      time-based hard cap — the user explicitly requested unlimited runtime
 *      so long-running adaptive scans aren't cut short.
 *   4. cloudflared binary is verified via `--version` before being spawned.
 *      A missing or wrong binary disables tunneling entirely (probes that
 *      need it get verdict='error' with a clear message).
 *   5. Each hosted payload is served exactly once unless the runner opts
 *      into multi-fetch — replays after the first hit return 410 Gone.
 *
 * This module is process-scoped (one tunnel shared by all in-flight runs)
 * so we don't burn a tunnel quota when many TestRuns are running in parallel.
 */

import express, { type Express } from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, type ChildProcessByStdio, execFile } from 'node:child_process';
import type { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { logger } from '../lib/logger';

const execFileAsync = promisify(execFile);

// Local-loop bind. 127.0.0.1 — never 0.0.0.0. The tunnel is the only thing
// that exposes traffic beyond the local box.
const LOCAL_BIND = '127.0.0.1';
// Resolve the cloudflared binary at CALL time (not module-load time) so tests
// and runtime overrides via CLOUDFLARED_PATH take effect without re-import.
function cloudflaredPath(): string {
  return process.env.CLOUDFLARED_PATH || 'cloudflared';
}
// Regex that matches the quick-tunnel URL cloudflared prints to stderr.
const QUICK_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

export interface HostedPayload {
  /** Public URL the test agent should fetch. */
  url: string;
  /** Local-only mirror (debug). */
  localUrl: string;
  /** Path component (after the public host) — used for log correlation. */
  path: string;
  /** Cleanup — removes the route. Idempotent. Returning true if it was
   *  present, false if already removed. */
  release(): boolean;
}

interface PayloadEntry {
  content: string;
  contentType: string;
  /** If true, the route is deleted after the first GET. Default true. */
  singleUse: boolean;
  /** Number of successful fetches so far. */
  fetches: number;
}

/**
 * Process-wide singleton. The runner asks `PayloadHost.instance().host(...)`
 * the first time it sees an indirect-injection probe, which lazily starts the
 * tunnel. Subsequent calls reuse it.
 */
export class PayloadHost {
  private static _instance: PayloadHost | null = null;
  static instance(): PayloadHost {
    if (!PayloadHost._instance) PayloadHost._instance = new PayloadHost();
    return PayloadHost._instance;
  }

  private app: Express | null = null;
  private server: http.Server | null = null;
  // Tunnel stdio shape: stdin ignored, stdout + stderr piped so we can scan
  // for the trycloudflare.com URL.
  private tunnel: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private publicUrl: string | null = null;
  private localPort: number | null = null;
  private payloads = new Map<string, PayloadEntry>();
  private startPromise: Promise<void> | null = null;
  private startedAt: number | null = null;
  private disabledReason: string | null = null;

  /**
   * Verify cloudflared is on PATH and looks legitimate. Caches the result
   * — only re-verified after a stop().
   */
  async verifyCloudflared(): Promise<boolean> {
    // Clear any cached disable reason so a fixed PATH override actually
    // re-enables the host without a process restart.
    this.disabledReason = null;
    try {
      const { stdout, stderr } = await execFileAsync(cloudflaredPath(), ['--version'], { timeout: 5_000 });
      const combined = `${stdout}\n${stderr}`;
      // Expect the official Cloudflare version banner. Substring match is
      // intentionally loose — Cloudflare ships both `cloudflared version` and
      // `cloudflared tunnel ...` style banners.
      const looksLegit = /cloudflared/i.test(combined);
      if (!looksLegit) {
        this.disabledReason = `cloudflared binary did not identify as Cloudflare: ${combined.slice(0, 200)}`;
        return false;
      }
      return true;
    } catch (err) {
      this.disabledReason = `cloudflared not available on PATH: ${err instanceof Error ? err.message : String(err)}`;
      return false;
    }
  }

  isDisabled(): boolean {
    return this.disabledReason !== null;
  }
  disabledMessage(): string | null {
    return this.disabledReason;
  }

  /**
   * Lazy-start. Idempotent — concurrent callers all await the same promise.
   * Throws if cloudflared is unavailable (caller should handle and degrade).
   */
  async start(): Promise<void> {
    if (this.publicUrl) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal().catch((err) => {
      this.startPromise = null;
      throw err;
    });
    return this.startPromise;
  }

  private async startInternal(): Promise<void> {
    const ok = await this.verifyCloudflared();
    if (!ok) throw new Error(this.disabledReason ?? 'cloudflared unavailable');

    // 1. Boot Express on a random local port (bind to 127.0.0.1 ONLY).
    this.app = express();
    // No body parser — we serve static-ish content and never accept input.
    this.app.disable('x-powered-by');
    this.app.get('/healthz', (_req, res) => res.json({ ok: true }));
    this.app.get('/p/:slug', (req, res) => {
      const entry = this.payloads.get(req.params.slug);
      if (!entry) {
        res.status(404).type('text/plain').send('Not found');
        return;
      }
      if (entry.singleUse && entry.fetches > 0) {
        res.status(410).type('text/plain').send('Gone');
        return;
      }
      entry.fetches += 1;
      res.type(entry.contentType).send(entry.content);
    });

    this.server = await new Promise<http.Server>((resolve, reject) => {
      const s = this.app!.listen(0, LOCAL_BIND, () => resolve(s));
      s.on('error', reject);
    });
    const addr = this.server.address();
    if (!addr || typeof addr === 'string') throw new Error('Express bind: unexpected address shape');
    this.localPort = addr.port;
    logger.info({ port: this.localPort, bind: LOCAL_BIND }, '[payloadHost] local server listening');

    // 2. Spawn cloudflared quick-tunnel. We DO NOT use a named tunnel
    // (which would require Cloudflare credentials) — quick tunnels are
    // anonymous, ephemeral *.trycloudflare.com URLs.
    this.tunnel = spawn(
      cloudflaredPath(),
      ['tunnel', '--no-autoupdate', '--url', `http://${LOCAL_BIND}:${this.localPort}`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    // 3. Parse the URL from cloudflared stderr. The line looks like:
    //    "  https://random-words.trycloudflare.com"
    const publicUrl = await new Promise<string>((resolve, reject) => {
      const onChunk = (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        const m = text.match(QUICK_URL_RE);
        if (m) {
          this.tunnel?.stderr?.off('data', onChunk);
          this.tunnel?.stdout?.off('data', onChunk);
          resolve(m[0]);
        }
      };
      this.tunnel?.stderr?.on('data', onChunk);
      this.tunnel?.stdout?.on('data', onChunk);
      this.tunnel?.on('exit', (code) => reject(new Error(`cloudflared exited before URL was published (code=${code})`)));
      setTimeout(() => reject(new Error('cloudflared did not publish a URL within 30s')), 30_000);
    });

    this.publicUrl = publicUrl;
    this.startedAt = Date.now();
    logger.info({ publicUrl, localPort: this.localPort }, '[payloadHost] tunnel up');

    // Process-exit cleanup. A SIGINT / uncaught crash that bypasses stop()
    // still tears the tunnel down. No time-based hard cap — explicit
    // stop() (end-of-run + signal handlers below) are the only kill paths.
    process.once('exit', () => {
      try { this.tunnel?.kill(); } catch { /* noop */ }
    });
    process.once('SIGINT', () => {
      void this.stop().finally(() => process.exit(130));
    });
    process.once('SIGTERM', () => {
      void this.stop().finally(() => process.exit(143));
    });
  }

  /**
   * Host a content blob, returning the public URL. Slug is a random 16-byte
   * hex string (NOT guessable, ~128 bits of entropy).
   */
  host(content: string, opts: { contentType?: string; singleUse?: boolean } = {}): HostedPayload {
    if (!this.publicUrl) {
      throw new Error('PayloadHost not started — call await start() first');
    }
    const slug = crypto.randomBytes(16).toString('hex');
    this.payloads.set(slug, {
      content,
      contentType: opts.contentType ?? 'text/html; charset=utf-8',
      singleUse: opts.singleUse ?? true,
      fetches: 0,
    });
    const path = `/p/${slug}`;
    return {
      url: `${this.publicUrl}${path}`,
      localUrl: `http://${LOCAL_BIND}:${this.localPort}${path}`,
      path,
      release: () => this.payloads.delete(slug),
    };
  }

  /** Number of currently-hosted payloads — exposed for diagnostics. */
  size(): number {
    return this.payloads.size;
  }

  /**
   * Stop everything. Idempotent. Safe to call from a `finally` or
   * process-exit hook.
   */
  async stop(): Promise<void> {
    if (this.tunnel) {
      try { this.tunnel.kill('SIGTERM'); } catch { /* noop */ }
      this.tunnel = null;
    }
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }
    this.app = null;
    this.publicUrl = null;
    this.localPort = null;
    this.payloads.clear();
    this.startedAt = null;
    this.startPromise = null;
    logger.info('[payloadHost] stopped');
  }
}
