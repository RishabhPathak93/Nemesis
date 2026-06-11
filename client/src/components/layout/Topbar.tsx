import { useAuthStore } from '@/store/auth';
import { useThemeStore } from '@/store/theme';
import { Button } from '@/components/ui/button';
import { LogOut, Menu, Moon, Sun } from 'lucide-react';

interface TopbarProps {
  onOpenMenu: () => void;
}

export function Topbar({ onOpenMenu }: TopbarProps) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const resolved = useThemeStore((s) => s.resolved);
  const toggleTheme = useThemeStore((s) => s.toggle);

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b bg-card px-4 md:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMenu}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground md:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="text-sm text-muted-foreground">{user?.orgName}</div>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <div className="text-sm font-medium text-foreground">{user?.name}</div>
          <div className="text-xs text-muted-foreground">{user?.email}</div>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
          {user?.name?.[0]?.toUpperCase() || '?'}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          title={resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle dark mode"
        >
          {resolved === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="icon" onClick={logout} title="Sign out" aria-label="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
