import { create } from 'zustand';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'nemesis-theme';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

/** The concrete theme to paint, resolving 'system' against the OS setting. */
export function resolveTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme;
}

/** Toggle the `.dark` class on <html> so Tailwind's dark: variants + the CSS
 *  variable overrides in index.css take effect. */
function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const isDark = resolveTheme(theme) === 'dark';
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
}

function readStored(): Theme {
  if (typeof localStorage === 'undefined') return 'system';
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

interface ThemeState {
  theme: Theme;
  /** Concrete light/dark currently painted — handy for icon state. */
  resolved: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  /** Flip between light and dark explicitly (pins the choice). */
  toggle: () => void;
}

const initial = readStored();

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initial,
  resolved: resolveTheme(initial),
  setTheme: (theme) => {
    localStorage.setItem(STORAGE_KEY, theme);
    applyTheme(theme);
    set({ theme, resolved: resolveTheme(theme) });
  },
  toggle: () => {
    const next = get().resolved === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },
}));

/** Apply the stored theme on load and keep 'system' in sync with the OS. Called
 *  once from main.tsx. The inline script in index.html already painted the
 *  correct class pre-hydration to avoid a flash; this re-asserts + wires the
 *  media-query listener. */
export function initTheme(): void {
  applyTheme(readStored());
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { theme, setTheme } = useThemeStore.getState();
    if (theme === 'system') setTheme('system'); // re-resolve against new OS value
  });
}
