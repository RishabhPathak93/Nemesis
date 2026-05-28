import { env } from './env';

/**
 * Open-redirect defense for post-SSO redirects (SAML RelayState, OIDC
 * `redirectAfter`). Mitigates NEM-2026-002.
 *
 * Inputs come from attacker-controlled SAML / OIDC params. We accept ONLY
 * same-origin paths; anything that resolves to a different origin (or any
 * malformed input) falls back to `/dashboard`.
 *
 * Tokens MUST be set as cookies on the redirect response, not appended to
 * the URL query string — see callers.
 */

function allowedOrigin(): string {
  try {
    return new URL(env.clientOrigin).origin;
  } catch {
    return '';
  }
}

/**
 * Returns a guaranteed same-origin path (without origin prefix). Always starts
 * with '/' and never contains a protocol-relative '//'.
 */
export function safeRelativePath(input: string | null | undefined): string {
  const FALLBACK = '/dashboard';
  if (!input || typeof input !== 'string') return FALLBACK;

  const trimmed = input.trim();
  if (!trimmed) return FALLBACK;

  // Protocol-relative ('//evil.example/x') is the classic open-redirect trap.
  if (trimmed.startsWith('//')) return FALLBACK;

  // Same-origin absolute paths are fine.
  if (trimmed.startsWith('/')) {
    // But strip any embedded `\` (curl / browsers can normalise backslashes).
    if (trimmed.includes('\\')) return FALLBACK;
    return trimmed;
  }

  // Absolute URL: accept only if origin matches CLIENT_ORIGIN exactly.
  try {
    const u = new URL(trimmed);
    if (u.origin === allowedOrigin()) {
      return u.pathname + u.search + u.hash;
    }
  } catch {
    /* fall through to fallback */
  }
  return FALLBACK;
}

/**
 * Build an absolute redirect URL anchored to the configured CLIENT_ORIGIN.
 * Use this in SAML/OIDC ACS handlers instead of `new URL(...attackerInput...)`.
 */
export function buildSafeRedirectUrl(input: string | null | undefined): URL {
  return new URL(safeRelativePath(input), env.clientOrigin);
}
