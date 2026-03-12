import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useThesisStore } from '../stores/thesis';
import { useThesisDetail, useThesisResume, useWorkflowPacks } from '../hooks/use-api';

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/8 py-3 last:border-b-0">
      <span className="text-xs font-semibold uppercase tracking-[0.24em] text-white/30">{label}</span>
      <span className="max-w-[65%] text-right text-sm text-white/72">{value || '—'}</span>
    </div>
  );
}

export function ThesisDetailPage() {
  const navigate = useNavigate();
  const { thesisId } = useParams<{ thesisId: string }>();
  const setSelectedThesisId = useThesisStore((state) => state.setSelectedThesisId);
  const detailQuery = useThesisDetail(thesisId ?? null);
  const resumeQuery = useThesisResume(thesisId ?? null);
  const workflowQuery = useWorkflowPacks(thesisId ?? null);

  useEffect(() => {
    if (thesisId) {
      setSelectedThesisId(thesisId);
    }
  }, [setSelectedThesisId, thesisId]);

  const detail = detailQuery.data?.thesis;
  const resume = resumeQuery.data?.resume;
  const workflowPacks = workflowQuery.data?.workflowPacks ?? [];

  if (!detail) {
    return (
      <div className="glass-card p-10 text-center">
        <p className="text-sm text-white/50">{detailQuery.isLoading ? 'Loading thesis…' : 'Thesis not found.'}</p>
        <button className="btn-secondary mt-4" onClick={() => navigate('/')}>
          Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="glass-card overflow-hidden p-6 md:p-8">
        <button className="text-xs uppercase tracking-[0.24em] text-white/35 transition hover:text-white/65" onClick={() => navigate('/')}>
          Back to Mission Control
        </button>
        <div className="mt-4 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="editorial-kicker">Thesis Record</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">{detail.thesis.title}</h1>
            <p className="mt-2 text-sm text-white/45">{detail.thesis.degreeProgram} · {detail.thesis.institution}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <span className="badge badge-info">{detail.state}</span>
            <button className="btn-secondary" onClick={() => navigate('/research')}>Open research</button>
            <button className="btn-secondary" onClick={() => navigate('/latex')}>Open LaTeX</button>
            <button className="btn-primary" onClick={() => navigate('/compliance')}>Run QA</button>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <section className="glass-card p-6">
          <p className="editorial-kicker">Profile</p>
          <div className="mt-4">
            <DetailRow label="State" value={detail.state} />
            <DetailRow label="Status" value={detail.statusSummary} />
            <DetailRow label="Next step" value={detail.nextStepSummary} />
            <DetailRow label="Language" value={detail.thesis.defaultLanguage} />
            <DetailRow label="Workspace" value={detail.thesis.workspacePath} />
            <DetailRow label="Policy" value={detail.thesis.policyProfileId} />
            <DetailRow label="Official LaTeX" value={detail.thesis.officialEntrypoint} />
          </div>
          {detail.blockers.length > 0 && (
            <div className="mt-5 rounded-[20px] border border-[rgba(248,113,113,0.2)] bg-[rgba(96,17,17,0.18)] p-4">
              <p className="text-sm font-semibold text-[var(--color-accent-red)]">Blockers</p>
              <ul className="mt-3 space-y-2 text-sm text-white/60">
                {detail.blockers.map((blocker) => (
                  <li key={blocker}>• {blocker}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="glass-card p-6">
          <p className="editorial-kicker">Resume Snapshot</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-[22px] border border-white/8 bg-black/20 p-4">
              <p className="text-xs text-white/35">Next action</p>
              <p className="mt-2 text-sm text-white/75">{resume?.nextAction || detail.nextStepSummary}</p>
            </div>
            <div className="rounded-[22px] border border-white/8 bg-black/20 p-4">
              <p className="text-xs text-white/35">Latest checkpoint</p>
              <p className="mt-2 text-sm text-white/75">{resume?.latestCheckpoint?.label || 'No checkpoint yet'}</p>
            </div>
          </div>

          {detail.activeWorkspace && (
            <div className="mt-5 rounded-[24px] border border-white/8 bg-white/4 p-4">
              <p className="editorial-kicker">Active Workspace</p>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="rounded-[18px] bg-black/20 p-4">
                  <p className="text-xs text-white/35">Format</p>
                  <p className="mt-2 text-sm font-semibold text-white">{String(detail.activeWorkspace.detectedFormat ?? 'unknown')}</p>
                </div>
                <div className="rounded-[18px] bg-black/20 p-4">
                  <p className="text-xs text-white/35">Entrypoint</p>
                  <p className="mt-2 text-sm font-semibold text-white">{String(detail.activeWorkspace.entrypoint ?? 'n/a')}</p>
                </div>
                <div className="rounded-[18px] bg-black/20 p-4">
                  <p className="text-xs text-white/35">Node count</p>
                  <p className="mt-2 text-sm font-semibold text-white">{String(detail.activeWorkspace.nodeCount ?? '0')}</p>
                </div>
              </div>
            </div>
          )}

          {workflowPacks.length > 0 && (
            <div className="mt-5 rounded-[24px] border border-white/8 bg-white/4 p-4">
              <p className="editorial-kicker">Workflow Packs</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {workflowPacks.map((pack) => (
                  <div key={pack.id} className="rounded-[18px] border border-white/8 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-white">{pack.name}</p>
                      <span className="badge badge-degraded">{pack.progress.completedSteps}/{pack.progress.totalSteps}</span>
                    </div>
                    <p className="mt-2 text-xs text-white/40">{pack.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
