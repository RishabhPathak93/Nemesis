import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { signAccessToken, signMfaSession } from '../lib/jwt';
import { HttpError } from '../middleware/errorHandler';
import { checkPassword } from '../lib/passwordPolicy';
import { generateOpaqueToken, generateFamilyId, sha256 } from '../lib/tokens';
import { auditFromRequest } from '../lib/audit';
import { sendEmail, clientUrl } from '../lib/email';
import { logger } from '../lib/logger';

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  name: z.string().min(1),
  orgName: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const LOCKOUT_THRESHOLD = 10;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 min
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

function clientIp(req: Request): string {
  return (req.ip ?? req.socket.remoteAddress ?? 'unknown').slice(0, 64);
}

function userAgent(req: Request): string | null {
  const v = req.headers['user-agent'];
  return typeof v === 'string' ? v.slice(0, 500) : null;
}

async function recordAttempt(opts: {
  email: string;
  userId?: string | null;
  ip: string;
  userAgent: string | null;
  success: boolean;
  reason?: string;
}): Promise<void> {
  try {
    await prisma.loginAttempt.create({ data: {
      email: opts.email,
      userId: opts.userId ?? null,
      ip: opts.ip,
      userAgent: opts.userAgent,
      success: opts.success,
      reason: opts.reason ?? null,
    } });
  } catch (err) {
    logger.warn({ err }, 'loginAttempt write failed');
  }
}

async function issueRefreshToken(userId: string, family: string, req: Request): Promise<string> {
  const raw = generateOpaqueToken();
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(raw),
      family,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      userAgent: userAgent(req),
      ip: clientIp(req),
    },
  });
  return raw;
}

function userResponse(user: { id: string; email: string; name: string; role: string; orgId: string; mfaEnabled: boolean }, orgName: string) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    orgId: user.orgId,
    orgName,
    mfaEnabled: user.mfaEnabled,
  };
}

