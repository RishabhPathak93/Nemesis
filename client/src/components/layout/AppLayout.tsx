import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { MobileNav, Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  return (
    <div className="flex h-full bg-slate-50">
      <Sidebar />
      <MobileNav open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar onOpenMenu={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto px-4 py-6 md:px-6 md:py-8">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
