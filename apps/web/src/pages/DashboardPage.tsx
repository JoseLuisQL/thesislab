import { useNavigate } from 'react-router';
import { useTheses, useCapabilities } from '../hooks/use-api';
import { useThesisStore } from '../stores/thesis';

function StateBadge({ state }: { state: string }) {
  const colors: Record<string, string> = {
    available: 'badge-available',
    ready: 'badge-available',
    active: 'badge-available',
    degraded: 'badge-degraded',
    blocked: 'badge-error',
    draft: 'badge-info',
    intake: 'badge-info',
    review: 'badge-degraded',
    completed: 'badge-available',
  };
  return <span className={`badge ${colors[state] ?? 'badge-info'}`}>{state}</span>;
}

function ThesisCard({ thesis }: { thesis: { id: string; title: string; slug: string; degreeProgram: string; institution: string; currentState: string; nextStepSummary: string; createdAt: string } }) {
  const navigate = useNavigate();
  const setSelectedThesisId = useThesisStore((s) => s.setSelectedThesisId);

  return (
    <button
      onClick={() => {
        setSelectedThesisId(thesis.id);
        navigate(`/thesis/${thesis.id}`);
      }}
      className="glass-card p-5 text-left w-full cursor-pointer group"
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-base font-semibold text-white group-hover:text-[var(--color-primary-300)] transition-colors leading-tight">
          {thesis.title}
        </h3>
        <StateBadge state={thesis.currentState} />
      </div>
      <p className="text-sm text-white/40 mb-1">{thesis.degreeProgram} · {thesis.institution}</p>
      {thesis.nextStepSummary && (
        <p className="text-xs text-white/30 mt-3 border-t border-white/5 pt-3">
          <span className="text-[var(--color-primary-400)] font-medium">Next: </span>
          {thesis.nextStepSummary}
        </p>
      )}
    </button>
  );
}

function WorkflowGrid({ items }: { items: Array<{ key: string; label: string; state: string; summary: string; kind: string }> }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {items.map((item) => (
        <div key={item.key} className="glass-card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-white/80">{item.label}</span>
            <StateBadge state={item.state} />
          </div>
          <p className="text-xs text-white/40">{item.summary}</p>
        </div>
      ))}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-fade-in">
      <div className="shimmer h-10 w-48 mb-6" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="shimmer h-32" />
        ))}
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { data: thesesData, isLoading: loadingTheses } = useTheses();
  const { data: capabilities, isLoading: loadingCaps } = useCapabilities();

  if (loadingTheses || loadingCaps) {
    return <LoadingSkeleton />;
  }

  const theses = thesesData?.theses ?? [];

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white mb-1">Dashboard</h1>
        <p className="text-sm text-white/40">
          {theses.length} thesis project{theses.length !== 1 ? 's' : ''} · {capabilities?.posture.mode ?? 'unknown'} mode
        </p>
      </div>

      {/* Capabilities */}
      {capabilities && (
        <section>
          <h2 className="section-title mb-4">Core Workflows</h2>
          <WorkflowGrid items={capabilities.workflows} />
        </section>
      )}

      {capabilities && capabilities.integrations.length > 0 && (
        <section>
          <h2 className="section-title mb-4">Integrations</h2>
          <WorkflowGrid items={capabilities.integrations.map((i) => ({ ...i, kind: 'integration' }))} />
        </section>
      )}

      {/* Thesis list */}
      <section>
        <h2 className="section-title mb-4">Thesis Projects</h2>
        {theses.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <p className="text-white/40 text-sm">No thesis projects yet.</p>
            <p className="text-white/20 text-xs mt-2">Create your first thesis to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {theses.map((thesis) => (
              <ThesisCard key={thesis.id} thesis={thesis} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
