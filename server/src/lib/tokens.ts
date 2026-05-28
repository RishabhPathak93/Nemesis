import { randomBytes, createHash } from 'crypto';

/**
 * Token lifecycle helpers. Plaintext tokens are NEVER stored — only their
 * sha256 hash. The plaintext goes out exactly once (in the response body for
 * API keys, in the email link for password resets / invites / verification).
 */

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 32-byte random URL-safe token. ~43 chars. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Refresh-token family ID — opaque, used to revoke a chain on replay. */
export function generateFamilyId(): string {
  return randomBytes(12).toString('base64url');
}

/** API-key plaintext: prefix + opaque suffix. The full string is shown to
 *  the user exactly once on creation and never again. */
const API_KEY_PREFIX = 'cv_live_';

export function generateApiKey(): { full: string; prefix: string; hash: string } {
  const suffix = randomBytes(32).toString('base64url');
  const full = `${API_KEY_PREFIX}${suffix}`;
  return {
    full,
    prefix: full.slice(0, 16),
    hash: sha256(full),
  };
}

export function isApiKey(s: string): boolean {
  return s.startsWith(API_KEY_PREFIX) && s.length >= 32;
}

/** Constant-time string compare to avoid timing leaks on hash lookups. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * Constant-time string compare for arbitrary UTF-8 strings. Used by
 * health/metrics token gates (NEM-2026-009). Returns false on any
 * length mismatch, which is a deliberate fast path — the caller is
 * comparing against a server-controlled secret of fixed length so
 * length-leak isn't a meaningful concern here.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a ?? '', 'utf8');
  const bb = Buffer.from(b ?? '', 'utf8');
  if (ab.length !== bb.length) return false;
  let r = 0;
  for (let i = 0; i < ab.length; i++) r |= ab[i] ^ bb[i];
  return r === 0;
}
