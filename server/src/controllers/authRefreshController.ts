import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { HttpError } from '../middleware/errorHandler';
import { signAccessToken, verifyAccessToken } from '../lib/jwt';
import { generateOpaqueToken, sha256 } from '../lib/tokens';
import { auditFromRequest } from '../lib/audit';
import { logger } from '../lib/logger';

const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const logoutSchema = z.object({ refreshToken: z.string().min(1).optional() });

/** Rotate a refresh token. Replay (reuse of an already-revoked token) revokes the entire family. */
export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    const row = await prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: { include: { org: true } } },
    });
    if (!row) throw new HttpError(401, 'Invalid refresh token');

    if (row.revokedAt) {
      // Replay detected — revoke the whole family as a precaution.
      logger.warn({ userId: row.userId, family: row.family }, 'refresh token replay; revoking family');
      await prisma.refreshToken.updateMany({
        where: { family: row.family, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await auditFromRequest(req, {
        orgId: row.user.orgId,
        actorId: null,
        actorType: 'system',
        action: 'session.replay_detected',
        targetType: 'user',
        targetId: row.userId,
        metadata: { family: row.family },
      });
      throw new HttpError(401, 'Refresh token reused — session revoked.');
    }
    if (row.expiresAt < new Date()) throw new HttpError(401, 'Refresh token expired');
    if (!row.user.isActive) throw new HttpError(401, 'Account deactivated');

    // Mint replacement
    const raw = generateOpaqueToken();
    const next = await prisma.refreshToken.create({
      data: {
        userId: row.userId,
        tokenHash: sha256(raw),
        family: row.family,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        userAgent: typeof req.headers['user-agent'] === 'string' ? (req.headers['user-agent'] as string).slice(0, 500) : null,
        ip: req.ip ?? null,
      },
    });
    await prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date(), replacedById: next.id },
    });

    const accessToken = signAccessToken({
      userId: row.userId,
      orgId: row.user.orgId,
      role: row.user.role,
      tokenVersion: row.user.tokenVersion,
    });

    res.json({ accessToken, refreshToken: raw });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { refreshToken } = logoutSchema.parse(req.body);
    if (refreshToken) {
      await prisma.refreshToken
        .updateMany({ where: { tokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } })
        .catch(() => undefined);
    }
    // NEM-2026-007: invalidate every live access token by bumping tokenVersion.
    // Without this, the JWT issued before logout remains valid for the
    // remainder of its 15 min TTL — "sign out" is misleading. The session
    // middleware compares the JWT's tokenVersion to the user record and
    // rejects mismatches.
    //
    // The /auth/logout route is NOT protected by authMiddleware (so an
    // expired-token logout still gracefully revokes the refresh token), which
    // means req.user is undefined here. Derive the userId from whatever access
    // token is present and bump tokenVersion best-effort.
    let userId: string | undefined = req.user?.userId;
    if (!userId) {
      const authHeader = req.headers.authorization;
      const bearer = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      const cookieAt =
        typeof req.cookies?.cv_at === 'string'
          ? req.cookies.cv_at
          : typeof req.cookies?.token === 'string'
          ? req.cookies.token
          : undefined;
      const candidate = bearer || cookieAt;
      if (candidate) {
        try {
          const payload = verifyAccessToken(candidate);
          userId = payload.userId;
        } catch {
          /* expired / invalid — refresh-token-only logout path still works */
        }
      }
    }
    if (userId) {
      await prisma.user
        .update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } })
        .catch((err) => {
          logger.warn({ err, userId }, 'logout: tokenVersion bump failed');
        });
      await auditFromRequest(req, { action: 'user.logout', targetType: 'user', targetId: userId });
    }
    res.clearCookie('token');
    res.clearCookie('cv_at');
    res.clearCookie('cv_rt', { path: '/api/auth' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function listSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new HttpError(401, 'Unauthorized');
    const sessions = await prisma.refreshToken.findMany({
      where: { userId: req.user.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { issuedAt: 'desc' },
      select: { id: true, issuedAt: true, expiresAt: true, userAgent: true, ip: true },
      take: 50,
    });
    res.json({ sessions });
  } catch (err) {
    next(err);
  }
}

export async function revokeSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new HttpError(401, 'Unauthorized');
    const { id } = req.params;
    const row = await prisma.refreshToken.findUnique({ where: { id } });
    if (!row || row.userId !== req.user.userId) throw new HttpError(404, 'Not found');
    await prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
    await auditFromRequest(req, { action: 'session.revoked', targetType: 'session', targetId: id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
