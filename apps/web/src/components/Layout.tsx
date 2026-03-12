import { NavLink, Outlet } from 'react-router';
import { useCapabilities } from '../hooks/use-api';
import { useActiveThesisSelection } from '../hooks/use-active-thesis';
import { useThesisStore } from '../stores/thesis';

const NAV_ITEMS = [
  { to: '/', label: 'Mission Control', caption: 'Overview' },
  { to: '/research', label: 'Research', caption: 'Sources' },
  { to: '/compliance', label: 'Compliance', caption: 'Policy + QA' },
  { to: '/latex', label: 'LaTeX', caption: 'Official document' },
];

export function Layout() {
  const capabilities = useCapabilities();
  const { theses, selectedThesis, selectedThesisId, setSelectedThesisId } = useActiveThesisSelection();
  const sidebarCollapsed = useThesisStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useThesisStore((state) => state.toggleSidebar);

  const statusState = capabilities.data?.posture.state ?? 'offline';

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(17,53,82,0.24),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(173,127,54,0.16),transparent_30%),linear-gradient(180deg,#071018_0%,#0d1721_55%,#081119_100%)] text-slate-100">
      <div className="flex min-h-screen">
        <aside
          className={`${sidebarCollapsed ? 'w-[92px]' : 'w-[312px]'} border-r border-white/8 bg-[rgba(5,13,18,0.88)] backdrop-blur-2xl transition-all duration-300`}
        >
          <div className="flex h-full flex-col">
            <div className="border-b border-white/8 px-5 py-6">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[linear-gradient(135deg,rgba(24,65,97,0.95),rgba(153,111,44,0.9))] text-lg font-bold text-white shadow-[0_18px_48px_rgba(0,0,0,0.3)]">
                  T
                </div>
                {!sidebarCollapsed && (
                  <div>
                    <p className="editorial-kicker">Thesis Research OS</p>
                    <h1 className="mt-2 text-xl font-semibold tracking-tight text-white">Control Room</h1>
                    <p className="mt-2 text-sm text-white/45">Local-first academic production workspace.</p>
                  </div>
                )}
              </div>
            </div>

            <nav className="flex-1 space-y-2 px-3 py-5">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `block rounded-[20px] border px-4 py-4 transition-all ${
                      isActive
                        ? 'border-[rgba(153,111,44,0.32)] bg-[linear-gradient(135deg,rgba(12,31,46,0.95),rgba(67,48,20,0.78))] shadow-[0_12px_30px_rgba(0,0,0,0.26)]'
                        : 'border-transparent bg-transparent hover:border-white/8 hover:bg-white/4'
                    }`
                  }
                >
                  {!sidebarCollapsed ? (
                    <>
                      <p className="text-sm font-semibold text-white">{item.label}</p>
                      <p className="mt-1 text-xs text-white/35">{item.caption}</p>
                    </>
                  ) : (
                    <span className="text-xs font-semibold uppercase tracking-[0.28em] text-white/60">{item.label.slice(0, 1)}</span>
                  )}
                </NavLink>
              ))}
            </nav>

            {!sidebarCollapsed && selectedThesis && (
              <div className="mx-3 mb-3 rounded-[24px] border border-white/8 bg-white/4 p-4">
                <p className="editorial-kicker">Active Thesis</p>
                <p className="mt-3 text-sm font-semibold text-white">{selectedThesis.title}</p>
                <p className="mt-1 text-xs text-white/40">{selectedThesis.degreeProgram}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="badge badge-info">{selectedThesis.currentState}</span>
                  <span className="text-[11px] text-white/35">{selectedThesis.defaultLanguage.toUpperCase()}</span>
                </div>
              </div>
            )}

            <div className="border-t border-white/8 px-3 py-4">
              <button
                onClick={toggleSidebar}
                className="w-full rounded-2xl border border-white/8 bg-white/4 px-3 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-white/45 transition hover:border-white/15 hover:text-white/72"
              >
                {sidebarCollapsed ? 'Expand' : 'Collapse'}
              </button>
            </div>
          </div>
        </aside>

        <main className="flex-1">
          <div className="border-b border-white/8 bg-[rgba(7,16,24,0.76)] px-5 py-4 backdrop-blur-xl md:px-8">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`badge ${statusState === 'ready' ? 'badge-available' : statusState === 'degraded' ? 'badge-degraded' : 'badge-error'}`}>
                  {capabilities.data?.posture.mode ?? 'api-offline'}
                </span>
                <p className="text-sm text-white/45">
                  {capabilities.data?.posture.summary ?? 'Backend unavailable. Start `pnpm dev:api` to unlock live workflows.'}
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">
                  Active thesis
                </label>
                <select
                  value={selectedThesisId ?? ''}
                  onChange={(event) => setSelectedThesisId(event.target.value || null)}
                  className="input-shell min-w-[260px]"
                >
                  {theses.length === 0 ? (
                    <option value="">No thesis registered</option>
                  ) : theses.map((thesis) => (
                    <option key={thesis.id} value={thesis.id}>
                      {thesis.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {capabilities.error && (
              <div className="mt-4 rounded-[22px] border border-[rgba(248,113,113,0.2)] bg-[rgba(96,17,17,0.18)] p-4">
                <p className="text-sm font-semibold text-[var(--color-accent-red)]">API offline</p>
                <p className="mt-1 text-sm text-white/55">
                  The web workspace is running, but the API is unreachable. Start `pnpm dev:api` in another terminal and reload the page.
                </p>
              </div>
            )}
          </div>

          <div className="mx-auto max-w-[1600px] px-5 py-8 md:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
