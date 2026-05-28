import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { HttpError } from '../middleware/errorHandler';
import { generateOpaqueToken, sha256 } from '../lib/tokens';
import { checkPassword } from '../lib/passwordPolicy';
import { sendEmail, clientUrl } from '../lib/email';
import { auditFromRequest } from '../lib/audit';

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

const forgotSchema = z.object({ email: z.string().email() });
const resetSchema = z.object({ token: z.string().min(8), password: z.string().min(1) });
const changeSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) });

export async function forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = forgotSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    // Reply success regardless to prevent enumeration.
    if (user && user.isActive) {
      const raw = generateOpaqueToken();
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256(raw),
          expiresAt: new Date(Date.now() + RESET_TTL_MS),
          ip: req.ip ?? null,
        },
      });
      await sendEmail({
        to: user.email,
        subject: 'Reset your Nemesis AI password',
        text: `Reset your password by visiting: ${clientUrl(`/reset/${raw}`)}\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
      }, user.orgId);
      await auditFromRequest(req, {
        orgId: user.orgId,
        actorId: null,
        actorType: 'system',
        action: 'user.password_reset.requested',
        targetType: 'user',
        targetId: user.id,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token, password } = resetSchema.parse(req.body);
    const policy = checkPassword(password);
    if (policy) throw new HttpError(400, policy);

    const row = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw new HttpError(400, 'Token invalid or expired');
    }

    const hash = await bcrypt.hash(password, 12);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: row.userId },
        data: {
          password: hash,
          passwordChangedAt: new Date(),
          // Bump tokenVersion so all live access tokens die immediately
          tokenVersion: { increment: 1 },
          // Clear the lockout so the user isn't stuck after a forgotten-password recovery
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
      prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      // Revoke every refresh token — full session purge.
      prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);

    await auditFromRequest(req, {
      orgId: row.user.orgId,
      actorId: row.user.id,
      action: 'user.password_reset.completed',
      targetType: 'user',
      targetId: row.user.id,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new HttpError(401, 'Unauthorized');
    const { currentPassword, newPassword } = changeSchema.parse(req.body);
    const policy = checkPassword(newPassword);
    if (policy) throw new HttpError(400, policy);

    const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
    if (!user) throw new HttpError(404, 'User not found');
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) throw new HttpError(401, 'Current password is incorrect');

    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          password: hash,
          passwordChangedAt: new Date(),
          tokenVersion: { increment: 1 },
        },
      }),
      prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);

    await auditFromRequest(req, {
      action: 'user.password_changed',
      targetType: 'user',
      targetId: user.id,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
