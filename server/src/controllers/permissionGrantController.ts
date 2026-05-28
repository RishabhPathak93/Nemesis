import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { auditFromRequest } from '../lib/audit';
import { invalidatePermissionOverridesCache } from '../lib/permissions';

const ROLE = z.enum(['ADMIN', 'ANALYST', 'VIEWER']);

const PutSchema = z.object({
  role: ROLE,
  permission: z.string().min(1),
  granted: z.boolean(),
});

export async function listGrants(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const grants = await prisma.permissionGrant.findMany({
      where: { orgId },
      orderBy: [{ role: 'asc' }, { permission: 'asc' }],
    });
    res.json({ grants });
  } catch (err) { next(err); }
}

export async function setGrant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const body = PutSchema.parse(req.body);
    const grant = await prisma.permissionGrant.upsert({
      where: { orgId_role_permission: { orgId, role: body.role as Role, permission: body.permission } },
      create: { orgId, role: body.role as Role, permission: body.permission, granted: body.granted },
      update: { granted: body.granted },
    });
    invalidatePermissionOverridesCache();
    await auditFromRequest(req, {
      action: 'permission.grant.set',
      targetType: 'org',
      targetId: orgId,
      metadata: { role: body.role, permission: body.permission, granted: body.granted },
    });
    res.json(grant);
  } catch (err) { next(err); }
}

export async function clearGrant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const id = req.params.id;
    const existing = await prisma.permissionGrant.findFirst({ where: { id, orgId } });
    if (!existing) { res.json({ ok: true }); return; }
    await prisma.permissionGrant.delete({ where: { id } });
    invalidatePermissionOverridesCache();
    await auditFromRequest(req, {
      action: 'permission.grant.cleared',
      targetType: 'org',
      targetId: orgId,
      metadata: { role: existing.role, permission: existing.permission },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}
