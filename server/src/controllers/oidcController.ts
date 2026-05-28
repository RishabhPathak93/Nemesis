import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { prisma } from '../lib/prisma';
import { encrypt } from '../lib/crypto';
import { auditFromRequest, writeAudit } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';
import { signAccessToken } from '../lib/jwt';
import { generateOpaqueToken, generateFamilyId, sha256 } from '../lib/tokens';
import { logger } from '../lib/logger';
import { env } from '../lib/env';
import { buildSafeRedirectUrl, safeRelativePath } from '../lib/safeRedirect';
import {
  loadOidcClient,
  spRedirectUri,
  findOrgWithOidcByEmail,
  generatePkce,
} from '../lib/oidc';

const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000;

async function issueRefreshTokenForOidc(userId: string, ip: string | null, ua: string | null): Promise<string> {
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

const ConfigureSchema = z.object({
  enabled: z.boolean().optional(),
  issuerUrl: z.string().url().optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  scopes: z.array(z.string()).optional(),
  emailDomains: z.array(z.string()).optional(),
  jitProvision: z.boolean().optional(),
  defaultRole: z.enum(['ADMIN', 'ANALYST', 'VIEWER']).optional(),
  claimEmail: z.string().optional(),
  claimName: z.string().optional(),
});

export async function getOidc(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const cfg = await prisma.oidcConfig.findUnique({ where: { orgId } });
    res.json({
      config: cfg ? { ...cfg, clientSecret: undefined } : null,
      sp: { redirectUri: spRedirectUri(orgId) },
    });
  } catch (err) { next(err); }
}

export async function updateOidc(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const body = ConfigureSchema.parse(req.body);
    const data: Record<string, unknown> = { ...body };
    if (body.clientSecret) data.clientSecret = encrypt(body.clientSecret);
    const existing = await prisma.oidcConfig.findUnique({ where: { orgId } });
    let cfg;
    if (existing) {
      cfg = await prisma.oidcConfig.update({ where: { orgId }, data });
    } else {
      if (!body.issuerUrl || !body.clientId || !body.clientSecret) {
        throw new HttpError(400, 'issuerUrl, clientId, and clientSecret are required for first-time setup');
      }
      cfg = await prisma.oidcConfig.create({
        data: {
          orgId,
          enabled: body.enabled ?? false,
          issuerUrl: body.issuerUrl,
          clientId: body.clientId,
          clientSecret: encrypt(body.clientSecret),
          scopes: body.scopes ?? ['openid', 'profile', 'email'],
          emailDomains: body.emailDomains ?? [],
          jitProvision: body.jitProvision ?? true,
          defaultRole: body.defaultRole ?? 'VIEWER',
          claimEmail: body.claimEmail ?? 'email',
          claimName: body.claimName ?? 'name',
        },
      });
    }
    await auditFromRequest(req, {
      action: existing ? 'org.oidc.configure' : 'org.oidc.enable',
      targetType: 'org',
      targetId: orgId,
      metadata: { changedKeys: Object.keys(body) },
    });
    res.json({ ...cfg, clientSecret: undefined });
  } catch (err) { next(err); }
}

const DiscoverSchema = z.object({ email: z.string().email() });

/** POST /api/sso/discover-oidc — returns whether the email's domain has OIDC. */
export async function discoverOidc(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = DiscoverSchema.parse(req.body);
    const found = await findOrgWithOidcByEmail(email);
    res.json({ oidcEnabled: !!found, orgSlug: found?.orgSlug ?? null });
  } catch (err) { next(err); }
}

