import { SAML, generateServiceProviderMetadata } from '@node-saml/node-saml';
import { prisma } from './prisma';
import { env } from './env';
import { logger } from './logger';

/**
 * SAML 2.0 SP wrapper around @node-saml/node-saml.
 *
 * Per-org config lives in `SamlConfig`. We construct a fresh SAML instance
 * per request (cheap; just options object) since orgs may rotate IdP certs.
 *
 * Anti-replay: every successfully validated assertion ID lands in
 * `SamlAssertionSeen`; a duplicate ID is rejected.
 */

export function spEntityId(orgSlug: string): string {
  return `${env.clientOrigin}/api/auth/saml/${orgSlug}`;
}

export function spAcsUrl(orgSlug: string): string {
  return `${env.clientOrigin}/api/auth/saml/${orgSlug}/acs`;
}

interface OrgSamlContext {
  orgId: string;
  orgSlug: string;
  config: {
    idpEntityId: string;
    idpSsoUrl: string;
    idpCertificate: string;
    idpCertificate2: string | null;
    spEntityId: string;
    spAcsUrl: string;
  };
}

export function buildSamlClient(ctx: OrgSamlContext): SAML {
  const certs = [ctx.config.idpCertificate, ctx.config.idpCertificate2].filter(
    (c): c is string => !!c && c.length > 0,
  );
  return new SAML({
    issuer: ctx.config.spEntityId,
    callbackUrl: ctx.config.spAcsUrl,
    entryPoint: ctx.config.idpSsoUrl,
    idpIssuer: ctx.config.idpEntityId,
    idpCert: certs.length === 1 ? certs[0] : certs,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    signatureAlgorithm: 'sha256',
    digestAlgorithm: 'sha256',
    // NEM-2026-014: enforce InResponseTo validation so an IdP-signed assertion
    // can only land at the AuthnRequest it was minted for. The library tracks
    // outbound request IDs by default; we set a conservative 5 min expiry.
    validateInResponseTo: 'always' as never,
    requestIdExpirationPeriodMs: 5 * 60 * 1000,
    disableRequestedAuthnContext: true,
  });
}

export function spMetadataXml(orgSlug: string): string {
  return generateServiceProviderMetadata({
    issuer: spEntityId(orgSlug),
    callbackUrl: spAcsUrl(orgSlug),
    wantAssertionsSigned: true,
    decryptionCert: null,
    publicCerts: null,
  } as never);
}

/** Resolve an org for SAML by either path slug (we use orgId) or by email-domain match. */
export async function findOrgWithSamlByEmail(email: string): Promise<{ orgId: string; orgSlug: string } | null> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  const cfg = await prisma.samlConfig.findFirst({
    where: { enabled: true, emailDomains: { has: domain } },
    select: { orgId: true },
  });
  return cfg ? { orgId: cfg.orgId, orgSlug: cfg.orgId } : null;
}

export async function loadSamlContext(orgSlug: string): Promise<OrgSamlContext | null> {
  const cfg = await prisma.samlConfig.findFirst({
    where: { orgId: orgSlug, enabled: true },
  });
  if (!cfg) return null;
  return {
    orgId: cfg.orgId,
    orgSlug: cfg.orgId,
    config: {
      idpEntityId: cfg.idpEntityId,
      idpSsoUrl: cfg.idpSsoUrl,
      idpCertificate: cfg.idpCertificate,
      idpCertificate2: cfg.idpCertificate2,
      spEntityId: cfg.spEntityId,
      spAcsUrl: cfg.spAcsUrl,
    },
  };
}

export async function recordAssertionSeen(orgId: string, assertionId: string, notOnOrAfter: Date): Promise<void> {
  try {
    await prisma.samlAssertionSeen.create({
      data: { orgId, assertionId, notOnOrAfter },
    });
  } catch (err) {
    // Unique-constraint violation = replay; rethrow so caller can reject.
    logger.warn({ err, assertionId, orgId }, 'SAML assertion replay or duplicate');
    throw new Error('SAML assertion replay');
  }
}
