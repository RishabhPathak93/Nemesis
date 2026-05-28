import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

// v11 of @simplewebauthn/server moved its public JSON types into a separate
// `@simplewebauthn/types` package. To keep this lib boundary tidy without
// pulling that extra dep, we infer the types from the function signatures.
type RegistrationResponseJSON = Parameters<typeof verifyRegistrationResponse>[0]['response'];
type AuthenticationResponseJSON = Parameters<typeof verifyAuthenticationResponse>[0]['response'];
import { prisma } from '../lib/prisma';
import { auditFromRequest } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';
import { env } from '../lib/env';
import { signAccessToken, signMfaSession, verifyMfaSession } from '../lib/jwt';
import { generateOpaqueToken, generateFamilyId, sha256 } from '../lib/tokens';

/**
 * WebAuthn / passkeys (v2.0). A second-factor option alongside TOTP for users
 * who want hardware-backed credentials. The flow:
 *
 *   Registration:
 *     POST /auth/webauthn/register/options       (auth required) → public-key opts
 *     POST /auth/webauthn/register/verify        (auth required) → persists credential
 *
 *   Authentication (during login, after password check):
 *     POST /auth/webauthn/auth/options           (mfaSessionToken)
 *     POST /auth/webauthn/auth/verify            (mfaSessionToken)
 *
 *   Listing / removal:
 *     GET    /auth/webauthn/credentials          (auth required)
 *     DELETE /auth/webauthn/credentials/:id      (auth required)
 *
 * Challenges are persisted server-side (`WebauthnChallenge`) so we can reject
 * reuse + clear on consumption.
 */

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function rpInfo() {
  // The Relying Party id is a domain — we derive it from CLIENT_ORIGIN.
  const url = new URL(env.clientOrigin);
  return {
    rpName: 'Nemesis AI',
    rpID: url.hostname,
    expectedOrigin: env.clientOrigin.replace(/\/$/, ''),
  };
}

