import jwt, { type Algorithm } from 'jsonwebtoken';
import { env } from './env';

/**
 * Access token = short-lived (15 min) JWT bearing the user identity + a
 * `tokenVersion` counter that we bump on password change / forced logout to
 * invalidate every live access token at once.
 *
 * Refresh tokens are opaque random strings (NOT JWTs), hashed in the
 * RefreshToken table — see lib/tokens.ts.
 *
 * Hardened per NEM-2026-005 / NEM-2026-013:
 *  - Algorithm pinned to HS256 on both sign + verify (defends against
 *    `alg:none` and RSA→HMAC algorithm-confusion attacks).
 *  - Audience + issuer claims set + enforced.
 */

export interface JwtPayload {
  userId: string;
  orgId: string;
  role: string;
  tokenVersion: number;
}

const ACCESS_TTL = '15m';
const ALG: Algorithm = 'HS256';
const AUD = 'nemesis-ai-api';
const ISS = 'nemesis-ai';

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.jwtSecret, {
    algorithm: ALG,
    audience: AUD,
    issuer: ISS,
    expiresIn: ACCESS_TTL,
  });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret, {
    algorithms: [ALG],
    audience: AUD,
    issuer: ISS,
  }) as JwtPayload;
}

/**
 * Short-lived HMAC-signed wrapper used to bridge the username/password step
 * and the MFA step of login. Carries no privileges of its own — only proves
 * the user passed the password check.
 */
const MFA_SESSION_TTL = '5m';
const MFA_AUD = 'nemesis-ai-mfa';
export interface MfaSessionPayload {
  userId: string;
  purpose: 'mfa-login';
}
export function signMfaSession(userId: string): string {
  return jwt.sign({ userId, purpose: 'mfa-login' } satisfies MfaSessionPayload, env.jwtSecret, {
    algorithm: ALG,
    audience: MFA_AUD,
    issuer: ISS,
    expiresIn: MFA_SESSION_TTL,
  });
}
export function verifyMfaSession(token: string): MfaSessionPayload {
  const payload = jwt.verify(token, env.jwtSecret, {
    algorithms: [ALG],
    audience: MFA_AUD,
    issuer: ISS,
  }) as MfaSessionPayload;
  if (payload.purpose !== 'mfa-login') throw new Error('wrong purpose');
  return payload;
}

// Backward-compat aliases — some legacy code may import these.
// New code should use signAccessToken / verifyAccessToken directly.
export const signToken = signAccessToken;
export const verifyToken = verifyAccessToken;
