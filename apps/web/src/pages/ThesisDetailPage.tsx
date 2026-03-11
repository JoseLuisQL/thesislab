import { useParams, useNavigate } from 'react-router';
import { useThesisDetail, useThesisResume, useWorkflowPacks } from '../hooks/use-api';

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-white/5">
      <span className="text-xs text-white/40 font-medium">{label}</span>
      <span className="text-sm text-white/80">{value || '—'}</span>
    </div>
  );
}

function StateBadge({ state }: { state: string }) {
  const colors: Record<string, string> = {
    active: 'badge-available', draft: 'badge-info', intake: 'badge-info',
    blocked: 'badge-error', review: 'badge-degraded', completed: 'badge-available',
  };
  return <span className={`badge ${colors[state] ?? 'badge-info'}`}>{state}</span>;
}

export function ThesisDetailPage() {
  const { thesisId } = useParams<{ thesisId: string }>();
  const navigate = useNavigate();
  const { data: detailData, isLoading: loadingDetail } = useThesisDetail(thesisId ?? null);
  const { data: resumeData, isLoading: loadingResume } = useThesisResume(thesisId ?? null);
  const { data: packsData } = useWorkflowPacks(thesisId ?? null);

  if (loadingDetail) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="shimmer h-8 w-48" />
        <div className="shimmer h-64" />
      </div>
    );
  }

  const detail = (detailData as Record<string, unknown>)?.thesis as {
    thesis: { id: string; title: string; slug: string; degreeProgram: string; institution: string; defaultLanguage: string; workspacePath: string; currentState: string; createdAt: string; updatedAt: string };
    state: string;
    statusSummary: string;
    blockers: string[];
    nextStepSummary: string;
    checkpointCount: number;
    feedbackCount: number;
    activeWorkspace: { intakeJobId: string; detectedFormat: string; entrypoint: string | null; nodeCount: number } | null;
    transitions: Array<{ state: string; statusSummary: string; transitionedAt: string }>;
  } | undefined;

  const resume = (resumeData as Record<string, unknown>)?.resume as {
    nextAction: string;
    latestCheckpoint: { label: string; checkpointedAt: string } | null;
    recentFeedback: Array<{ body: string; sourceType: string; recordedAt: string }>;
    workflowPacks: Array<{ name: string; status: string; progress: { totalSteps: number; completedSteps: number } }>;
  } | undefined;

  const packs = (packsData as Record<string, unknown>)?.packs as Array<{
    id: string;
    name: string;
    description: string;
    status: string;
    progress: { totalSteps: number; completedSteps: number; blockedSteps: number };
    steps: Array<{ id: string; title: string; status: string; isCurrent: boolean }>;
  }> | undefined;

  if (!detail) {
    return (
      <div className="glass-card p-8 text-center animate-fade-in">
        <p className="text-white/40">Thesis not found.</p>
        <button onClick={() => navigate('/')} className="btn-primary mt-4">← Back</button>
      </div>
    );
  }

  const thesis = detail.thesis;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <button onClick={() => navigate('/')} className="text-xs text-white/30 hover:text-white/60 transition-colors mb-2 cursor-pointer">
            ← Dashboard
          </button>
          <h1 className="text-2xl font-bold tracking-tight text-white">{thesis.title}</h1>
          <p className="text-sm text-white/40 mt-1">{thesis.degreeProgram} · {thesis.institution}</p>
        </div>
        <StateBadge state={detail.state} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Status card */}
          <div className="glass-card p-5">
            <h2 className="section-title mb-4">Status</h2>
            <InfoRow label="State" value={detail.state} />
            <InfoRow label="Summary" value={detail.statusSummary} />
            <InfoRow label="Next Step" value={detail.nextStepSummary} />
            <InfoRow label="Language" value={thesis.defaultLanguage} />
            <InfoRow label="Checkpoints" value={String(detail.checkpointCount)} />
            <InfoRow label="Feedback Entries" value={String(detail.feedbackCount)} />
            {detail.blockers.length > 0 && (
              <div className="mt-3 p-3 rounded-lg bg-[var(--color-accent-red)]/10 border border-[var(--color-accent-red)]/20">
                <p className="text-xs font-semibold text-[var(--color-accent-red)] mb-1">Blockers</p>
                {detail.blockers.map((b, i) => (
                  <p key={i} className="text-xs text-white/60">{b}</p>
                ))}
              </div>
            )}
          </div>

          {/* Active workspace */}
          {detail.activeWorkspace && (
            <div className="glass-card p-5">
              <h2 className="section-title mb-4">Active Workspace</h2>
              <InfoRow label="Format" value={detail.activeWorkspace.detectedFormat} />
              <InfoRow label="Entrypoint" value={detail.activeWorkspace.entrypoint} />
              <InfoRow label="Nodes" value={String(detail.activeWorkspace.nodeCount)} />
              <InfoRow label="Intake Job" value={detail.activeWorkspace.intakeJobId} />
            </div>
          )}

          {/* Workflow packs */}
          {packs && packs.length > 0 && (
            <div className="glass-card p-5">
              <h2 className="section-title mb-4">Workflow Packs</h2>
              <div className="space-y-4">
                {packs.map((pack) => (
                  <div key={pack.id} className="border border-white/5 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-white/80">{pack.name}</h3>
                      <span className={`badge ${pack.status === 'completed' ? 'badge-available' : pack.status === 'blocked' ? 'badge-error' : 'badge-info'}`}>
                        {pack.progress.completedSteps}/{pack.progress.totalSteps}
                      </span>
                    </div>
                    <p className="text-xs text-white/30 mb-3">{pack.description}</p>
                    {/* Progress bar */}
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[var(--color-primary-500)] to-[var(--color-accent-green)] transition-all duration-500"
                        style={{ width: `${pack.progress.totalSteps > 0 ? (pack.progress.completedSteps / pack.progress.totalSteps) * 100 : 0}%` }}
                      />
                    </div>
                    {/* Steps */}
                    <div className="mt-3 space-y-1">
                      {pack.steps.map((step) => (
                        <div key={step.id} className={`flex items-center gap-2 text-xs py-1 ${step.isCurrent ? 'text-[var(--color-primary-300)]' : 'text-white/30'}`}>
                          <span>{step.status === 'completed' ? '✓' : step.isCurrent ? '▸' : '○'}</span>
                          <span>{step.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column - Resume */}
        <div className="space-y-6">
          {/* Resume card */}
          {!loadingResume && resume && (
            <div className="glass-card p-5">
              <h2 className="section-title mb-4">Resume</h2>
              <div className="p-3 rounded-lg bg-[var(--color-primary-600)]/10 border border-[var(--color-primary-600)]/20 mb-4">
                <p className="text-xs font-semibold text-[var(--color-primary-300)] mb-1">Next Action</p>
                <p className="text-sm text-white/70">{resume.nextAction}</p>
              </div>
              {resume.latestCheckpoint && (
                <div className="mb-4">
                  <p className="text-xs text-white/40 font-medium mb-1">Latest Checkpoint</p>
                  <p className="text-sm text-white/70">{resume.latestCheckpoint.label}</p>
                  <p className="text-[10px] text-white/20 mt-0.5">
                    {new Date(resume.latestCheckpoint.checkpointedAt).toLocaleDateString()}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Recent feedback */}
          {resume?.recentFeedback && resume.recentFeedback.length > 0 && (
            <div className="glass-card p-5">
              <h2 className="section-title mb-4">Recent Feedback</h2>
              <div className="space-y-3">
                {resume.recentFeedback.slice(0, 5).map((fb, i) => (
                  <div key={i} className="border-b border-white/5 pb-3 last:border-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`badge ${fb.sourceType === 'user' ? 'badge-info' : fb.sourceType === 'qa' ? 'badge-degraded' : 'badge-available'}`}>
                        {fb.sourceType}
                      </span>
                    </div>
                    <p className="text-xs text-white/50 line-clamp-3">{fb.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* State transitions */}
          {detail.transitions.length > 0 && (
            <div className="glass-card p-5">
              <h2 className="section-title mb-4">History</h2>
              <div className="space-y-2">
                {detail.transitions.slice(0, 8).map((t, i) => (
                  <div key={i} className="flex items-center gap-3 py-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary-500)]" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-white/60 truncate">{t.statusSummary || t.state}</p>
                      <p className="text-[10px] text-white/20">{new Date(t.transitionedAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
