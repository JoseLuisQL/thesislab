import { NavLink, Outlet } from 'react-router';
import { useCapabilities } from '../hooks/use-api';
import { useThesisStore } from '../stores/thesis';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '◆' },
  { to: '/research', label: 'Research', icon: '◈' },
  { to: '/compliance', label: 'Compliance', icon: '◇' },
  { to: '/latex', label: 'LaTeX', icon: '◊' },
];

export function Layout() {
  const { data: capabilities } = useCapabilities();
  const sidebarCollapsed = useThesisStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useThesisStore((s) => s.toggleSidebar);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`${sidebarCollapsed ? 'w-16' : 'w-64'} flex flex-col border-r border-white/5 bg-[var(--color-surface-50)]/80 backdrop-blur-xl transition-all duration-300`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-white/5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--color-primary-500)] to-[var(--color-primary-700)] flex items-center justify-center text-white text-sm font-bold shadow-lg shadow-[var(--color-primary-500)]/20">
            T
          </div>
          {!sidebarCollapsed && (
            <div className="animate-fade-in">
              <h1 className="text-sm font-bold tracking-tight text-white">Thesis OS</h1>
              <p className="text-[10px] text-white/40 font-medium">Research Platform</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `sidebar-link ${isActive ? 'sidebar-link-active' : ''}`
              }
            >
              <span className="text-lg">{item.icon}</span>
              {!sidebarCollapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Status */}
        <div className="px-3 py-4 border-t border-white/5">
          {capabilities && (
            <div className="flex items-center gap-2 px-3 py-2">
              <div className={`pulse-dot ${capabilities.posture.state === 'ready' ? 'pulse-dot-green' : 'pulse-dot-amber'}`} />
              {!sidebarCollapsed && (
                <span className="text-xs text-white/50 font-medium">
                  {capabilities.posture.mode}
                </span>
              )}
            </div>
          )}
          <button
            onClick={toggleSidebar}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs text-white/30 hover:text-white/60 hover:bg-white/5 transition-all duration-200"
          >
            {sidebarCollapsed ? '→' : '← Collapse'}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
