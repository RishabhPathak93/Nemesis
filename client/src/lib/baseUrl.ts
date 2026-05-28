/// <reference types="vite/client" />

/**
 * Single source of truth for the API base URL. Centralised so a production
 * build can't accidentally ship pointing at localhost.
 *
 * - Dev / unset: falls back to http://localhost:3001 (the local server).
 * - Prod (`import.meta.env.PROD === true`): the env var MUST be set or we
 *   throw at module load so it surfaces immediately instead of producing
 *   silent localhost requests in the bundle.
 */
function resolveServerOrigin(): string {
  const fromEnv = import.meta.env.VITE_API_BASE_URL;
  if (fromEnv) return fromEnv;
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
