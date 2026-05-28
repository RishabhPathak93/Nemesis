import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { prisma } from '../lib/prisma';
import { auditFromRequest, writeAudit } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';
import { signAccessToken } from '../lib/jwt';
import { generateOpaqueToken, generateFamilyId, sha256 } from '../lib/tokens';
import { logger } from '../lib/logger';
import { buildSafeRedirectUrl } from '../lib/safeRedirect';
import { env } from '../lib/env';

const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000;

async function issueRefreshTokenForSso(userId: string, ip: string | null, ua: string | null): Promise<string> {
  const raw = generateOpaqueToken();
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(raw),
      family: generateFamilyId(),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      userAgent: ua,
      ip,
    },
  });
  return raw;
}
import {
  buildSamlClient,
  loadSamlContext,
  spMetadataXml,
  spEntityId,
  spAcsUrl,
  findOrgWithSamlByEmail,
  recordAssertionSeen,
} from '../lib/saml';

const ConfigureSchema = z.object({
  enabled: z.boolean().optional(),
  idpEntityId: z.string().min(1).optional(),
  idpSsoUrl: z.string().url().optional(),
  idpSloUrl: z.string().url().nullable().optional(),
  idpCertificate: z.string().min(1).optional(),
  idpCertificate2: z.string().nullable().optional(),
  emailDomains: z.array(z.string()).optional(),
  jitProvision: z.boolean().optional(),
  defaultRole: z.enum(['ADMIN', 'ANALYST', 'VIEWER']).optional(),
  allowIdpInitiated: z.boolean().optional(),
});

export async function getSso(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const cfg = await prisma.samlConfig.findUnique({ where: { orgId } });
    res.json({
      config: cfg,
      sp: { entityId: spEntityId(orgId), acsUrl: spAcsUrl(orgId), metadataUrl: `/api/auth/saml/${orgId}/metadata` },
    });
  } catch (err) { next(err); }
}

export async function updateSso(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const body = ConfigureSchema.parse(req.body);
    const data: Record<string, unknown> = { ...body };
    if (body.idpSsoUrl || body.idpEntityId) {
      data.spEntityId = spEntityId(orgId);
      data.spAcsUrl = spAcsUrl(orgId);
    }
    const existing = await prisma.samlConfig.findUnique({ where: { orgId } });
    let cfg;
    if (existing) {
      cfg = await prisma.samlConfig.update({ where: { orgId }, data });
    } else {
      if (!body.idpEntityId || !body.idpSsoUrl || !body.idpCertificate) {
        throw new HttpError(400, 'idpEntityId, idpSsoUrl, and idpCertificate are required for first-time setup');
      }
      cfg = await prisma.samlConfig.create({
        data: {
          orgId,
          enabled: body.enabled ?? false,
          idpEntityId: body.idpEntityId,
          idpSsoUrl: body.idpSsoUrl,
          idpSloUrl: body.idpSloUrl ?? null,
          idpCertificate: body.idpCertificate,
          idpCertificate2: body.idpCertificate2 ?? null,
          emailDomains: body.emailDomains ?? [],
          jitProvision: body.jitProvision ?? true,
          defaultRole: body.defaultRole ?? 'VIEWER',
          allowIdpInitiated: body.allowIdpInitiated ?? false,
          spEntityId: spEntityId(orgId),
          spAcsUrl: spAcsUrl(orgId),
        },
      });
    }
    await auditFromRequest(req, {
      action: existing ? 'org.saml.configure' : 'org.saml.enable',
      targetType: 'org',
      targetId: orgId,
      metadata: { changedKeys: Object.keys(body) },
    });
    res.json(cfg);
  } catch (err) { next(err); }
}

const DiscoverSchema = z.object({ email: z.string().email() });

/** POST /api/sso/discover — public; returns whether email's domain has SAML configured. */
export async function discoverSso(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = DiscoverSchema.parse(req.body);
    const found = await findOrgWithSamlByEmail(email);
    res.json({ samlEnabled: !!found, orgSlug: found?.orgSlug ?? null });
  } catch (err) { next(err); }
}

/** GET /api/auth/saml/:orgSlug/login — kicks off the SAML AuthnRequest. */
export async function samlLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await loadSamlContext(req.params.orgSlug);
    if (!ctx) throw new HttpError(404, 'SAML not configured for this org');
    const saml = buildSamlClient(ctx);
    const url = await saml.getAuthorizeUrlAsync(req.query.RelayState as string ?? '', '', {});
    res.redirect(url);
  } catch (err) { next(err); }
}