async function loadCredentialsForUser(userId: string) {
  return prisma.webauthnCredential.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

async function persistChallenge(userId: string, challenge: string, purpose: 'registration' | 'authentication'): Promise<void> {
  await prisma.webauthnChallenge.create({
    data: {
      userId,
      challenge,
      purpose,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
}

async function consumeChallenge(userId: string, challenge: string, purpose: 'registration' | 'authentication'): Promise<boolean> {
  const row = await prisma.webauthnChallenge.findFirst({
    where: { userId, challenge, purpose, expiresAt: { gt: new Date() } },
  });
  if (!row) return false;
  await prisma.webauthnChallenge.delete({ where: { id: row.id } });
  return true;
}

/** GET /api/auth/webauthn/credentials — list this user's registered passkeys. */
export async function listCredentials(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const creds = await loadCredentialsForUser(userId);
    res.json({
      credentials: creds.map((c) => ({
        id: c.id,
        deviceLabel: c.deviceLabel,
        transports: c.transports,
        backupEligible: c.backupEligible,
        backupState: c.backupState,
        lastUsedAt: c.lastUsedAt,
        createdAt: c.createdAt,
      })),
    });
  } catch (err) { next(err); }
}

/** DELETE /api/auth/webauthn/credentials/:id — remove a passkey. */
export async function removeCredential(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const id = req.params.id;
    const cred = await prisma.webauthnCredential.findFirst({ where: { id, userId } });
    if (!cred) throw new HttpError(404, 'credential not found');
    await prisma.webauthnCredential.delete({ where: { id } });
    await auditFromRequest(req, {
      action: 'auth.webauthn.credential.removed',
      targetType: 'user',
      targetId: userId,
      metadata: { credentialId: id },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

/** POST /api/auth/webauthn/register/options — issues a registration challenge. */
export async function registrationOptions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new HttpError(404, 'user not found');
    const existing = await loadCredentialsForUser(userId);
    const { rpName, rpID } = rpInfo();
    const opts = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: user.email,
      userDisplayName: user.name,
      userID: Buffer.from(user.id),
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      excludeCredentials: existing.map((c) => ({
        id: Buffer.from(c.credentialId).toString('base64url'),
        transports: c.transports as ('usb' | 'nfc' | 'ble' | 'internal' | 'hybrid' | 'cable' | 'smart-card')[],
      })),
    });
    await persistChallenge(userId, opts.challenge, 'registration');
    res.json(opts);
  } catch (err) { next(err); }
}

const VerifyRegistrationSchema = z.object({
  deviceLabel: z.string().min(1).max(100).default('Security Key'),
  // The browser-emitted attestation response — opaque to us.
  response: z.unknown(),
});

/** POST /api/auth/webauthn/register/verify — persists the credential. */
export async function registrationVerify(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const body = VerifyRegistrationSchema.parse(req.body);
    const { rpID, expectedOrigin } = rpInfo();

    const verification = await verifyRegistrationResponse({
      response: body.response as RegistrationResponseJSON,
      expectedChallenge: async (challenge: string) => {
        // Verify the challenge belongs to this user and purpose.
        return await consumeChallenge(userId, challenge, 'registration');
      },
      expectedOrigin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new HttpError(400, 'registration verification failed');
    }
    const info = verification.registrationInfo;
    await prisma.webauthnCredential.create({
      data: {
        userId,
        credentialId: Buffer.from(info.credential.id, 'base64url'),
        publicKey: Buffer.from(info.credential.publicKey),
        counter: BigInt(info.credential.counter ?? 0),
        deviceLabel: body.deviceLabel,
        transports: (info.credential.transports as string[] | undefined) ?? [],
        backupEligible: info.credentialBackedUp,
        backupState: info.credentialBackedUp,
      },
    });
    await auditFromRequest(req, {
      action: 'auth.webauthn.credential.registered',
      targetType: 'user',
      targetId: userId,
      metadata: { deviceLabel: body.deviceLabel },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}

const MfaSessionSchema = z.object({ mfaSessionToken: z.string().min(1) });

/** POST /api/auth/webauthn/auth/options — mints an authentication challenge for the MFA step. */
export async function authenticationOptions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { mfaSessionToken } = MfaSessionSchema.parse(req.body);
    const payload = verifyMfaSession(mfaSessionToken);
    const userId = payload.userId;

    const creds = await loadCredentialsForUser(userId);
    if (creds.length === 0) throw new HttpError(400, 'no passkeys registered for this user');

    const { rpID } = rpInfo();
    const opts = await generateAuthenticationOptions({
      rpID,
      allowCredentials: creds.map((c) => ({
        id: Buffer.from(c.credentialId).toString('base64url'),
        transports: c.transports as ('usb' | 'nfc' | 'ble' | 'internal' | 'hybrid' | 'cable' | 'smart-card')[],
      })),
      userVerification: 'preferred',
    });
    await persistChallenge(userId, opts.challenge, 'authentication');
    res.json(opts);
  } catch (err) { next(err); }
}

const VerifyAuthSchema = z.object({
  mfaSessionToken: z.string().min(1),
  response: z.unknown(),
});

const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** POST /api/auth/webauthn/auth/verify — completes the login MFA step. */
export async function authenticationVerify(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = VerifyAuthSchema.parse(req.body);
    const payload = verifyMfaSession(body.mfaSessionToken);
    const userId = payload.userId;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new HttpError(404, 'user not found');

    const responseAny = body.response as AuthenticationResponseJSON;
    const credIdRaw = responseAny.id;
    const credIdBuf = Buffer.from(credIdRaw, 'base64url');
    const cred = await prisma.webauthnCredential.findUnique({
      where: { credentialId: credIdBuf },
    });
    if (!cred || cred.userId !== userId) {
      throw new HttpError(400, 'unknown credential for this user');
    }

    const { rpID, expectedOrigin } = rpInfo();
    const verification = await verifyAuthenticationResponse({
      response: responseAny,
      expectedChallenge: async (challenge: string) => {
        return await consumeChallenge(userId, challenge, 'authentication');
      },
      expectedOrigin,
      expectedRPID: rpID,
      credential: {
        id: Buffer.from(cred.credentialId).toString('base64url'),
        publicKey: new Uint8Array(cred.publicKey),
        counter: Number(cred.counter),
        transports: cred.transports as ('usb' | 'nfc' | 'ble' | 'internal' | 'hybrid' | 'cable' | 'smart-card')[],
      },
      requireUserVerification: false,
    });
    if (!verification.verified) {
      throw new HttpError(400, 'authentication verification failed');
    }

    // Update counter + lastUsedAt.
    await prisma.webauthnCredential.update({
      where: { id: cred.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });

    // Mint access + refresh tokens — same shape as TOTP MFA verify.
    const accessToken = signAccessToken({
      userId: user.id, orgId: user.orgId, role: user.role, tokenVersion: user.tokenVersion,
    });
    const refreshRaw = generateOpaqueToken();
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshRaw),
        family: generateFamilyId(),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        ip: req.ip ?? null,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      },
    });

    await auditFromRequest(req, {
      action: 'auth.webauthn.login.success',
      actorId: user.id,
      targetType: 'user',
      targetId: user.id,
      metadata: { credentialId: cred.id },
    });

    const org = await prisma.org.findUnique({ where: { id: user.orgId }, select: { name: true } });
    res.json({
      accessToken,
      refreshToken: refreshRaw,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        orgId: user.orgId,
        orgName: org?.name ?? '',
        mfaEnabled: user.mfaEnabled,
      },
    });
  } catch (err) { next(err); }
}

/** POST /api/auth/webauthn/login/start — for users with passkeys, kicks off the
 * MFA-session flow without requiring a TOTP code. The actual `mfaSessionToken`
 * is minted by the existing /auth/login flow and forwarded here.
 *
 * We expose this convenience helper so frontends can branch: "this user has a
 * passkey" → use the WebAuthn flow; otherwise fall through to TOTP.
 */
export async function hasPasskey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { mfaSessionToken } = MfaSessionSchema.parse(req.body);
    const payload = verifyMfaSession(mfaSessionToken);
    const count = await prisma.webauthnCredential.count({ where: { userId: payload.userId } });
    res.json({ hasPasskey: count > 0 });
  } catch (err) { next(err); }
}

/** Helper: also mints an MFA session bypass IF the user happens to be already
 * logged in elsewhere (e.g. used to add a 2nd passkey or test). Not used in v2. */
export async function _placeholder(): Promise<string> { return signMfaSession('placeholder'); }
