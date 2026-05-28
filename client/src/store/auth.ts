import { create } from 'zustand';
import { api } from '@/lib/api';
import type { User } from '@/types';

interface LoginResultOk {
  kind: 'ok';
  user: User;
}
interface LoginResultMfa {
  kind: 'mfa';
  mfaSessionToken: string;
}
type LoginResult = LoginResultOk | LoginResultMfa;

interface AuthState {
  user: User | null;
  loading: boolean;
  initialized: boolean;
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyMfa: (mfaSessionToken: string, code: string, isBackupCode?: boolean) => Promise<void>;
  signup: (email: string, password: string, name: string, orgName: string) => Promise<void>;
  setSession: (accessToken: string, refreshToken: string, user: User) => void;
  refresh: () => Promise<string | null>;
  logout: () => Promise<void>;
}

const ACCESS_KEY = 'cv_token';
const REFRESH_KEY = 'cv_refresh';

function setTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

interface AuthResponse {
  token: string;
  accessToken: string;
  refreshToken: string;
  user: User;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: false,
  initialized: false,
  async init() {
    const token = localStorage.getItem(ACCESS_KEY);
    if (!token) {
      set({ initialized: true });
      return;
    }
    try {
      const { data } = await api.get<User>('/auth/me');
      set({ user: data, initialized: true });
    } catch {
      // Try refresh once before giving up.
      const refreshed = await get().refresh();
      if (refreshed) {
        try {
          const { data } = await api.get<User>('/auth/me');
          set({ user: data, initialized: true });
          return;
        } catch {
          /* fall through */
        }
      }
      clearTokens();
      set({ user: null, initialized: true });
    }
  },
  async login(email, password) {
    set({ loading: true });
    try {
      const { data } = await api.post<
        AuthResponse | { requiresMfa: true; mfaSessionToken: string }
      >('/auth/login', { email, password });
      if ('requiresMfa' in data) {
        return { kind: 'mfa', mfaSessionToken: data.mfaSessionToken };
      }
      setTokens(data.accessToken, data.refreshToken);
      set({ user: data.user });
      return { kind: 'ok', user: data.user };
    } finally {
      set({ loading: false });
    }
  },
  async verifyMfa(mfaSessionToken, code, isBackupCode) {
    set({ loading: true });
    try {
      const { data } = await api.post<AuthResponse>('/auth/verify-mfa', {
        mfaSessionToken, code, isBackupCode: !!isBackupCode,
      });
      setTokens(data.accessToken, data.refreshToken);
      set({ user: data.user });
    } finally {
      set({ loading: false });
    }
  },
  async signup(email, password, name, orgName) {
    set({ loading: true });
    try {
      const { data } = await api.post<AuthResponse>('/auth/signup', {
        email, password, name, orgName,
      });
      setTokens(data.accessToken, data.refreshToken);
      set({ user: data.user });
    } finally {
      set({ loading: false });
    }
  },
  setSession(accessToken, refreshToken, user) {
    setTokens(accessToken, refreshToken);
    set({ user });
  },
  async refresh() {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return null;
    try {
      const { data } = await api.post<{ accessToken: string; refreshToken: string }>(
        '/auth/refresh',
        { refreshToken },
      );
      setTokens(data.accessToken, data.refreshToken);
      return data.accessToken;
    } catch {
      clearTokens();
      return null;
    }
  },
  async logout() {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    try {
      await api.post('/auth/logout', refreshToken ? { refreshToken } : {});
    } catch {
      /* best-effort */
    }
    clearTokens();
    set({ user: null });
  },
}));
