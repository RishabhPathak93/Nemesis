import { Issuer, generators, type Client } from 'openid-client';
import { prisma } from './prisma';
import { decrypt } from './crypto';
import { env } from './env';

/**
 * Per-org OIDC SP wrapper. Discovery is cached for 1h to avoid hitting the
 * IdP's well-known endpoint on every login. Each orgSlug maps to its
 * `OidcConfig` row; the resulting Client is built fresh-ish so cert/issuer
 * rotations propagate within the cache TTL.
 */

const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  at: number;
  client: Client;
}
const cache = new Map<string, CacheEntry>();

export function spRedirectUri(orgSlug: string): string {
  return `${env.clientOrigin}/api/auth/oidc/${orgSlug}/callback`;
}

export async function loadOidcClient(orgSlug: string): Promise<{ client: Client; cfg: { clientId: string; clientSecret: string; issuerUrl: string; scopes: string[]; jitProvision: boolean; defaultRole: string; emailDomains: string[]; claimEmail: string; claimName: string; orgId: string; oidcConfigId: string } } | null> {
  const cfg = await prisma.oidcConfig.findFirst({
    where: { orgId: orgSlug, enabled: true },
  });
  if (!cfg) return null;

  const cached = cache.get(orgSlug);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return {
      client: cached.client,
      cfg: {
        clientId: cfg.clientId,
        clientSecret: decrypt(cfg.clientSecret),
        issuerUrl: cfg.issuerUrl,
        scopes: cfg.scopes,
        jitProvision: cfg.jitProvision,
        defaultRole: cfg.defaultRole,
        emailDomains: cfg.emailDomains,
        claimEmail: cfg.claimEmail,
        claimName: cfg.claimName,
        orgId: cfg.orgId,
        oidcConfigId: cfg.id,
      },
    };
  }

  const issuer = await Issuer.discover(cfg.issuerUrl);
  const client = new issuer.Client({
    client_id: cfg.clientId,
    client_secret: decrypt(cfg.clientSecret),
    redirect_uris: [spRedirectUri(orgSlug)],
    response_types: ['code'],
  });
  cache.set(orgSlug, { at: Date.now(), client });
  return {
    client,
    cfg: {
      clientId: cfg.clientId,
      clientSecret: decrypt(cfg.clientSecret),
      issuerUrl: cfg.issuerUrl,
      scopes: cfg.scopes,
      jitProvision: cfg.jitProvision,
      defaultRole: cfg.defaultRole,
      emailDomains: cfg.emailDomains,
      claimEmail: cfg.claimEmail,
      claimName: cfg.claimName,
      orgId: cfg.orgId,
      oidcConfigId: cfg.id,
    },
  };
}

export async function findOrgWithOidcByEmail(email: string): Promise<{ orgId: string; orgSlug: string } | null> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  const cfg = await prisma.oidcConfig.findFirst({
    where: { enabled: true, emailDomains: { has: domain } },
    select: { orgId: true },
  });
  return cfg ? { orgId: cfg.orgId, orgSlug: cfg.orgId } : null;
}

export function generatePkce(): { codeVerifier: string; codeChallenge: string; nonce: string } {
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  const nonce = generators.nonce();
  return { codeVerifier, codeChallenge, nonce };
}
