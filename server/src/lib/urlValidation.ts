import dns from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import net from 'node:net';
import https from 'node:https';

/**
 * SSRF defense for outbound HTTP requests. Used by the agent connector,
 * webhook delivery worker, dataset fetchers, and any other place we POST
 * to a customer-supplied URL.
 *
 * Mitigates NEM-2026-001 (Agent endpoint SSRF) and NEM-2026-006 (webhook SSRF).
 *
 * Two layers:
 *   1. `assertPublicHttpsUrl(url)` — call at create-time on a user-supplied URL.
 *      Rejects non-HTTPS, URLs with embedded credentials, and any hostname
 *      that resolves to a private / loopback / link-local IP.
 *   2. `safeHttpsAgent()` — a shared `https.Agent` with `rejectUnauthorized: true`
 *      pinned explicitly so a stray `NODE_TLS_REJECT_UNAUTHORIZED=0` env doesn't
 *      silently weaken outbound calls (NEM-2026-024).
 *
 * DNS-rebinding note: hostnames are re-validated AT REQUEST TIME, not just at
 * create-time. A hostname that resolved to a public IP last week may resolve
 * to 169.254.169.254 today.
 */

const BLOCK_V4 = [
  /^0\./,                                  // current network
  /^10\./,                                 // RFC1918
  /^127\./,                                // loopback
  /^169\.254\./,                           // link-local (incl. cloud metadata)
  /^172\.(1[6-9]|2[0-9]|3[01])\./,         // RFC1918
  /^192\.0\.0\./,                          // IANA special
  /^192\.0\.2\./,                          // TEST-NET-1
  /^192\.168\./,                           // RFC1918
  /^198\.1[89]\./,                         // benchmarking
  /^198\.51\.100\./,                       // TEST-NET-2
  /^203\.0\.113\./,                        // TEST-NET-3
  /^22[4-9]\./, /^2[34][0-9]\./,           // multicast + reserved
  /^255\.255\.255\.255$/,                  // broadcast
];

const BLOCK_V6 = [
  /^::1$/i,                                // loopback
  /^::$/i,                                 // unspecified
  /^fe80:/i,                               // link-local
  /^fc/i, /^fd/i,                          // unique local
  /^::ffff:/i,                             // IPv4-mapped (could embed 127.x etc.)
];

function isBlockedIp(addr: string): boolean {
  if (net.isIPv4(addr)) return BLOCK_V4.some((re) => re.test(addr));
  if (net.isIPv6(addr)) return BLOCK_V6.some((re) => re.test(addr));
  return true; // unknown family — fail closed
}

export interface UrlValidationOptions {
  /** Require HTTPS. Default true. Set false only for non-prod test setups. */
  requireHttps?: boolean;
  /** Skip DNS resolution. Default false. Set true for unit tests that don't have network. */
  skipDns?: boolean;
}

/**
 * Throws if the URL is unsuitable for an outbound request. Call this both at
 * the create boundary (e.g. when a user submits an agent / webhook URL) AND
 * at the send boundary (DNS-rebinding defense).
 */
export async function assertPublicHttpsUrl(
  raw: string,
  opts: UrlValidationOptions = {},
): Promise<void> {
  const requireHttps = opts.requireHttps ?? true;

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }

  if (requireHttps && u.protocol !== 'https:') {
    throw new Error('Only https:// URLs are allowed');
  }
  if (!requireHttps && u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error('URL must use http:// or https://');
  }
  if (u.username || u.password) {
    throw new Error('URL must not contain credentials');
  }

  const host = u.hostname.toLowerCase();
  if (!host) throw new Error('URL is missing a hostname');

  // Block hostname-form loopback / metadata aliases.
  if (host === 'localhost' || host === 'localhost.localdomain') {
    throw new Error('Loopback hostnames are not allowed');
  }
  if (host === 'metadata.google.internal' || host === 'metadata') {
    throw new Error('Cloud metadata hostnames are not allowed');
  }

  // If the URL has a literal IP, validate directly.
  if (net.isIP(host)) {
    if (isBlockedIp(host)) {
      throw new Error('Private/loopback/link-local IPs are not allowed');
    }
    return;
  }

  if (opts.skipDns) return;

  // Resolve and check every address. We require ALL resolved addresses to be
  // public — a rebinding-friendly host that returns one public and one private
  // address is still rejected.
  let records: LookupAddress[];
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`Could not resolve hostname: ${host}`);
  }
  if (records.length === 0) {
    throw new Error(`Hostname did not resolve: ${host}`);
  }
  for (const r of records) {
    if (isBlockedIp(r.address)) {
      throw new Error(
        `Hostname ${host} resolves to a private/loopback address (${r.address})`,
      );
    }
  }
}

