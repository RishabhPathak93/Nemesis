import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { auditFromRequest } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';

const PutSchema = z.object({
  ipAllowlist: z.array(z.string()).optional(),
  ssoOnly: z.boolean().optional(),
  allowedCountries: z.array(z.string().length(2)).optional(),
});

/**
 * Validate a CIDR string. Accepts IPv4 (a.b.c.d/n) or IPv6 (a:b::/n).
 * Returns true for permissive accept; we don't deeply parse here — just sanity.
 */
function isCidrLike(s: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(s) ||
    /^[0-9a-fA-F:]+\/\d{1,3}$/.test(s);
}

export async function getPolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const policy = await prisma.orgPolicy.findUnique({ where: { orgId } });
    res.json(policy ?? { orgId, ipAllowlist: [], ssoOnly: false, allowedCountries: [] });
  } catch (err) { next(err); }
}

export async function updatePolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const userId = req.user!.userId;
    const body = PutSchema.parse(req.body);
    if (body.ipAllowlist) {
      for (const c of body.ipAllowlist) {
        if (!isCidrLike(c)) throw new HttpError(400, `invalid CIDR: ${c}`);
      }
    }
    const policy = await prisma.orgPolicy.upsert({
      where: { orgId },
      create: { orgId, ...body, updatedById: userId },
      update: { ...body, updatedById: userId },
    });
    await auditFromRequest(req, {
      action: 'policy.update',
      targetType: 'org',
      targetId: orgId,
      metadata: { changed: Object.keys(body) },
    });
    res.json(policy);
  } catch (err) { next(err); }
}
