/// <reference types="vite/client" />

/**
 * Single source of truth for the API base URL. Centralised so a production
 * build can't accidentally ship pointing at localhost.
 *
 * - Dev / unset: falls back to http://localhost:3001 (the local server).
 * - Explicit empty string: "same-origin". The client is served behind a
 *   reverse proxy (nginx in the production image) that forwards /api to the
 *   server, so the base becomes the relative "/api". This is the default for
 *   the Docker build, which passes VITE_API_BASE_URL="".
 * - Prod (`import.meta.env.PROD === true`) with the var genuinely *undefined*:
 *   throw at module load so the misconfiguration surfaces immediately instead
 *   of producing silent localhost requests in the bundle.
 */
function resolveServerOrigin(): string {
  const fromEnv = import.meta.env.VITE_API_BASE_URL;
  if (fromEnv) return fromEnv;
  // Distinguish "set to empty on purpose" (same-origin proxy) from "unset".
  if (fromEnv === '') return '';
  if (import.meta.env.PROD) {
    throw new Error(
      'VITE_API_BASE_URL must be set at build time for production. ' +
      'Set it in your .env.production or pass it to the build command.',
    );
  }
  return 'http://localhost:3001';
}

export const SERVER_ORIGIN = resolveServerOrigin();
export const API_BASE_URL = SERVER_ORIGIN + '/api';
