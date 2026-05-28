import type { Role } from '@prisma/client';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from './prisma';

/**
 * Centralised (role, permission) → bool table. Keeps role checks in one place
 * so future granular roles slot in without sprinkling `req.user.role !== 'ADMIN'`
 * across every controller.
 */

export type Permission =
  // Agents
  | 'agents:read' | 'agents:write' | 'agents:run'
  // Test runs / reports
  | 'runs:read' | 'runs:write'
  | 'reports:read' | 'reports:share' | 'reports:export'
  // Knowledge base
  | 'knowledge:read' | 'knowledge:write'
  // Org / billing-style settings
  | 'org:read' | 'org:write'
  // Membership
  | 'members:read' | 'members:invite' | 'members:manage'
  // API keys
  | 'apikeys:read' | 'apikeys:manage'
  // Audit
  | 'audit:read'
  // Danger zone
  | 'danger:delete'
  // v1.3 — branding (org-level reports customisation)
  | 'branding:read' | 'branding:write'
  // v1.3 — outbound integrations (added now; controllers ship in later increments)
  | 'webhooks:read' | 'webhooks:manage'
  | 'notifications:read' | 'notifications:manage'
  | 'reports:schedule'
  | 'sso:read' | 'sso:write'
  // SE-1 — security engine catalog
  | 'security_engine:read' | 'security_engine:manage' | 'security_engine:dry_run';

const ADMIN: Permission[] = [
  'agents:read', 'agents:write', 'agents:run',
  'runs:read', 'runs:write',
  'reports:read', 'reports:share', 'reports:export',
  'knowledge:read', 'knowledge:write',
  'org:read', 'org:write',
  'members:read', 'members:invite', 'members:manage',
  'apikeys:read', 'apikeys:manage',
  'audit:read',
  'danger:delete',
  'branding:read', 'branding:write',
  'webhooks:read', 'webhooks:manage',
  'notifications:read', 'notifications:manage',
  'reports:schedule',
  'sso:read', 'sso:write',
  'security_engine:read', 'security_engine:manage', 'security_engine:dry_run',
];

const ANALYST: Permission[] = [
  'agents:read', 'agents:write', 'agents:run',
  'runs:read', 'runs:write',
  'reports:read', 'reports:share', 'reports:export',
  'knowledge:read', 'knowledge:write',
  'org:read',
  'members:read',
  'branding:read',
  'webhooks:read', 'notifications:read',
  'reports:schedule',
  'sso:read',
  'security_engine:read', 'security_engine:dry_run',
];

const VIEWER: Permission[] = [
  'agents:read',
  'runs:read',
  'reports:read', 'reports:export',
  'knowledge:read',
  'org:read',
  'branding:read',
  'webhooks:read', 'notifications:read',
  'sso:read',
  'security_engine:read',
];

const TABLE: Record<Role, Permission[]> = { ADMIN, ANALYST, VIEWER };

export function hasPermission(role: Role | string, perm: Permission): boolean {
  const list = TABLE[role as Role];
  if (!list) return false;
  return list.includes(perm);
}

/**
 * v2.0 — granular ACL overrides. PermissionGrant rows in the DB shadow the
 * default table for a given (orgId, role, permission). Cached for 30 s.
 */
interface OverrideRow { granted: boolean }
type OverrideKey = `${string}:${Role}:${Permission}`;
let overrideCache: { at: number; map: Map<OverrideKey, boolean> } | undefined;
const OVERRIDE_CACHE_MS = 30_000;

async function loadOverrides(): Promise<Map<OverrideKey, boolean>> {
  if (overrideCache && Date.now() - overrideCache.at < OVERRIDE_CACHE_MS) return overrideCache.map;
  const rows = await prisma.permissionGrant.findMany({
    select: { orgId: true, role: true, permission: true, granted: true },
  });
  const map = new Map<OverrideKey, boolean>();
  for (const r of rows) {
    map.set(`${r.orgId}:${r.role}:${r.permission as Permission}`, r.granted);
  }
  overrideCache = { at: Date.now(), map };
  return map;
}

/** Public helper — invalidate when an admin edits the grants. */
export function invalidatePermissionOverridesCache(): void {
  overrideCache = undefined;
}

export async function hasPermissionForOrg(role: Role | string, perm: Permission, orgId: string | undefined): Promise<boolean> {
  if (!role) return false;
  const overrides = await loadOverrides();
  if (orgId) {
    const ov = overrides.get(`${orgId}:${role as Role}:${perm}`);
    if (typeof ov === 'boolean') return ov;
  }
  return hasPermission(role, perm);
}

export function requirePermission(perm: Permission) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const role = req.user?.role;
    const orgId = req.user?.orgId;
    if (!role) {
      res.status(403).json({ error: 'Forbidden', requestId: req.id });
      return;
    }
    const ok = await hasPermissionForOrg(role, perm, orgId);
    if (!ok) {
      res.status(403).json({ error: 'Forbidden', requestId: req.id });
      return;
    }
    next();
  };
}
