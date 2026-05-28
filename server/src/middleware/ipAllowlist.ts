import type { Request, Response, NextFunction } from 'express';
import { promises as fs } from 'fs';
import { prisma } from '../lib/prisma';
import { writeAudit } from '../lib/audit';
import { logger } from '../lib/logger';

/**
 * Per-org IP allowlist + country allowlist enforcement (v1.5/v2.0).
 *
 * IP allowlist: each org configures CIDRs in `OrgPolicy.ipAllowlist`. If
 * non-empty, every authenticated request from that org must match a CIDR.
 *
 * Country allowlist: each org may add ISO-3166-1 alpha-2 codes to
 * `OrgPolicy.allowedCountries`. If non-empty, requests from outside that
 * list are blocked. Country resolution uses an MMDB file at the path
 * `MMDB_PATH` (set by the operator). When MMDB is absent, country
 * enforcement is a no-op + logs once at boot.
 *
 * Skipped for unauthenticated requests, /health, and /api/csrf.
 */

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map((n) => parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function cidrMatchV4(ip: string, cidr: string): boolean {
  const [base, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr ?? '32', 10);
  if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return false;
  const baseInt = ipv4ToInt(base);
  const ipInt = ipv4ToInt(ip);
  if (baseInt == null || ipInt == null) return false;
  if (prefix === 0) return true;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (baseInt & mask) === (ipInt & mask);
}

function ipMatches(ip: string, cidrs: string[]): boolean {
  for (const c of cidrs) {
    if (c.includes(':')) {
      // Naïve IPv6 prefix match. Real implementations should normalise.
      const [base, prefixStr] = c.split('/');
      const prefix = parseInt(prefixStr ?? '128', 10);
      if (!Number.isFinite(prefix)) continue;
      // Compare prefix-many leading hex chars after lower-casing + canonical strip.
      const a = base.toLowerCase().replace(/::/g, ':');
      const b = ip.toLowerCase().replace(/::/g, ':');
      if (a.startsWith(b.slice(0, Math.floor(prefix / 4)))) return true;
      continue;
    }
    if (cidrMatchV4(ip, c)) return true;
  }
  return false;
}

interface PolicyRow { ipAllowlist: string[]; allowedCountries: string[] }
let cache: { at: number; map: Map<string, PolicyRow> } | undefined;
const CACHE_MS = 30_000;

async function policyForOrg(orgId: string): Promise<PolicyRow> {
  if (!cache || Date.now() - cache.at >= CACHE_MS) {
    const rows = await prisma.orgPolicy.findMany({
      select: { orgId: true, ipAllowlist: true, allowedCountries: true },
    });
    const map = new Map(rows.map((r) => [r.orgId, { ipAllowlist: r.ipAllowlist, allowedCountries: r.allowedCountries }]));
    cache = { at: Date.now(), map };
  }
  return cache.map.get(orgId) ?? { ipAllowlist: [], allowedCountries: [] };
}

/**
 * Country resolution. We avoid pulling in maxmind/maxmind-db at runtime;
 * the operator either points `MMDB_PATH` at their MaxMind GeoLite2-Country
 * MMDB file (we bring in `maxmind` lazily only if set) OR they leave it
 * unset and country enforcement is a no-op. This keeps the default image
 * tiny and respects "no telemetry phone-home" — we never auto-download.
 */
const MMDB_PATH = process.env.MMDB_PATH || '';
let mmdbReader: { get: (ip: string) => { country?: { iso_code?: string } } | null } | null = null;
let mmdbLogged = false;

async function ensureMmdbReader(): Promise<typeof mmdbReader> {
  if (!MMDB_PATH) {
    if (!mmdbLogged) { logger.debug('MMDB_PATH unset — country allowlist is a no-op'); mmdbLogged = true; }
    return null;
  }
  if (mmdbReader) return mmdbReader;
  try {
    await fs.access(MMDB_PATH);
    // Lazy require so the dep stays optional.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const maxmind = require('maxmind') as { open: <T>(path: string) => Promise<{ get: (ip: string) => T }> };
    mmdbReader = await maxmind.open<{ country?: { iso_code?: string } }>(MMDB_PATH);
    if (!mmdbLogged) { logger.info({ MMDB_PATH }, 'MMDB country reader loaded'); mmdbLogged = true; }
    return mmdbReader;
  } catch (err) {
    if (!mmdbLogged) {
      logger.warn({ err, MMDB_PATH }, 'MMDB load failed — country allowlist will be a no-op');
      mmdbLogged = true;
    }
    return null;
  }
}

async function lookupCountry(ip: string): Promise<string | null> {
  const reader = await ensureMmdbReader();
  if (!reader) return null;
  try {
    const row = reader.get(ip);
    return row?.country?.iso_code?.toUpperCase() ?? null;
  } catch {
    return null;
  }
}

export async function ipAllowlistMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Skip for unauthenticated routes; auth middleware later returns 401 if needed.
  if (!req.user) return next();
  if (req.path === '/health' || req.path === '/health/deep' || req.path === '/api/csrf') return next();

  try {
    const policy = await policyForOrg(req.user.orgId);
    const ip = req.ip ?? '';

    // CIDR check — only enforced when the allowlist is non-empty.
    if (policy.ipAllowlist.length > 0 && !ipMatches(ip, policy.ipAllowlist)) {
      await writeAudit({
        orgId: req.user.orgId,
        actorId: req.user.userId,
        action: 'auth.ip.blocked',
        targetType: 'request',
        targetId: req.path,
        ip,
      });
      res.status(403).json({ error: 'IP not allowed by your org policy', requestId: req.id });
      return;
    }

    // Country check — only enforced when allowedCountries is non-empty AND
    // we have a working MMDB reader. Loopback + RFC1918 are exempt
    // (resolution returns null; we'd otherwise block all dev traffic).
    if (policy.allowedCountries.length > 0) {
      const country = await lookupCountry(ip);
      if (country && !policy.allowedCountries.includes(country)) {
        await writeAudit({
          orgId: req.user.orgId,
          actorId: req.user.userId,
          action: 'auth.country.blocked',
          targetType: 'request',
          targetId: req.path,
          ip,
          metadata: { country, allowed: policy.allowedCountries },
        });
        res.status(403).json({ error: `Country ${country} not allowed by your org policy`, requestId: req.id });
        return;
      }
    }

    next();
  } catch (err) {
    logger.warn({ err }, 'ipAllowlist evaluation failed; allowing through');
    next();
  }
}