/** POST /api/auth/saml/:orgSlug/acs — ACS endpoint receives signed SAMLResponse. */
export async function samlAcs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await loadSamlContext(req.params.orgSlug);
    if (!ctx) throw new HttpError(404, 'SAML not configured for this org');
    const saml = buildSamlClient(ctx);
    const samlResponse = (req.body as { SAMLResponse?: string }).SAMLResponse;
    if (!samlResponse) throw new HttpError(400, 'missing SAMLResponse');

    const profile = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse });
    const p = profile.profile as { nameID?: string; nameIDFormat?: string; ID?: string; sessionIndex?: string; [k: string]: unknown } | null;
    if (!p) throw new HttpError(400, 'invalid SAML response (no profile)');

    const cfg = await prisma.samlConfig.findUnique({ where: { orgId: ctx.orgId } });
    if (!cfg) throw new HttpError(500, 'SAML config disappeared mid-flow');

    // Anti-replay: assertion ID must not have been seen before.
    // NEM-2026-014: prefer the IdP-issued NotOnOrAfter so we reject expired
    // assertions instead of accepting anything within a hardcoded 5 min window.
    const assertionId = (p.ID as string) || `assert_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const sessionNotOnOrAfter = typeof p.sessionNotOnOrAfter === 'string'
      ? new Date(p.sessionNotOnOrAfter)
      : null;
    const conditionNotOnOrAfter = typeof p.notOnOrAfter === 'string'
      ? new Date(p.notOnOrAfter)
      : null;
    const notOnOrAfter =
      conditionNotOnOrAfter && !Number.isNaN(conditionNotOnOrAfter.getTime())
        ? conditionNotOnOrAfter
        : sessionNotOnOrAfter && !Number.isNaN(sessionNotOnOrAfter.getTime())
        ? sessionNotOnOrAfter
        : new Date(Date.now() + 5 * 60_000); // fallback only when IdP omits both
    if (notOnOrAfter < new Date()) {
      throw new HttpError(400, 'SAML assertion expired');
    }
    try {
      await recordAssertionSeen(ctx.orgId, assertionId, notOnOrAfter);
    } catch {
      await writeAudit({
        orgId: ctx.orgId,
        action: 'auth.saml.login.failure',
        actorType: 'system',
        targetType: 'org',
        targetId: ctx.orgId,
        metadata: { reason: 'replayed' },
      });
      throw new HttpError(400, 'SAML response already consumed');
    }

    // Resolve email + name attributes.
    const email = ((p[cfg.attrEmail] as string) || (p.nameID as string) || '').toLowerCase();
    const name = ((p[cfg.attrName] as string) || email.split('@')[0]) as string;
    if (!email) throw new HttpError(400, 'SAML profile missing email');

    // JIT provision or look up.
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      if (!cfg.jitProvision) throw new HttpError(403, 'user not provisioned and JIT is disabled');
      const tempPass = randomBytes(24).toString('hex');
      user = await prisma.user.create({
        data: {
          email,
          name,
          orgId: ctx.orgId,
          role: cfg.defaultRole,
          password: await bcrypt.hash(tempPass, 12),
          emailVerifiedAt: new Date(),
          isActive: true,
        },
      });
    }
    if (!user.isActive) throw new HttpError(403, 'user is deactivated');
    if (user.orgId !== ctx.orgId) throw new HttpError(403, 'user belongs to a different org');

    const accessToken = signAccessToken({
      userId: user.id, orgId: user.orgId, role: user.role, tokenVersion: user.tokenVersion,
    });
    const refreshTok = await issueRefreshTokenForSso(
      user.id,
      req.ip ?? null,
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    );

    await writeAudit({
      orgId: ctx.orgId,
      actorId: user.id,
      action: 'auth.saml.login.success',
      targetType: 'user',
      targetId: user.id,
      metadata: { email },
    });

    // NEM-2026-002: redirect target must be same-origin; never honour an
    // attacker-controlled absolute URL in RelayState. Tokens are set as
    // HttpOnly+Secure cookies so they do NOT leak into URL/referrer/history.
    const redirectAfter = (req.body as { RelayState?: string }).RelayState;
    const target = buildSafeRedirectUrl(redirectAfter);
    const cookieOpts = {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'lax' as const,
      path: '/',
    };
    res.cookie('cv_at', accessToken, { ...cookieOpts, maxAge: 15 * 60 * 1000 });
    res.cookie('cv_rt', refreshTok, { ...cookieOpts, maxAge: REFRESH_TTL_MS, path: '/api/auth' });
    res.redirect(target.toString());
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'SAML ACS failed');
    next(err);
  }
}

/** GET /api/auth/saml/:orgSlug/metadata — SP-side metadata XML. */
export async function samlMetadata(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const xml = spMetadataXml(req.params.orgSlug);
    res.setHeader('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) { next(err); }
}

export async function testSso(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const ctx = await loadSamlContext(orgId);
    if (!ctx) throw new HttpError(404, 'SAML not configured');
    // Minimal smoke: build the client + AuthnRequest URL successfully.
    const saml = buildSamlClient(ctx);
    const url = await saml.getAuthorizeUrlAsync('test', '', {});
    res.json({ ok: true, authorizeUrl: url });
  } catch (err) { next(err); }
}
