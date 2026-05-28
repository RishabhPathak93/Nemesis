import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { signAccessToken } from '../lib/jwt';
import { auditFromRequest } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';

/**
 * v2.0 — multi-org Membership.
 *
 * Backwards compat: `User.orgId` remains the user's "default / primary" org.
 * Memberships are additive; the user can belong to multiple orgs with
 * potentially different roles in each.
 *
 * Org switching mints a fresh access token whose claims (orgId + role) come
 * from the chosen Membership. The refresh token stays bound to the user
 * identity (not the org).
 */

const ROLE = z.enum(['ADMIN', 'ANALYST', 'VIEWER']);

const InviteToOrgSchema = z.object({
  email: z.string().email(),
  role: ROLE,
});

const SwitchSchema = z.object({ orgId: z.string().min(1) });

/** GET /api/auth/memberships — every org this user is a member of. */
export async function listMyMemberships(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const memberships = await prisma.membership.findMany({
      where: { userId },
      include: { org: { select: { id: true, name: true } } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    // Always include the user's primary `User.orgId` even if no Membership row
    // exists for it yet — eases incremental adoption.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { org: { select: { id: true, name: true } } },
    });
    const seen = new Set(memberships.map((m) => m.orgId));
    const out = memberships.map((m) => ({
      orgId: m.orgId,
      orgName: m.org.name,
      role: m.role,
      isDefault: m.isDefault,
      isPrimary: m.orgId === user?.orgId,
    }));
    if (user && !seen.has(user.orgId)) {
      out.unshift({
        orgId: user.org.id,
        orgName: user.org.name,
        role: user.role,
        isDefault: true,
        isPrimary: true,
      });
    }
    res.json({ memberships: out });
  } catch (err) { next(err); }
}

/** POST /api/auth/memberships/switch — issues a new access token for the chosen org. */
export async function switchOrg(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { orgId } = SwitchSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new HttpError(404, 'user not found');
    let role: Role = user.role;
    if (orgId !== user.orgId) {
      const m = await prisma.membership.findUnique({
        where: { userId_orgId: { userId, orgId } },
      });
      if (!m) throw new HttpError(403, 'no membership in that org');
      role = m.role;
    }
    const accessToken = signAccessToken({
      userId, orgId, role,
      tokenVersion: user.tokenVersion,
    });
    await auditFromRequest(req, {
      orgId,
      action: 'membership.switch',
      targetType: 'user',
      targetId: userId,
      metadata: { fromOrg: user.orgId, toOrg: orgId, effectiveRole: role },
    });
    res.json({ accessToken, orgId, role });
  } catch (err) { next(err); }
}

/**
 * POST /api/settings/memberships — admin invites an existing user from
 * another org into THIS org. The invited user must already exist as a User
 * row somewhere (typical IdP-driven onboarding); we add a Membership pointing
 * at this org with the chosen role.
 */
export async function addMembership(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const body = InviteToOrgSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!existing) throw new HttpError(404, 'user with that email does not exist; invite them via /settings/invites first');
    const dup = await prisma.membership.findUnique({
      where: { userId_orgId: { userId: existing.id, orgId } },
    });
    if (dup) throw new HttpError(409, 'user is already a member of this org');
    const m = await prisma.membership.create({
      data: { userId: existing.id, orgId, role: body.role as Role },
    });
    await auditFromRequest(req, {
      action: 'membership.added',
      targetType: 'user',
      targetId: existing.id,
      metadata: { email: body.email, role: body.role },
    });
    res.status(201).json({ membership: m });
  } catch (err) { next(err); }
}

export async function listMembershipsForOrg(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const rows = await prisma.membership.findMany({
      where: { orgId },
      include: { user: { select: { email: true, name: true, isActive: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ memberships: rows });
  } catch (err) { next(err); }
}

export async function removeMembership(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const id = req.params.id;
    const m = await prisma.membership.findFirst({ where: { id, orgId } });
    if (!m) throw new HttpError(404, 'membership not found');
    await prisma.membership.delete({ where: { id } });
    await auditFromRequest(req, {
      action: 'membership.removed',
      targetType: 'user',
      targetId: m.userId,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}