/** GET /api/auth/oidc/:orgSlug/login — kicks off auth code + PKCE. */
export async function oidcLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const loaded = await loadOidcClient(req.params.orgSlug);
    if (!loaded) throw new HttpError(404, 'OIDC not configured for this org');
    const { client, cfg } = loaded;
    const { codeVerifier, codeChallenge, nonce } = generatePkce();
    const session = await prisma.oidcSession.create({
      data: {
        oidcConfigId: cfg.oidcConfigId,
        codeVerifier,
        nonce,
        // NEM-2026-002: pre-sanitise so an attacker cannot persist an
        // attacker-controlled absolute URL into the session row.
        redirectAfter:
          typeof req.query.RelayState === 'string'
            ? safeRelativePath(req.query.RelayState)
            : null,
        ip: req.ip ?? null,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      },
    });
    const url = client.authorizationUrl({
      scope: cfg.scopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      nonce,
      state: session.id,
    });
    res.redirect(url);
  } catch (err) { next(err); }
}

/** GET /api/auth/oidc/:orgSlug/callback — finishes the code exchange. */
export async function oidcCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgSlug = req.params.orgSlug;
    const loaded = await loadOidcClient(orgSlug);
    if (!loaded) throw new HttpError(404, 'OIDC not configured for this org');
    const { client, cfg } = loaded;

    const state = (req.query.state as string | undefined) ?? '';
    if (!state) throw new HttpError(400, 'missing state');

    // NEM-2026-008: atomic state consume. updateMany with WHERE consumedAt=null
    // makes "find + mark used" a single SQL operation, so two parallel
    // callbacks for the same state cannot both succeed.
    const consumed = await prisma.oidcSession.updateMany({
      where: { id: state, oidcConfigId: cfg.oidcConfigId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      await writeAudit({
        orgId: cfg.orgId,
        action: 'auth.oidc.login.failure',
        actorType: 'system',
        targetType: 'org',
        targetId: cfg.orgId,
        metadata: { reason: 'replayed_or_unknown' },
      });
      throw new HttpError(400, 'OIDC session already consumed or unknown');
    }
    const session = await prisma.oidcSession.findUnique({ where: { id: state } });
    if (!session) throw new HttpError(400, 'OIDC session vanished mid-flow');

    const params = client.callbackParams(req as unknown as Parameters<typeof client.callbackParams>[0]);
    const tokenSet = await client.callback(spRedirectUri(orgSlug), params, {
      code_verifier: session.codeVerifier,
      nonce: session.nonce,
      state,
    });
    const claims = tokenSet.claims();
    // NEM-2026-008: explicit nonce check defends against id_token replay if
    // the underlying library's internal verification regresses.
    if (typeof claims.nonce === 'string' && claims.nonce !== session.nonce) {
      throw new HttpError(400, 'OIDC nonce mismatch');
    }
    const email = String(claims[cfg.claimEmail] ?? claims.email ?? '').toLowerCase();
    const name = String(claims[cfg.claimName] ?? claims.name ?? email.split('@')[0]);
    if (!email) throw new HttpError(400, 'OIDC token missing email claim');

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      if (!cfg.jitProvision) throw new HttpError(403, 'user not provisioned and JIT is disabled');
      const tempPass = randomBytes(24).toString('hex');
      user = await prisma.user.create({
        data: {
          email,
          name,
          orgId: cfg.orgId,
          role: cfg.defaultRole as 'ADMIN' | 'ANALYST' | 'VIEWER',
          password: await bcrypt.hash(tempPass, 12),
          emailVerifiedAt: new Date(),
          isActive: true,
        },
      });
    }
    if (!user.isActive) throw new HttpError(403, 'user is deactivated');
    if (user.orgId !== cfg.orgId) throw new HttpError(403, 'user belongs to a different org');

    const accessToken = signAccessToken({
      userId: user.id, orgId: user.orgId, role: user.role, tokenVersion: user.tokenVersion,
    });
    const refreshTok = await issueRefreshTokenForOidc(
      user.id,
      req.ip ?? null,
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    );

    await writeAudit({
      orgId: cfg.orgId,
      actorId: user.id,
      action: 'auth.oidc.login.success',
      targetType: 'user',
      targetId: user.id,
      metadata: { email, issuer: cfg.issuerUrl },
    });

    // NEM-2026-002: same-origin redirect + tokens-as-cookies, not URL params.
    const target = buildSafeRedirectUrl(session.redirectAfter);
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
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'OIDC callback failed');
    next(err);
  }
}
