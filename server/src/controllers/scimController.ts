import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { sha256, generateApiKey } from '../lib/tokens';
import { auditFromRequest, writeAudit } from '../lib/audit';
import { HttpError } from '../middleware/errorHandler';

/**
 * SCIM 2.0 (v2.0). Minimal /Users surface — covers the 80% of provisioning
 * cases that IdPs actually use:
 *
 *   GET    /scim/v2/Users                 — list (paginated, with filter)
 *   POST   /scim/v2/Users                 — create
 *   GET    /scim/v2/Users/:id             — read one
 *   PATCH  /scim/v2/Users/:id             — partial update (PATCH-by-Op)
 *   PUT    /scim/v2/Users/:id             — full replace
 *   DELETE /scim/v2/Users/:id             — deprovision (soft — sets isActive=false)
 *
 * Auth: bearer token from `ScimEndpoint.bearerHash`. Operators issue/rotate
 * via `/api/v1/settings/scim`.
 *
 * Schema: we map the SCIM core User schema fields to CortexView's User row:
 *   userName     ↔ email
 *   active       ↔ isActive
 *   name.givenName + name.familyName ↔ user.name (concatenated)
 *   id           ↔ User.id
 */

interface ScimUser {
  schemas: string[];
  id: string;
  userName: string;
  name?: { givenName?: string; familyName?: string };
  emails?: { value: string; primary?: boolean }[];
  active?: boolean;
  meta?: { resourceType: string; created?: string; lastModified?: string };
}

function userToScim(u: { id: string; email: string; name: string; isActive: boolean; createdAt: Date }): ScimUser {
  const parts = u.name.split(' ');
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: u.id,
    userName: u.email,
    name: {
      givenName: parts[0] ?? '',
      familyName: parts.slice(1).join(' '),
    },
    emails: [{ value: u.email, primary: true }],
    active: u.isActive,
    meta: { resourceType: 'User', created: u.createdAt.toISOString() },
  };
}

/**
 * NEM-2026-015: clamp the provisioning role to a safe default. If a SCIM
 * endpoint was misconfigured (or compromised) with `defaultRole: 'ADMIN'`,
 * every IdP-provisioned user would land as an admin. We force-downgrade to
 * VIEWER for SCIM-created users; explicit role escalation must be a separate
 * authenticated operation.
 */
const SCIM_ALLOWED_DEFAULT_ROLES = new Set(['ANALYST', 'VIEWER']);
function clampScimRole(role: string): 'ANALYST' | 'VIEWER' {
  return SCIM_ALLOWED_DEFAULT_ROLES.has(role) ? (role as 'ANALYST' | 'VIEWER') : 'VIEWER';
}

/** Parse `Authorization: Bearer <token>` and resolve the org via ScimEndpoint. */
async function authenticate(req: Request): Promise<{ orgId: string; defaultRole: 'ANALYST' | 'VIEWER'; allowDeprovision: boolean } | null> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const hash = sha256(token);
  const ep = await prisma.scimEndpoint.findFirst({ where: { bearerHash: hash, enabled: true } });
  if (!ep) return null;
  await prisma.scimEndpoint.update({ where: { id: ep.id }, data: { lastSyncAt: new Date() } });
  return { orgId: ep.orgId, defaultRole: clampScimRole(ep.defaultRole), allowDeprovision: ep.allowDeprovision };
}

function scimError(res: Response, status: number, detail: string, scimType?: string): void {
  res.status(status).json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    status: String(status),
    detail,
    ...(scimType ? { scimType } : {}),
  });
}

const CreateUserSchema = z.object({
  schemas: z.array(z.string()).optional(),
  userName: z.string().email(),
  name: z.object({ givenName: z.string().optional(), familyName: z.string().optional() }).optional(),
  emails: z.array(z.object({ value: z.string().email(), primary: z.boolean().optional() })).optional(),
  active: z.boolean().optional(),
});

export async function listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = await authenticate(req);
    if (!auth) return scimError(res, 401, 'unauthorized');
    const startIndex = parseInt(String(req.query.startIndex ?? '1'), 10);
    const count = Math.min(parseInt(String(req.query.count ?? '100'), 10), 1000);
    const filter = String(req.query.filter ?? '');
    const where: Record<string, unknown> = { orgId: auth.orgId };
    // Common SCIM filter: `userName eq "foo@bar.com"`
    const m = filter.match(/userName\s+eq\s+"([^"]+)"/i);
    if (m) where.email = m[1].toLowerCase();
    const total = await prisma.user.count({ where });
    const rows = await prisma.user.findMany({
      where,
      skip: Math.max(0, startIndex - 1),
      take: count,
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: total,
      startIndex,
      itemsPerPage: rows.length,
      Resources: rows.map(userToScim),
    });
  } catch (err) { next(err); }
}

export async function getUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = await authenticate(req);
    if (!auth) return scimError(res, 401, 'unauthorized');
    const u = await prisma.user.findFirst({ where: { id: req.params.id, orgId: auth.orgId } });
    if (!u) return scimError(res, 404, 'user not found');
    res.json(userToScim(u));
  } catch (err) { next(err); }
}

