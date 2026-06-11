import nodemailer, { Transporter } from 'nodemailer';
import { logger } from './logger';
import { prisma } from './prisma';
import { decrypt } from './crypto';
import { graphConfigured, sendViaGraph } from './graphMailer';

/**
 * Outbound email transport.
 *
 * Precedence:
 *   1. Per-org `SmtpConfig` row (enabled = true) — set via Settings → SMTP.
 *   2. Microsoft Graph (MS_GRAPH_* env) — single-tenant app-permission sender.
 *   3. Process-level `SMTP_*` env vars — fallback for single-tenant deploys.
 *   4. No transport → log the message for dev visibility, drop the send.
 *
 * Org-scoped transports are cached for 60 s; rotating credentials or
 * disabling SMTP in the UI takes effect within that window without a restart.
 */

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || 'Nemesis AI <noreply@nemesis-ai.local>';

interface ResolvedTransport {
  transporter: Transporter;
  from: string;
  replyTo?: string;
}

let envCached: ResolvedTransport | undefined;
function getEnvTransport(): ResolvedTransport | undefined {
  if (!SMTP_HOST) return undefined;
  if (!envCached) {
    envCached = {
      transporter: nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
      }),
      from: SMTP_FROM,
    };
  }
  return envCached;
}

interface OrgTransportCacheEntry {
  at: number;
  resolved: ResolvedTransport | null;
}
const ORG_CACHE_TTL_MS = 60_000;
const orgCache = new Map<string, OrgTransportCacheEntry>();

async function getOrgTransport(orgId: string): Promise<ResolvedTransport | undefined> {
  const cached = orgCache.get(orgId);
  if (cached && Date.now() - cached.at < ORG_CACHE_TTL_MS) {
    return cached.resolved ?? undefined;
  }
  let resolved: ResolvedTransport | null = null;
  try {
    const cfg = await prisma.smtpConfig.findUnique({ where: { orgId } });
    if (cfg && cfg.enabled && cfg.host && cfg.fromAddress) {
      let pass: string | undefined;
      if (cfg.authPass) {
        try { pass = decrypt(cfg.authPass); } catch { pass = undefined; }
      }
      resolved = {
        transporter: nodemailer.createTransport({
          host: cfg.host,
          port: cfg.port,
          secure: cfg.secure,
          auth: cfg.authUser && pass ? { user: cfg.authUser, pass } : undefined,
        }),
        from: cfg.fromAddress,
        replyTo: cfg.replyTo ?? undefined,
      };
    }
  } catch (err) {
    logger.warn({ err, orgId }, 'SMTP per-org lookup failed; falling back to env');
  }
  orgCache.set(orgId, { at: Date.now(), resolved });
  return resolved ?? undefined;
}

/** Invalidate the org's cached transport (called from smtpController on update/disable). */
export function invalidateOrgSmtpCache(orgId: string): void {
  orgCache.delete(orgId);
}

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Send an email. If `orgId` is supplied the org's SmtpConfig is used when
 * enabled; otherwise we fall back to the process-level SMTP_* env. If
 * neither is configured, the message is logged and dropped (dev fallback).
 */
export async function sendEmail(msg: OutboundEmail, orgId?: string): Promise<void> {
  // 1. Per-org SMTP wins when an org explicitly configured it.
  let chosen: ResolvedTransport | undefined;
  if (orgId) chosen = await getOrgTransport(orgId);

  // 2. Otherwise prefer Microsoft Graph at the env level when configured.
  if (!chosen && graphConfigured()) {
    try {
      await sendViaGraph(msg);
      return;
    } catch (err) {
      // L-04: log only the message + status — never the raw axios error or
      // response body, which can carry the MS Graph client_secret / token.
      const detail = (err as { response?: { status?: number } }).response;
      logger.error(
        { reason: err instanceof Error ? err.message : String(err), status: detail?.status, to: msg.to, subject: msg.subject },
        'graph email delivery failed; falling back to SMTP/log',
      );
    }
  }

  // 3. Fall back to env-level SMTP.
  if (!chosen) chosen = getEnvTransport();
  if (!chosen) {
    logger.info(
      { to: msg.to, subject: msg.subject, text: msg.text, orgId },
      'email (no transport configured; logged only)',
    );
    return;
  }
  try {
    await chosen.transporter.sendMail({
      from: chosen.from,
      replyTo: chosen.replyTo,
      ...msg,
    });
  } catch (err) {
    logger.error(
      { err, to: msg.to, subject: msg.subject, orgId, source: orgId && chosen !== getEnvTransport() ? 'org' : 'env' },
      'email delivery failed',
    );
  }
}

/** UI URL builder. CLIENT_ORIGIN is the public origin operators terminate on. */
export function clientUrl(path: string): string {
  const base = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  return `${base.replace(/\/$/, '')}${path}`;
}
