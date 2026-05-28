import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { HttpError } from '../middleware/errorHandler';
import { generateApiKey } from '../lib/tokens';
import { auditFromRequest } from '../lib/audit';

const VALID_SCOPES = [
  'agents:read', 'agents:write', 'agents:run',
  'runs:read', 'runs:write',
  'reports:read',
];

const createSchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.string()).min(1).refine((arr) => arr.every((s) => VALID_SCOPES.includes(s)), {
    message: `Invalid scope; allowed: ${VALID_SCOPES.join(', ')}`,
  }),
  expiresAt: z.string().datetime().optional(),
});

export async function listApiKeys(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new HttpError(401, 'Unauthorized');
    const rows = await prisma.apiKey.findMany({
      where: { orgId: req.user.orgId },
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { name: true, email: true } } },
    });
    res.json({
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        prefix: r.prefix,
        scopes: r.scopes,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
        lastUsedAt: r.lastUsedAt,
        revokedAt: r.revokedAt,
        createdBy: r.createdBy,
      })),
      validScopes: VALID_SCOPES,
    });
  } catch (err) {
    next(err);
  }
}

export async function createApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new HttpError(401, 'Unauthorized');
    const { name, scopes, expiresAt } = createSchema.parse(req.body);
    const { full, prefix, hash } = generateApiKey();
    const key = await prisma.apiKey.create({
      data: {
        orgId: req.user.orgId,
        createdById: req.user.userId,
        name,
        prefix,
        keyHash: hash,
        scopes,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });
    await auditFromRequest(req, {
      action: 'apikey.created',
      targetType: 'api_key',
      targetId: key.id,
      metadata: { name, scopes, prefix },
    });
    res.status(201).json({
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      scopes: key.scopes,
      createdAt: key.createdAt,
      expiresAt: key.expiresAt,
      // The full key is shown EXACTLY ONCE.
      key: full,
    });
  } catch (err) {
    next(err);
  }
}

export async function revokeApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) throw new HttpError(401, 'Unauthorized');
    const { id } = req.params;
    const key = await prisma.apiKey.findUnique({ where: { id } });
    if (!key || key.orgId !== req.user.orgId) throw new HttpError(404, 'Not found');
    if (key.revokedAt) {
      res.json({ ok: true, alreadyRevoked: true });
      return;
    }
    await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await auditFromRequest(req, {
      action: 'apikey.revoked',
      targetType: 'api_key',
      targetId: id,
      metadata: { name: key.name, prefix: key.prefix },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