export async function createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = await authenticate(req);
    if (!auth) return scimError(res, 401, 'unauthorized');
    const body = CreateUserSchema.parse(req.body);
    const email = body.userName.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return scimError(res, 409, 'user already exists', 'uniqueness');
    const name = [body.name?.givenName, body.name?.familyName].filter(Boolean).join(' ') || email.split('@')[0];
    const tempPass = randomBytes(24).toString('hex');
    const u = await prisma.user.create({
      data: {
        email,
        name,
        orgId: auth.orgId,
        role: auth.defaultRole,
        password: await bcrypt.hash(tempPass, 12),
        emailVerifiedAt: new Date(),
        isActive: body.active !== false,
      },
    });
    await writeAudit({
      orgId: auth.orgId,
      action: 'scim.user.provisioned',
      actorType: 'system',
      targetType: 'user',
      targetId: u.id,
      metadata: { email, role: auth.defaultRole },
    });
    void auditFromRequest;
    res.status(201).json(userToScim(u));
  } catch (err) { next(err); }
}

export async function replaceUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = await authenticate(req);
    if (!auth) return scimError(res, 401, 'unauthorized');
    const body = CreateUserSchema.parse(req.body);
    const u = await prisma.user.findFirst({ where: { id: req.params.id, orgId: auth.orgId } });
    if (!u) return scimError(res, 404, 'user not found');
    const name = [body.name?.givenName, body.name?.familyName].filter(Boolean).join(' ') || u.name;
    const updated = await prisma.user.update({
      where: { id: u.id },
      data: {
        email: body.userName.toLowerCase(),
        name,
        isActive: body.active !== false,
        ...(body.active === false ? { deactivatedAt: new Date() } : {}),
      },
    });
    await writeAudit({
      orgId: auth.orgId,
      action: 'scim.user.replaced',
      actorType: 'system',
      targetType: 'user',
      targetId: u.id,
    });
    res.json(userToScim(updated));
  } catch (err) { next(err); }
}

interface ScimPatchOp { op: string; path?: string; value?: unknown }

export async function patchUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = await authenticate(req);
    if (!auth) return scimError(res, 401, 'unauthorized');
    const u = await prisma.user.findFirst({ where: { id: req.params.id, orgId: auth.orgId } });
    if (!u) return scimError(res, 404, 'user not found');
    const ops = ((req.body as { Operations?: ScimPatchOp[] }).Operations ?? []) as ScimPatchOp[];
    const data: Record<string, unknown> = {};
    for (const op of ops) {
      if (op.op?.toLowerCase() !== 'replace') continue; // we support replace only
      if (op.path === 'active' && typeof op.value === 'boolean') {
        data.isActive = op.value;
        if (!op.value) data.deactivatedAt = new Date();
      }
      if (op.path === 'userName' && typeof op.value === 'string') data.email = op.value.toLowerCase();
      if (!op.path && op.value && typeof op.value === 'object') {
        // Patch root: { active: true, userName: '...' }
        const v = op.value as { active?: boolean; userName?: string };
        if (typeof v.active === 'boolean') {
          data.isActive = v.active;
          if (!v.active) data.deactivatedAt = new Date();
        }
        if (typeof v.userName === 'string') data.email = v.userName.toLowerCase();
      }
    }
    const updated = await prisma.user.update({ where: { id: u.id }, data });
    await writeAudit({
      orgId: auth.orgId,
      action: 'scim.user.patched',
      actorType: 'system',
      targetType: 'user',
      targetId: u.id,
      metadata: { changed: Object.keys(data) },
    });
    res.json(userToScim(updated));
  } catch (err) { next(err); }
}

export async function deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = await authenticate(req);
    if (!auth) return scimError(res, 401, 'unauthorized');
    if (!auth.allowDeprovision) return scimError(res, 403, 'de-provisioning disabled by org policy');
    const u = await prisma.user.findFirst({ where: { id: req.params.id, orgId: auth.orgId } });
    if (!u) return scimError(res, 404, 'user not found');
    await prisma.user.update({
      where: { id: u.id },
      data: { isActive: false, deactivatedAt: new Date(), tokenVersion: { increment: 1 } },
    });
    await writeAudit({
      orgId: auth.orgId,
      action: 'scim.user.deprovisioned',
      actorType: 'system',
      targetType: 'user',
      targetId: u.id,
    });
    res.status(204).end();
  } catch (err) { next(err); }
}

/* ------------------------- Admin config (separate auth) ------------------- */

export async function getScimConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const ep = await prisma.scimEndpoint.findUnique({ where: { orgId } });
    res.json(ep ? { ...ep, bearerHash: undefined } : null);
  } catch (err) { next(err); }
}

export async function rotateScimToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    const { full, prefix, hash } = generateApiKey();
    const fmtPrefix = `scim_${prefix.slice(0, 8)}`;
    const ep = await prisma.scimEndpoint.upsert({
      where: { orgId },
      create: { orgId, enabled: true, bearerHash: hash, bearerPrefix: fmtPrefix },
      update: { enabled: true, bearerHash: hash, bearerPrefix: fmtPrefix },
    });
    await auditFromRequest(req, {
      action: 'scim.endpoint.rotated',
      targetType: 'scim_endpoint',
      targetId: ep.id,
    });
    res.json({ token: full, prefix: fmtPrefix });
  } catch (err) { next(err); }
}

export async function disableScim(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = req.user!.orgId;
    await prisma.scimEndpoint.updateMany({ where: { orgId }, data: { enabled: false } });
    await auditFromRequest(req, {
      action: 'scim.endpoint.disabled',
      targetType: 'scim_endpoint',
      targetId: orgId,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}
