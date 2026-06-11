import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { HttpError } from '../middleware/errorHandler';
import { enrollSecret, verifyTotp, generateBackupCodes, consumeBackupCode } from '../lib/mfa';
import { signAccessToken, verifyMfaSession } from '../lib/jwt';
import { generateOpaqueToken, generateFamilyId, sha256 } from '../lib/tokens';
import { auditFromRequest } from '../lib/audit';

const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const verifySetupSchema = z.object({ code: z.string().min(6).max(8) });
const verifyLoginSchema = z.object({
  mfaSessionToken: z.string().min(8),
  code: z.string().min(6).max(15),
  isBackupCode: z.boolean().optional(),
});
const disableSchema = z.object({ password: z.string().min(1) });

/** Generate (but don't yet enable) a TOTP secret. Returns QR + the encrypted
 *  secret stored on the user row pending verification. */
export async function setupMfa(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new HttpError(401, 'Unauthorized');
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) throw new HttpError(404, 'User not found');
    if (user.mfaEnabled) throw new HttpError(409, 'MFA already enabled — disable first to re-enroll.');

    const { encrypted, otpauth, qrCodeDataUrl } = await enrollSecret(user.email);
    await prisma.user.update({
      where: { id: user.id },
      // Store the secret encrypted but don't flip mfaEnabled until /verify-setup succeeds.
      data: { mfaSecret: encrypted },
    });
    res.json({ otpauth, qrCodeDataUrl });
  } catch (err) {
    next(err);
  }
}

export async function verifySetup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new HttpError(401, 'Unauthorized');
    const { code } = verifySetupSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user || !user.mfaSecret) throw new HttpError(400, 'No MFA enrollment in progress.');
    if (!verifyTotp(user.mfaSecret, code)) throw new HttpError(400, 'Code did not verify.');

    const { plaintext, hashes } = await generateBackupCodes();
    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: true, mfaBackupCodes: hashes },
    });

    await auditFromRequest(req, {
      action: 'user.mfa_enabled',
      targetType: 'user',
      targetId: user.id,
    });

    res.json({ ok: true, backupCodes: plaintext });
  } catch (err) {
    next(err);
  }
}

export async function disableMfa(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new HttpError(401, 'Unauthorized');
    const { password } = disableSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) throw new HttpError(404, 'User not found');
    const bcrypt = await import('bcryptjs');
    const ok = await bcrypt.default.compare(password, user.password);
    if (!ok) throw new HttpError(401, 'Password is incorrect.');

    await prisma.user.update({
      where: { id: user.id },
      data: { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [] },
    });
    await auditFromRequest(req, {
      action: 'user.mfa_disabled',
      targetType: 'user',
      targetId: user.id,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function regenerateBackupCodes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new HttpError(401, 'Unauthorized');
    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user || !user.mfaEnabled) throw new HttpError(400, 'MFA is not enabled.');
    const { plaintext, hashes } = await generateBackupCodes();
    await prisma.user.update({ where: { id: user.id }, data: { mfaBackupCodes: hashes } });
    await auditFromRequest(req, {
      action: 'user.mfa_backup_codes_regenerated',
      targetType: 'user',
      targetId: user.id,
    });
    res.json({ backupCodes: plaintext });
  } catch (err) {
    next(err);
  }
}

/** Final step of login when MFA is on. Consumes the mfaSessionToken from /auth/login. */
export async function verifyLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { mfaSessionToken, code, isBackupCode } = verifyLoginSchema.parse(req.body);
    let userId: string;
    try {
      ({ userId } = verifyMfaSession(mfaSessionToken));
    } catch {
      throw new HttpError(401, 'MFA session expired — log in again.');
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { org: true } });
    if (!user || !user.mfaEnabled || !user.mfaSecret) throw new HttpError(401, 'MFA not enabled.');
    // M-02: re-assert account state at the second factor — the password step's
    // isActive / lockout checks don't carry across the 5-minute MFA session.
    if (!user.isActive) throw new HttpError(401, 'Account deactivated.');
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpError(423, 'Account temporarily locked. Try again later.');
    }

    let success = false;
    let consumedBackup = -1;
    if (isBackupCode) {
      consumedBackup = await consumeBackupCode(code, user.mfaBackupCodes);
      success = consumedBackup >= 0;
    } else {
      success = verifyTotp(user.mfaSecret, code);
    }

    if (!success) {
      // M-02: count failed TOTP/backup attempts toward the SAME account lockout
      // the password path uses. Previously the MFA step had no per-account
      // throttle (only a coarse per-IP limit), so a 6-digit code with a ±1 step
      // window was brute-forceable across rotating IPs.
      const nextCount = user.failedLoginCount + 1;
      const shouldLock = nextCount >= 10; // LOCKOUT_THRESHOLD
      await prisma.user
        .update({
          where: { id: user.id },
          data: {
            failedLoginCount: shouldLock ? 0 : nextCount,
            lockedUntil: shouldLock ? new Date(Date.now() + 15 * 60 * 1000) : user.lockedUntil,
          },
        })
        .catch(() => {});
      try {
        await prisma.loginAttempt.create({ data: {
          email: user.email,
          userId: user.id,
          ip: req.ip ?? 'unknown',
          userAgent: typeof req.headers['user-agent'] === 'string' ? (req.headers['user-agent'] as string).slice(0, 500) : null,
          success: false,
          reason: shouldLock ? 'mfa_locked' : 'mfa_failed',
        }});
      } catch { /* ignore */ }
      throw new HttpError(shouldLock ? 423 : 401, shouldLock ? 'Too many attempts — account locked. Try again later.' : 'MFA code did not verify.');
    }

    // If a backup code was used, remove it.
    if (consumedBackup >= 0) {
      const remaining = [...user.mfaBackupCodes];
      remaining.splice(consumedBackup, 1);
      await prisma.user.update({ where: { id: user.id }, data: { mfaBackupCodes: remaining } });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const accessToken = signAccessToken({
      userId: user.id,
      orgId: user.orgId,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });
    const raw = generateOpaqueToken();
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(raw),
        family: generateFamilyId(),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        userAgent: typeof req.headers['user-agent'] === 'string' ? (req.headers['user-agent'] as string).slice(0, 500) : null,
        ip: req.ip ?? null,
      },
    });

    await auditFromRequest(req, {
      orgId: user.orgId,
      actorId: user.id,
      action: 'user.login',
      targetType: 'user',
      targetId: user.id,
      metadata: { mfa: true, backupCodeUsed: consumedBackup >= 0 },
    });

    res.json({
      token: accessToken,
      accessToken,
      refreshToken: raw,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        orgId: user.orgId,
        orgName: user.org.name,
        mfaEnabled: user.mfaEnabled,
      },
    });
  } catch (err) {
    next(err);
  }
}