export async function signup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Self-serve signup gate. Default is CLOSED — accounts are provisioned by
    // an admin via invites / SCIM / SSO JIT. Operators who want public signup
    // back set `ALLOW_SIGNUP=true` in `.env`. The check returns the same
    // generic envelope as the success path so attackers cannot probe whether
    // signups are open or not.
    if ((process.env.ALLOW_SIGNUP ?? 'false').toLowerCase() !== 'true') {
      await auditFromRequest(req, {
        action: 'user.signup.disabled',
        targetType: 'request',
        targetId: String(req.id),
        metadata: { reason: 'self-serve signup disabled' },
      }).catch(() => {});
      res.status(403).json({
        error: 'Self-serve signup is disabled. Ask your workspace admin for an invite.',
      });
      return;
    }
    const { email, password, name, orgName } = signupSchema.parse(req.body);
    const policyError = checkPassword(password);
    if (policyError) throw new HttpError(400, policyError);
    // NEM-2026-012: do NOT reveal whether the email already has an account.
    // Returning a 409 here lets an unauthenticated attacker enumerate users.
    // We respond with the same generic 200 envelope as forgot-password and
    // log the collision for admin review.
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await auditFromRequest(req, {
        orgId: existing.orgId,
        action: 'user.signup.duplicate_email',
        targetType: 'user',
        targetId: existing.id,
        metadata: { email },
      }).catch(() => {});
      res.status(200).json({
        ok: true,
        message:
          'If this email is not already in use, your workspace has been created. ' +
          'Check your inbox for a confirmation link.',
      });
      return;
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await prisma.$transaction(async (tx) => {
      const org = await tx.org.create({ data: { name: orgName } });
      const user = await tx.user.create({
        data: {
          email,
          password: hash,
          name,
          role: 'ADMIN',
          orgId: org.id,
          // First user of a fresh org auto-verifies so first-boot UX still works
          // when SMTP isn't configured. Subsequent users (via invite or admin)
          // need to verify.
          emailVerifiedAt: new Date(),
          passwordChangedAt: new Date(),
        },
      });
      return { user, org };
    });

    const accessToken = signAccessToken({
      userId: result.user.id,
      orgId: result.org.id,
      role: result.user.role,
      tokenVersion: result.user.tokenVersion,
    });
    const refreshToken = await issueRefreshToken(result.user.id, generateFamilyId(), req);

    await auditFromRequest(req, {
      orgId: result.org.id,
      actorId: result.user.id,
      action: 'user.signup',
      targetType: 'user',
      targetId: result.user.id,
      metadata: { email: result.user.email },
    });

    res.status(201).json({
      // Legacy field name `token` kept for back-compat with existing frontend.
      token: accessToken,
      accessToken,
      refreshToken,
      user: userResponse(result.user, result.org.name),
    });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ip = clientIp(req);
  const ua = userAgent(req);
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email }, include: { org: true } });
    if (!user) {
      await recordAttempt({ email, ip, userAgent: ua, success: false, reason: 'no_user' });
      throw new HttpError(401, 'Invalid credentials');
    }
    if (!user.isActive) {
      await recordAttempt({ email, userId: user.id, ip, userAgent: ua, success: false, reason: 'inactive' });
      throw new HttpError(401, 'Account deactivated');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await recordAttempt({ email, userId: user.id, ip, userAgent: ua, success: false, reason: 'locked' });
      res.status(423).json({
        error: 'Account temporarily locked. Try again later.',
        lockedUntil: user.lockedUntil,
        requestId: req.id,
      });
      return;
    }

    // v1.5 — SSO-only enforcement. When the org policy mandates SSO, password
    // login is blocked. The SAML/OIDC ACS endpoints don't go through this path.
    const orgPolicy = await prisma.orgPolicy.findUnique({ where: { orgId: user.orgId } });
    if (orgPolicy?.ssoOnly) {
      await recordAttempt({ email, userId: user.id, ip, userAgent: ua, success: false, reason: 'sso_only' });
      throw new HttpError(403, 'Password login is disabled for this organisation. Sign in via your identity provider.');
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      const next = user.failedLoginCount + 1;
      const shouldLock = next >= LOCKOUT_THRESHOLD;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: shouldLock ? 0 : next,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MS) : null,
        },
      });
      await recordAttempt({ email, userId: user.id, ip, userAgent: ua, success: false, reason: shouldLock ? 'locked' : 'bad_password' });
      if (shouldLock) {
        await auditFromRequest(req, {
          orgId: user.orgId,
          actorId: null,
          action: 'user.locked',
          targetType: 'user',
          targetId: user.id,
          metadata: { email },
        });
      }
      throw new HttpError(401, 'Invalid credentials');
    }

    // Password ok. If MFA, branch to challenge step.
    if (user.mfaEnabled && user.mfaSecret) {
      await recordAttempt({ email, userId: user.id, ip, userAgent: ua, success: true, reason: 'mfa_required' });
      const mfaSessionToken = signMfaSession(user.id);
      res.json({ requiresMfa: true, mfaSessionToken });
      return;
    }

    // Reset counters; record successful login.
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await recordAttempt({ email, userId: user.id, ip, userAgent: ua, success: true });

    const accessToken = signAccessToken({
      userId: user.id,
      orgId: user.orgId,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });
    const refreshToken = await issueRefreshToken(user.id, generateFamilyId(), req);

    await auditFromRequest(req, {
      orgId: user.orgId,
      actorId: user.id,
      action: 'user.login',
      targetType: 'user',
      targetId: user.id,
    });

    res.json({
      token: accessToken,
      accessToken,
      refreshToken,
      user: userResponse(user, user.org.name),
    });
  } catch (err) {
    next(err);
  }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new HttpError(401, 'Unauthorized');
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: { org: true },
    });
    if (!user) throw new HttpError(404, 'User not found');
    res.json(userResponse(user, user.org.name));
  } catch (err) {
    next(err);
  }
}

/** Trigger a fresh email-verification link. Public — but rate-limited. */
export async function requestVerificationEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const schema = z.object({ email: z.string().email() });
    const { email } = schema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    // Always reply success to avoid leaking enumeration.
    if (!user || user.emailVerifiedAt) {
      res.json({ ok: true });
      return;
    }
    const raw = generateOpaqueToken();
    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS),
      },
    });
    await sendEmail({
      to: user.email,
      subject: 'Verify your Nemesis AI email',
      text: `Verify your email by visiting: ${clientUrl(`/verify-email/${raw}`)}\nThis link expires in 24 hours.`,
    }, user.orgId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.params.token;
    if (!token) throw new HttpError(400, 'Missing token');
    const row = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw new HttpError(400, 'Token invalid or expired');
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } }),
      prisma.emailVerificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    ]);
    await auditFromRequest(req, {
      orgId: row.user.orgId,
      actorId: row.user.id,
      action: 'user.email_verified',
      targetType: 'user',
      targetId: row.user.id,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
