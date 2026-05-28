import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { HttpError } from '../middleware/errorHandler';
import { sha256, generateOpaqueToken, generateFamilyId } from '../lib/tokens';
import { signAccessToken } from '../lib/jwt';
import { checkPassword } from '../lib/passwordPolicy';
import { auditFromRequest } from '../lib/audit';

const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const acceptSchema = z.object({
  // For brand-new users on this email
  password: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
});

/** Anonymous: preview an invite by token. Returns minimal info needed by the
 *  signup-or-link page, without revealing org internals. */
export async function previewInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.params.token;
    if (!token) throw new HttpError(400, 'Missing token');
    const invite = await prisma.invite.findUnique({
      where: { tokenHash: sha256(token) },
      include: { org: true },
    });
    if (!invite || invite.acceptedAt || (invite.expiresAt && invite.expiresAt < new Date())) {
      throw new HttpError(404, 'Invite invalid or expired');
    }
    const existingUser = await prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } });
    res.json({
      email: invite.email,
      role: invite.role,
      orgName: invite.org.name,
      hasExistingAccount: !!existingUser,
    });
  } catch (err) {
    next(err);
  }
}

/** Accept an invite: either link to an existing logged-in user OR create a new user.
 *  Returns access + refresh tokens on success. */
export async function acceptInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.params.token;
    if (!token) throw new HttpError(400, 'Missing token');
    const { password, name } = acceptSchema.parse(req.body);

    const invite = await prisma.invite.findUnique({
      where: { tokenHash: sha256(token) },
      include: { org: true },
    });
    if (!invite || invite.acceptedAt || (invite.expiresAt && invite.expiresAt < new Date())) {
      throw new HttpError(404, 'Invite invalid or expired');
    }

    // Path A: existing user with this email — they must be logged in to attach.
    const existing = await prisma.user.findUnique({ where: { email: invite.email } });
    let userId: string;
    let role: string;
    let orgId: string;
    let userName: string;
    let tokenVersion: number;
    let mfaEnabled: boolean;

    if (existing) {
      // NEM-2026-004: refuse to silently move an existing user from one org
      // to another via an anonymous invite link. An attacker who knows a
      // victim's email could otherwise create an invite at their own org and
      // hijack the account. Multi-org membership is the v2.0 fix — until
      // that ships, the recipient must accept from within their existing
      // tenant (or have an admin transfer their account).
      if (existing.orgId !== invite.orgId) {
        throw new HttpError(
          409,
          'This email is already associated with another organisation. ' +
            'Sign in to that workspace and ask an admin there to delete the account, ' +
            'or use a different email when accepting this invite.',
        );
      }
      // Same-org invite acceptance: re-assert role + verify email.
      const updated = await prisma.user.update({
        where: { id: existing.id },
        data: {
          role: invite.role,
          emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
          tokenVersion: { increment: 1 },
        },
      });
      userId = updated.id;
      role = updated.role;
      orgId = updated.orgId;
      userName = updated.name;
      tokenVersion = updated.tokenVersion;
      mfaEnabled = updated.mfaEnabled;
    } else {
      if (!password || !name) throw new HttpError(400, 'New users must provide name + password.');
      const policy = checkPassword(password);
      if (policy) throw new HttpError(400, policy);
      const hash = await bcrypt.hash(password, 12);
      const user = await prisma.user.create({
        data: {
          email: invite.email,
          name,
          password: hash,
          role: invite.role,
          orgId: invite.orgId,
          emailVerifiedAt: new Date(),
          passwordChangedAt: new Date(),
        },
      });
      userId = user.id;
      role = user.role;
      orgId = user.orgId;
      userName = user.name;
      tokenVersion = user.tokenVersion;
      mfaEnabled = user.mfaEnabled;
    }

    await prisma.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });

    const accessToken = signAccessToken({ userId, orgId, role, tokenVersion });
    const raw = generateOpaqueToken();
    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(raw),
        family: generateFamilyId(),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        userAgent: typeof req.headers['user-agent'] === 'string' ? (req.headers['user-agent'] as string).slice(0, 500) : null,
        ip: req.ip ?? null,
      },
    });

    await auditFromRequest(req, {
      orgId,
      actorId: userId,
      action: 'invite.accepted',
      targetType: 'invite',
      targetId: invite.id,
      metadata: { email: invite.email, role, hadExistingAccount: !!existing },
    });

    res.json({
      token: accessToken,
      accessToken,
      refreshToken: raw,
      user: { id: userId, email: invite.email, name: userName, role, orgId, orgName: invite.org.name, mfaEnabled },
    });
  } catch (err) {
    next(err);
  }
}
