import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Stripe-style HMAC signing for outbound webhooks.
 *   X-Cortexview-Signature: t=<unix>,v1=<hex>
 *
 * Computed over `${t}.${rawBody}`. Receivers reject if |now - t| > 5 minutes
 * to defeat replay. Signing secret is per-webhook, base64-encoded random 32 B.
 */

export const SIG_HEADER = 'X-Cortexview-Signature';
export const TOLERANCE_SECONDS = 300;

export function sign(body: string, secret: string, atUnix?: number): string {
  const t = atUnix ?? Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${sig}`;
}

/** Verify a signature against the body + secret. Used by anyone implementing a receiver. */
export function verify(body: string, secret: string, header: string, now = Math.floor(Date.now() / 1000)): boolean {
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.split('=', 2)) as [string, string][],
  );
  const t = parseInt(parts.t ?? '', 10);
  const v1 = parts.v1 ?? '';
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(now - t) > TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  if (expected.length !== v1.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}

/** Generate a base64 random secret for a new webhook. 32 bytes → 43 chars after b64 strip. */
export function generateWebhookSecret(): string {
  const { randomBytes } = require('crypto') as typeof import('crypto');
  return randomBytes(32).toString('base64').replace(/=+$/, '');
}
