import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from './baseUrl';

const baseURL = API_BASE_URL;

export const api = axios.create({
  baseURL,
  withCredentials: true,
});

const ACCESS_KEY = 'cv_token';
const REFRESH_KEY = 'cv_refresh';

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(ACCESS_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

interface RetryConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

let refreshPromise: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return null;
  try {
    const { data } = await axios.post<{ accessToken: string; refreshToken: string }>(
      `${baseURL}/auth/refresh`,
      { refreshToken },
    );
    localStorage.setItem(ACCESS_KEY, data.accessToken);
    localStorage.setItem(REFRESH_KEY, data.refreshToken);
    return data.accessToken;
  } catch {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    return null;
  }
}

api.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    const cfg = err.config as RetryConfig | undefined;
    const status = err.response?.status;
    const isAuthEndpoint =
      cfg?.url?.includes('/auth/login') ||
      cfg?.url?.includes('/auth/refresh') ||
      cfg?.url?.includes('/auth/signup');

    if (status === 401 && cfg && !cfg._retried && !isAuthEndpoint) {
      cfg._retried = true;
      // Coalesce concurrent refreshes — only one outbound /auth/refresh at a time.
      if (!refreshPromise) refreshPromise = performRefresh().finally(() => { refreshPromise = null; });
      const newToken = await refreshPromise;
      if (newToken) {
        cfg.headers = cfg.headers ?? {};
        cfg.headers.Authorization = `Bearer ${newToken}`;
        return api.request(cfg);
      }
      // Refresh failed — bounce to login.
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  },
);

export function apiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return err.response?.data?.error || err.message;
  }
  return err instanceof Error ? err.message : 'Unknown error';
}
