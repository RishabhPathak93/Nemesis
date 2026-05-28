import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { prisma } from '../lib/prisma';
import { encrypt, decrypt } from '../lib/crypto';
import { auditFromRequest } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';
import { logger } from '../lib/logger';
import { invalidateOrgSmtpCache } from '../lib/email';

/**
 * Per-org SMTP configuration. Admins can set host / port / TLS mode /
 * auth credentials / from address through the Settings UI without
 * touching the operator's `.env`.
 *
 * - Password is encrypted at rest with the app-wide ENCRYPTION_KEY.
 * - GET responses NEVER include the plaintext password (mask only).
 * - `testSmtp` performs a real verify + sends a test email to a chosen
 *   recipient (default: the requester). Result is persisted to
 *   `lastTestAt` / `lastTestOk` / `lastTestError` for visibility on the
 *   Settings page.
 */

const PORT_MIN = 1;
const PORT_MAX = 65535;

const UpdateSchema = z.object({
  enabled: z.boolean().optional(),
  host: z.string().min(1).max(253).optional(),
  port: z.number().int().min(PORT_MIN).max(PORT_MAX).optional(),
  secure: z.boolean().optional(),
  authUser: z.string().max(320).nullable().optional(),
  // Plaintext only on write; stored encrypted; never returned on GET.
  // Sending null clears the password. Omitting it leaves the existing one in place.
  authPass: z.string().max(2048).nullable().optional(),
  fromAddress: z.string().min(3).max(320).optional(),
  replyTo: z.string().max(320).nullable().optional(),
});

const TestSchema = z.object({
  to: z.string().email().optional(),
  // If true, persist the result on the config row.
  persist: z.boolean().optional().default(true),
});

function maskAuth(authPass: string | null | undefined): string | null {
  return authPass ? '••••••••' : null;
}

function publicView(row: {
  id: string;
  orgId: string;
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  authUser: string | null;
  authPass: string | null;
  fromAddress: string;
  replyTo: string | null;
  lastTestAt: Date | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  updatedAt: Date;
}): Record<string, unknown> {
  return {
    id: row.id,
    orgId: row.orgId,
    enabled: row.enabled,
    host: row.host,
    port: row.port,
    secure: row.secure,
    authUser: row.authUser,
    authPass: maskAuth(row.authPass),
    hasPassword: !!row.authPass,
    fromAddress: row.fromAddress,
    replyTo: row.replyTo,
    lastTestAt: row.lastTestAt,
    lastTestOk: row.lastTestOk,
    lastTestError: row.lastTestError,
    updatedAt: row.updatedAt,
  };
}

/** GET /api/v1/settings/smtp — returns the org's SMTP config (password masked). */
export async function getSmtp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const row = await prisma.smtpConfig.findUnique({ where: { orgId } });
    res.json({ config: row ? publicView(row) : null });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/v1/settings/smtp — upsert the org's SMTP config. */
export async function updateSmtp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const body = UpdateSchema.parse(req.body);

    const existing = await prisma.smtpConfig.findUnique({ where: { orgId } });

    if (!existing) {
      // First-time setup needs the required fields.
      if (!body.host || !body.fromAddress) {
        throw new HttpError(400, 'host and fromAddress are required for first-time setup');
      }
    }

    // Build the update payload. authPass handling:
    //   - undefined → leave existing
    //   - null      → clear (no auth)
    //   - string    → encrypt + store
    const data: Record<string, unknown> = {};
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.host !== undefined) data.host = body.host;
    if (body.port !== undefined) data.port = body.port;
    if (body.secure !== undefined) data.secure = body.secure;
    if (body.authUser !== undefined) data.authUser = body.authUser;
    if (body.fromAddress !== undefined) data.fromAddress = body.fromAddress;
    if (body.replyTo !== undefined) data.replyTo = body.replyTo;
    if (body.authPass !== undefined) {
      data.authPass = body.authPass === null ? null : encrypt(body.authPass);
    }

    let saved;
    if (existing) {
      saved = await prisma.smtpConfig.update({ where: { orgId }, data });
    } else {
      saved = await prisma.smtpConfig.create({
        data: {
          orgId,
          enabled: body.enabled ?? false,
          host: body.host!,
          port: body.port ?? 587,
          secure: body.secure ?? false,
          authUser: body.authUser ?? null,
          authPass: body.authPass ? encrypt(body.authPass) : null,
          fromAddress: body.fromAddress!,
          replyTo: body.replyTo ?? null,
        },
      });
    }

    await auditFromRequest(req, {
      action: existing ? 'org.smtp.configure' : 'org.smtp.enable',
      targetType: 'org',
      targetId: orgId,
      metadata: {
        changedKeys: Object.keys(body),
        passwordRotated: body.authPass !== undefined,
      },
    });

    invalidateOrgSmtpCache(orgId);
    res.json({ config: publicView(saved) });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/v1/settings/smtp — disable + clear stored config. */
export async function disableSmtp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const result = await prisma.smtpConfig.deleteMany({ where: { orgId } });
    if (result.count > 0) {
      await auditFromRequest(req, {
        action: 'org.smtp.disable',
        targetType: 'org',
        targetId: orgId,
      });
      invalidateOrgSmtpCache(orgId);
    }
    res.json({ ok: true, removed: result.count });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/settings/smtp/test — perform a real `verify()` + send a test
 * email. Stores the result on the config row so the Settings UI can show
 * "Last test: 12 May at 14:02 — Failed: ECONNREFUSED".
 */
export async function testSmtp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const userId = req.user!.userId;
    const { to, persist } = TestSchema.parse(req.body ?? {});

    const cfg = await prisma.smtpConfig.findUnique({ where: { orgId } });
    if (!cfg) throw new HttpError(404, 'SMTP not configured yet');

    let recipient = to;
    if (!recipient) {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      recipient = user?.email;
    }
    if (!recipient) {
      throw new HttpError(400, 'Specify a "to" address (your user record has no email).');
    }

    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth:
        cfg.authUser && cfg.authPass
          ? { user: cfg.authUser, pass: safeDecrypt(cfg.authPass) }
          : undefined,
      // Don't dawdle on broken upstreams; reply within 10 s.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });

    let ok = false;
    let errorMessage: string | null = null;
    try {
      await transporter.verify();
      await transporter.sendMail({
        from: cfg.fromAddress,
        replyTo: cfg.replyTo ?? undefined,
        to: recipient,
        subject: 'Nemesis AI — SMTP test email',
        text: `This is a test email triggered from Settings → SMTP by ${userId}.\n\nIf you received this, the configuration is working.`,
      });
      ok = true;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn({ err, orgId, host: cfg.host }, 'SMTP test failed');
    } finally {
      transporter.close?.();
    }

    if (persist) {
      await prisma.smtpConfig
        .update({
          where: { orgId },
          data: { lastTestAt: new Date(), lastTestOk: ok, lastTestError: errorMessage },
        })
        .catch(() => undefined);
    }

    await auditFromRequest(req, {
      action: ok ? 'org.smtp.test.success' : 'org.smtp.test.failure',
      targetType: 'org',
      targetId: orgId,
      metadata: { recipient, host: cfg.host, error: errorMessage },
    });

    if (!ok) {
      res.status(502).json({ ok: false, error: errorMessage ?? 'SMTP test failed' });
      return;
    }
    res.json({ ok: true, recipient });
  } catch (err) {
    next(err);
  }
}

/** Decrypt, swallowing errors so a bad rotation doesn't crash the test path. */
function safeDecrypt(enc: string): string {
  try {
    return decrypt(enc);
  } catch {
    return '';
  }
}