const METADATA_HOSTS = new Set(['metadata', 'metadata.google.internal']);

/**
 * Even in the relaxed dev mode we never allow cloud-metadata / link-local
 * targets (169.254.0.0/16, fe80::/10) — the instance metadata service is the
 * highest-value SSRF target. Private/loopback (127.x, 192.168.x, host gateway)
 * are permitted here so local Ollama / mock agents work.
 */
async function assertNotCloudMetadata(raw: string): Promise<void> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('Invalid URL'); }
  const host = u.hostname.toLowerCase();
  if (METADATA_HOSTS.has(host)) throw new Error('Cloud metadata hostnames are not allowed');
  const check = (addr: string): void => {
    // Normalize an IPv4-mapped IPv6 literal (e.g. ::ffff:169.254.169.254) so the
    // metadata range can't be smuggled past the IPv4 regex in v6 form.
    const v4 = addr.toLowerCase().replace(/^::ffff:/, '');
    if (net.isIPv4(v4) && /^169\.254\./.test(v4)) throw new Error('Link-local/metadata IPs are not allowed');
    if (net.isIPv6(addr) && (/^fe80:/i.test(addr) || /^::ffff:a9fe:/i.test(addr))) {
      throw new Error('Link-local IPs are not allowed');
    }
  };
  if (net.isIP(host)) { check(host); return; }
  try {
    const records = await dns.lookup(host, { all: true });
    for (const r of records) check(r.address);
  } catch { /* DNS failure surfaces when the request itself fires */ }
}

/**
 * SSRF gate. Used everywhere we accept a customer-supplied outbound URL (agent
 * endpoints, webhook URLs, dataset fetchers, web research, etc.).
 *
 * H-02 fix: FAIL-CLOSED. Validates in every environment by default; the only
 * relaxation is the explicit `ALLOW_PRIVATE_OUTBOUND_URLS=true` opt-in for local
 * development. This is never keyed on NODE_ENV (which was fail-open on any
 * misconfiguration — unset/typo/`staging` silently disabled all SSRF defense).
 * Even when relaxed, cloud-metadata / link-local remain blocked.
 */
export async function assertOutboundUrlAllowed(raw: string): Promise<void> {
  if ((process.env.ALLOW_PRIVATE_OUTBOUND_URLS ?? '').toLowerCase() === 'true') {
    await assertNotCloudMetadata(raw);
    return;
  }
  await assertPublicHttpsUrl(raw);
}

/** Convenience helper for Zod refinements. Returns true if valid, false otherwise. */
export function isPublicHttpsUrl(raw: string): boolean {
  // Synchronous fast-path used by Zod refinements where DNS is not awaited.
  // Real validation MUST also run async assertPublicHttpsUrl before the request fires.
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    if (u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    if (!host) return false;
    if (host === 'localhost') return false;
    if (host === 'metadata.google.internal' || host === 'metadata') return false;
    if (net.isIP(host)) return !isBlockedIp(host);
    return true;
  } catch {
    return false;
  }
}

/**
 * Shared HTTPS agent for outbound requests. Pins `rejectUnauthorized: true`
 * explicitly so a misconfigured env (e.g. `NODE_TLS_REJECT_UNAUTHORIZED=0`)
 * does not silently weaken cert validation. Disables redirect-following at
 * the agent level — callers that need redirects must opt-in explicitly and
 * re-validate the redirect target through `assertPublicHttpsUrl`.
 */
let _agent: https.Agent | undefined;
export function safeHttpsAgent(): https.Agent {
  if (!_agent) {
    _agent = new https.Agent({
      rejectUnauthorized: true,
      keepAlive: true,
    });
  }
  return _agent;
}
