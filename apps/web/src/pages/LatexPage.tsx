import { useTheses, useIntakeJobs } from '../hooks/use-api';
import { useThesisStore } from '../stores/thesis';

export function LatexPage() {
  const selectedThesisId = useThesisStore((s) => s.selectedThesisId);
  const { data: thesesData } = useTheses();
  const { data: intakeData, isLoading } = useIntakeJobs(selectedThesisId);

  const theses = (thesesData as Record<string, unknown>)?.theses as Array<{ id: string; title: string }> | undefined;
  const intakeJobs = (intakeData as Record<string, unknown>)?.intakeJobs as Array<{
    id: string; status: string; sourceFormat: string; detectedEntrypoint: string | null;
    report: {
      detectedFormat: string;
      structureSummary: { entrypoint: string | null; itemCount: number; items: string[] } | null;
      normalizationSummary: { nodeCount: number } | null;
      warnings: string[];
      failures: Array<{ code: string; message: string }>;
      recommendedNextSteps: Array<{ code: string; message: string }>;
    } | null;
    startedAt: string | null; completedAt: string | null;
  }> | undefined;

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white mb-1">LaTeX Workbench</h1>
        <p className="text-sm text-white/40">Intake, structure inspection, and build management</p>
      </div>

      {!selectedThesisId && theses && theses.length > 0 && (
        <div className="glass-card p-5">
          <p className="text-sm text-white/50 mb-3">Select a thesis:</p>
          <div className="flex flex-wrap gap-2">
            {theses.map((t) => (
              <button key={t.id} onClick={() => useThesisStore.getState().setSelectedThesisId(t.id)} className="btn-primary text-xs">
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedThesisId && (
        <div className="space-y-6">
          {/* Intake Jobs */}
          <div className="glass-card p-5">
            <h2 className="section-title mb-4">Intake Jobs</h2>
            {isLoading ? (
              <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="shimmer h-24" />)}</div>
            ) : intakeJobs && intakeJobs.length > 0 ? (
              <div className="space-y-4">
                {intakeJobs.map((job) => (
                  <div key={job.id} className="border border-white/5 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className={`badge ${job.status === 'succeeded' ? 'badge-available' : job.status === 'failed' ? 'badge-error' : 'badge-info'}`}>
                          {job.status}
                        </span>
                        <span className="badge badge-info">{job.sourceFormat}</span>
                      </div>
                      <span className="text-[10px] text-white/20">
                        {job.completedAt ? new Date(job.completedAt).toLocaleDateString() : 'In progress'}
                      </span>
                    </div>

                    {job.report && (
                      <div className="space-y-3">
                        {job.report.structureSummary && (
                          <div className="grid grid-cols-3 gap-3 text-center">
                            <div className="p-2 rounded-lg bg-white/3">
                              <p className="text-sm font-bold text-white/70">{job.report.structureSummary.itemCount}</p>
                              <p className="text-[10px] text-white/30">Items</p>
                            </div>
                            <div className="p-2 rounded-lg bg-white/3">
                              <p className="text-sm font-bold text-white/70">{job.report.normalizationSummary?.nodeCount ?? 0}</p>
                              <p className="text-[10px] text-white/30">Nodes</p>
                            </div>
                            <div className="p-2 rounded-lg bg-white/3">
                              <p className="text-xs font-mono text-white/50 truncate">{job.report.structureSummary.entrypoint ?? 'none'}</p>
                              <p className="text-[10px] text-white/30">Entrypoint</p>
                            </div>
                          </div>
                        )}

                        {/* Warnings */}
                        {job.report.warnings.length > 0 && (
                          <div className="p-3 rounded-lg bg-[var(--color-accent-amber)]/5 border border-[var(--color-accent-amber)]/15">
                            <p className="text-xs font-semibold text-[var(--color-accent-amber)] mb-1">Warnings</p>
                            {job.report.warnings.map((w, i) => (
                              <p key={i} className="text-xs text-white/40">{w}</p>
                            ))}
                          </div>
                        )}

                        {/* Failures */}
                        {job.report.failures.length > 0 && (
                          <div className="p-3 rounded-lg bg-[var(--color-accent-red)]/5 border border-[var(--color-accent-red)]/15">
                            <p className="text-xs font-semibold text-[var(--color-accent-red)] mb-1">Failures</p>
                            {job.report.failures.map((f, i) => (
                              <p key={i} className="text-xs text-white/40"><span className="font-mono text-[var(--color-accent-red)]">{f.code}</span>: {f.message}</p>
                            ))}
                          </div>
                        )}

                        {/* Recommended next steps */}
                        {job.report.recommendedNextSteps.length > 0 && (
                          <div className="p-3 rounded-lg bg-[var(--color-primary-600)]/5 border border-[var(--color-primary-600)]/15">
                            <p className="text-xs font-semibold text-[var(--color-primary-300)] mb-1">Recommended Next Steps</p>
                            {job.report.recommendedNextSteps.map((step, i) => (
                              <p key={i} className="text-xs text-white/40">{step.message}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-white/30">No intake jobs yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
