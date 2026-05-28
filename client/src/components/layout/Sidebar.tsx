import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Bot, FileText, Settings, Brain, KeyRound, ScrollText,
  Lock, Library, Grid3x3, Webhook, Bell, Calendar, Scale, Database, Beaker, Layers, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import pkg from '../../../package.json';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/security-engine/probes', label: 'Probe library', icon: Library },
  { to: '/security-engine/verticals', label: 'Verticals', icon: Layers },
  { to: '/security-engine/datasets', label: 'Datasets', icon: Database },
  { to: '/security-engine/dry-run', label: 'Dry-run', icon: Beaker },
  { to: '/security-engine/compliance', label: 'Compliance heatmap', icon: Grid3x3 },
  { to: '/knowledge', label: 'Learned & research', icon: Brain },
];

const adminNav: NavItem[] = [
  { to: '/security', label: 'Security', icon: Lock },
  { to: '/webhooks', label: 'Webhooks', icon: Webhook, adminOnly: true },
  { to: '/notifications', label: 'Notifications', icon: Bell, adminOnly: true },
  { to: '/scheduled-reports', label: 'Scheduled reports', icon: Calendar },
  { to: '/compliance', label: 'Compliance', icon: Scale, adminOnly: true },
  { to: '/api-keys', label: 'API keys', icon: KeyRound, adminOnly: true },
  { to: '/audit', label: 'Audit log', icon: ScrollText, adminOnly: true },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function NavItemRow({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'mt-1 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          isActive ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white',
        )
      }
    >
      <item.icon className="h-4 w-4" />
      {item.label}
    </NavLink>
  );
}

interface NavBodyProps {
  isAdmin: boolean;
  onNavigate?: () => void;
}
function NavBody({ isAdmin, onNavigate }: NavBodyProps) {
  return (
    <>
      <nav className="flex-1 px-3 py-2">
        {navItems.map((item) => <NavItemRow key={item.to} item={item} onNavigate={onNavigate} />)}
        <div className="mt-4 px-3 text-xs uppercase tracking-wider text-slate-500">Admin</div>
        {adminNav
          .filter((i) => !i.adminOnly || isAdmin)
          .map((item) => <NavItemRow key={item.to} item={item} onNavigate={onNavigate} />)}
      </nav>
      <div className="px-6 py-4 text-xs text-slate-500">
        v{pkg.version} · AI Security Testing
      </div>
    </>
  );
}

function NavBrand({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex items-center gap-2 px-6 py-5">
      <img src="/logos/reticle.svg" alt="" className="h-8 w-8" />
      <div className="flex-1 text-lg font-bold tracking-tight text-white">Nemesis AI</div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
          aria-label="Close menu"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function Sidebar() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'ADMIN';
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-slate-900 text-slate-100 md:flex">
      <NavBrand />
      <NavBody isAdmin={isAdmin} />
    </aside>
  );
}

/**
 * Mobile drawer: slides in from the left, dismisses on route change, on
 * overlay click, or on Escape. Visible only when `open` is true; mounted
 * always so the slide animation has somewhere to anchor.
 */
export function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'ADMIN';
  const location = useLocation();

  // Dismiss on route change (back-button navigation, link clicks bypass this).
  useEffect(() => {
    if (open) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <>
      <div
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden',
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        aria-hidden
      />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-slate-900 text-slate-100 transition-transform md:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
      >
        <NavBrand onClose={onClose} />
        <NavBody isAdmin={isAdmin} onNavigate={onClose} />
      </aside>
    </>
  );
}
