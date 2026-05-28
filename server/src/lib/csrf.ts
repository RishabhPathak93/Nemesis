import { doubleCsrf } from 'csrf-csrf';
import { env } from './env';
import type { Request, Response, NextFunction } from 'express';

/**
 * Double-submit CSRF cookie. Active only when the request authenticates via
 * cookie (i.e. `req.cookies?.token` is set). Bearer-token and X-API-Key clients
 * carry their own out-of-band proof of origin, so they're skipped via
 * csrf-csrf's built-in skipCsrfProtection hook.
 *
 * Wire order:
 *   GET  /api/csrf  → mints + returns the token (and sets the signed cookie)
 *   middleware     → checks `X-CSRF-Token` against cookie on POST/PUT/PATCH/DELETE
 */
const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => env.jwtSecret, // re-uses JWT secret as HMAC seed
  getSessionIdentifier: (req: Request) => req.user?.userId ?? req.ip ?? 'anonymous',
  cookieName: 'cv_csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.cookieSecure,
    path: '/',
  },
  size: 32,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getTokenFromRequest: (req: Request) => {
    const header = req.headers['x-csrf-token'];
    return Array.isArray(header) ? header[0] : header;
  },
  skipCsrfProtection: (req: Request) => {
    const usesBearer = typeof req.headers.authorization === 'string'
      && req.headers.authorization.startsWith('Bearer ');
    const usesApiKey = !!req.headers['x-api-key'];
    const usesCookieAuth = !!req.cookies?.token;
    // Skip if not cookie-authed; let downstream auth middleware handle it.
    if (!usesCookieAuth || usesBearer || usesApiKey) return true;
    // Skip CSRF for the SAML ACS endpoint (it carries a signed SAMLResponse).
    if (req.path.startsWith('/api/auth/saml/') && req.path.endsWith('/acs')) return true;
    return false;
  },
});

/** Mint + return a token. Sets the signed cookie as a side effect. */
export function csrfTokenIssuer(req: Request, res: Response): void {
  const token = generateToken(req, res);
  res.json({ token });
}

export const csrfMiddleware = doubleCsrfProtection;

export { generateToken as generateCsrfToken };
