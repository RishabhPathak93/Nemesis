import axios from 'axios';
import { api } from './api';
import { API_BASE_URL } from './baseUrl';

const baseURL = API_BASE_URL;

let cachedToken: string | null = null;
let inFlight: Promise<string | null> | null = null;

async function fetchToken(): Promise<string | null> {
  try {
    const { data } = await axios.get<{ token: string }>(`${baseURL}/csrf`, {
      withCredentials: true,
    });
    cachedToken = data.token;
    return cachedToken;
  } catch {
    return null;
  }
}

/** Lazily fetch + cache a CSRF token; coalesce concurrent fetches. */
export async function ensureCsrfToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  if (!inFlight) inFlight = fetchToken().finally(() => { inFlight = null; });
  return inFlight;
}

/** Drop the cached token — call after a 403 response so the next request re-mints. */
export function invalidateCsrfToken(): void {
  cachedToken = null;
}

const CSRF_METHODS = new Set(['post', 'put', 'patch', 'delete']);

export function attachCsrfInterceptor(): void {
  api.interceptors.request.use(async (config) => {
    const method = (config.method ?? 'get').toLowerCase();
    if (!CSRF_METHODS.has(method)) return config;
    // NEM-2026-017: always attach the CSRF token, even when a Bearer/Authorization
    // header is present. The server's CSRF middleware skips its own check for
    // pure-bearer flows, but defence-in-depth costs nothing here and protects
    // any endpoint that accepts either cookie or bearer auth.
    const token = await ensureCsrfToken();
    if (token) {
      config.headers = config.headers ?? {};
      config.headers['X-CSRF-Token'] = token;
    }
    return config;
  });

  api.interceptors.response.use(
    (r) => r,
    (err) => {
      // If we hit a CSRF-shaped 403, drop the cache so the next attempt remints.
      const status = err?.response?.status;
      const code = err?.response?.data?.code;
      if (status === 403 && (code === 'EBADCSRFTOKEN' || code === 'ECSRFTOKEN')) {
        invalidateCsrfToken();
      }
      return Promise.reject(err);
    },
  );
}
