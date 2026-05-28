import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JwtPayload } from '../lib/jwt';
import { prisma } from '../lib/prisma';
import { sha256, isApiKey } from '../lib/tokens';
import { hasPermission, Permission } from '../lib/permissions';
import { logger } from '../lib/logger';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
      apiKeyId?: string;
      apiKeyScopes?: string[];
    }
  }
}

/**
 * Authentication: accepts either
 *   1. JWT access token via `Authorization: Bearer ...` or `cv_token` cookie, or
 *   2. API key (`cv_live_...`) via `X-API-Key` header or Bearer scheme.
 *
 * On success populates `req.user` and (for API keys) `req.apiKeyId` + `req.apiKeyScopes`.
 */
export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  let bearer: string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) bearer = authHeader.slice(7);
  const apiKeyHeader = typeof req.headers['x-api-key'] === 'string' ? (req.headers['x-api-key'] as string) : undefined;
  const apiKeyCandidate = apiKeyHeader ?? (bearer && isApiKey(bearer) ? bearer : undefined);

  // 1. API-key auth path
  if (apiKeyCandidate) {
    try {
      const hash = sha256(apiKeyCandidate);
      const key = await prisma.apiKey.findUnique({
        where: { keyHash: hash },
        include: { createdBy: true },
      });
      if (!key || key.revokedAt || (key.expiresAt && key.expiresAt < new Date())) {
        res.status(401).json({ error: 'Invalid API key', requestId: req.id });
        return;
      }
      // Update lastUsedAt async — don't block the request path.
      prisma.apiKey
        .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
        .catch((err) => logger.warn({ err }, 'apiKey lastUsedAt update failed'));
      req.user = {
        userId: key.createdById,
        orgId: key.orgId,
        // API keys inherit the creator's role for permission table purposes,
        // but scope checks (requireScope) still gate write actions.
        role: key.createdBy.role,
        tokenVersion: 0,
      };
      req.apiKeyId = key.id;
      req.apiKeyScopes = key.scopes;
      next();
      return;
    } catch (err) {
      logger.warn({ err }, 'api key auth error');
      res.status(401).json({ error: 'Invalid API key', requestId: req.id });
      return;
    }
  }

  // 2. JWT path
  let token = bearer;
  if (!token && req.cookies?.token) token = req.cookies.token;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized', requestId: req.id });
    return;
  }

  let payload: JwtPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    res.status(401).json({ error: 'Invalid token', requestId: req.id });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { id: true, isActive: true, tokenVersion: true } });
    if (!user) {
      res.status(401).json({ error: 'User not found', requestId: req.id });
      return;
    }
    if (!user.isActive) {
      res.status(401).json({ error: 'Account deactivated', requestId: req.id });
      return;
    }
    if (user.tokenVersion !== payload.tokenVersion) {
      res.status(401).json({ error: 'Session revoked', requestId: req.id });
      return;
    }
  } catch (err) {
    logger.error({ err }, 'auth user lookup failed');
    res.status(500).json({ error: 'Internal server error', requestId: req.id });
    return;
  }

  req.user = payload;
  next();
}

/** Legacy role check — prefer requirePermission for new code. */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden', requestId: req.id });
      return;
    }
    next();
  };
}

/** Re-exports for ergonomic imports from middleware/auth. */
export { hasPermission };
export type { Permission };

/** Permission-table-backed authorization. */
export function requirePermission(perm: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.user?.role;
    if (!role || !hasPermission(role, perm)) {
      res.status(403).json({ error: 'Forbidden', requestId: req.id });
      return;
    }
    next();
  };
}

/** API-key-only scope guard. JWT users skip this check (they go through requirePermission). */
export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.apiKeyId) {
      next();
      return;
    }
    if (!req.apiKeyScopes?.includes(scope)) {
      res.status(403).json({ error: `API key missing scope '${scope}'`, requestId: req.id });
      return;
    }
    next();
  };
}
