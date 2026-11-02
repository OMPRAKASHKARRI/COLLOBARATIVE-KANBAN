import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, History, LogOut, Menu, Users, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import WorkspaceSwitcher from '../components/WorkspaceSwitcher';
import { Avatar } from '../components/ui';

const NAV = [
  { to: '/', label: 'Boards', icon: LayoutDashboard, end: true },
  { to: '/team', label: 'Team', icon: Users },
  { to: '/activity', label: 'Activity', icon: History },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden><rect width="32" height="32" rx="8" fill="#e9a825" /><rect x="6" y="7" width="5" height="18" rx="1.5" fill="#0d3b41" /><rect x="13.5" y="7" width="5" height="11" rx="1.5" fill="#0d3b41" opacity=".8" /><rect x="21" y="7" width="5" height="14" rx="1.5" fill="#0d3b41" /></svg>
      <span className="font-display text-lg font-bold tracking-tight text-white">Branchboard</span>
    </div>
  );
}

function SidebarContent({ onNavigate }) {
  const { user, logout } = useAuth();
  const { status } = useWorkspace();
  return (
    <div className="flex h-full flex-col gap-6 p-4 text-white">
      <Brand />
      {status === 'ready' && <WorkspaceSwitcher />}
      <nav aria-label="Main" className="flex flex-col gap-1">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} onClick={onNavigate}
            className={({ isActive }) => `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${isActive ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
            <Icon className="h-4 w-4" />{label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto flex items-center gap-2.5 rounded-xl bg-white/10 p-2.5">
        <Avatar user={user} />
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{user?.name}</p><p className="truncate text-[11px] text-white/60">{user?.email}</p></div>
        <button className="btn-icon !text-white hover:!bg-white/15" aria-label="Log out" title="Log out" onClick={() => logout()}><LogOut className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

export default function AppShell() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex h-full flex-col lg:flex-row">
      <aside className="hidden w-64 shrink-0 bg-[#0d3b41] lg:block"><SidebarContent /></aside>
      <header className="flex items-center justify-between bg-[#0d3b41] px-4 py-2.5 lg:hidden">
        <Brand />
        <button className="btn-icon !text-white hover:!bg-white/15" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <div className="relative h-full w-72 max-w-[85%] animate-slidein bg-[#0d3b41]">
            <button className="btn-icon absolute right-2 top-2 !text-white hover:!bg-white/15" aria-label="Close menu" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden"><Outlet /></main>
    </div>
  );
}
