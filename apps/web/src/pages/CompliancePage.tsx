import { useComplianceRuns, useAcademicQaRuns, useTheses } from '../hooks/use-api';
import { useThesisStore } from '../stores/thesis';

export function CompliancePage() {
  const selectedThesisId = useThesisStore((s) => s.selectedThesisId);
  const { data: thesesData } = useTheses();
  const { data: complianceData, isLoading: loadingCompliance } = useComplianceRuns(selectedThesisId);
  const { data: qaData, isLoading: loadingQa } = useAcademicQaRuns(selectedThesisId);

  const theses = (thesesData as Record<string, unknown>)?.theses as Array<{ id: string; title: string }> | undefined;
  const complianceRuns = (complianceData as Record<string, unknown>)?.runs as Array<{
    id: string; status: string; policyProfileVersion: string;
    counts: { evaluated: number; warnings: number; violations: number; skipped: number };
    issues: Array<{ id: string; severity: string; message: string; remediation: string | null; ruleId: string }>;
    startedAt: string;
  }> | undefined;
  const qaRuns = (qaData as Record<string, unknown>)?.runs as Array<{
    id: string; status: string;
    summary: { findingsByCategory: Record<string, number>; assessedClaimCount: number; assessedSectionCount: number };
    issues: Array<{ id: string; category: string; severity: string; message: string; remediation: string | null }>;
    startedAt: string;
  }> | undefined;

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white mb-1">Compliance & QA</h1>
        <p className="text-sm text-white/40">University policy checks and academic quality assurance</p>
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Compliance runs */}
          <div className="glass-card p-5">
            <h2 className="section-title mb-4">Policy Compliance</h2>
            {loadingCompliance ? (
              <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="shimmer h-20" />)}</div>
            ) : complianceRuns && complianceRuns.length > 0 ? (
              <div className="space-y-4">
                {complianceRuns.map((run) => (
                  <div key={run.id} className="border border-white/5 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className={`badge ${run.status === 'completed' ? 'badge-available' : run.status === 'failed' ? 'badge-error' : 'badge-degraded'}`}>
                        {run.status}
                      </span>
                      <span className="text-[10px] text-white/20">{new Date(run.startedAt).toLocaleDateString()}</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center mb-3">
                      <div>
                        <p className="text-lg font-bold text-white/80">{run.counts.evaluated}</p>
                        <p className="text-[10px] text-white/30">Evaluated</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-[var(--color-accent-green)]">{run.counts.evaluated - run.counts.warnings - run.counts.violations}</p>
                        <p className="text-[10px] text-white/30">Passed</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-[var(--color-accent-amber)]">{run.counts.warnings}</p>
                        <p className="text-[10px] text-white/30">Warnings</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-[var(--color-accent-red)]">{run.counts.violations}</p>
                        <p className="text-[10px] text-white/30">Violations</p>
                      </div>
                    </div>
                    {run.issues.length > 0 && (
                      <div className="space-y-2 mt-3 pt-3 border-t border-white/5">
                        {run.issues.slice(0, 5).map((issue) => (
                          <div key={issue.id} className="flex items-start gap-2">
                            <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${issue.severity === 'violation' ? 'bg-[var(--color-accent-red)]' : 'bg-[var(--color-accent-amber)]'}`} />
                            <div>
                              <p className="text-xs text-white/60">{issue.message}</p>
                              {issue.remediation && <p className="text-[10px] text-white/25 mt-0.5">{issue.remediation}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-white/30">No compliance runs yet.</p>
            )}
          </div>

          {/* Academic QA runs */}
          <div className="glass-card p-5">
            <h2 className="section-title mb-4">Academic QA</h2>
            {loadingQa ? (
              <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="shimmer h-20" />)}</div>
            ) : qaRuns && qaRuns.length > 0 ? (
              <div className="space-y-4">
                {qaRuns.map((run) => (
                  <div key={run.id} className="border border-white/5 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className={`badge ${run.status === 'completed' ? 'badge-available' : 'badge-degraded'}`}>
                        {run.status}
                      </span>
                      <span className="text-[10px] text-white/20">{new Date(run.startedAt).toLocaleDateString()}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      {Object.entries(run.summary.findingsByCategory).map(([cat, count]) => (
                        <div key={cat} className="text-center p-2 rounded-lg bg-white/3">
                          <p className="text-sm font-bold text-white/70">{count as number}</p>
                          <p className="text-[10px] text-white/30">{cat}</p>
                        </div>
                      ))}
                    </div>
                    {run.issues.length > 0 && (
                      <div className="space-y-2 mt-3 pt-3 border-t border-white/5">
                        {run.issues.slice(0, 5).map((issue) => (
                          <div key={issue.id} className="flex items-start gap-2">
                            <span className={`badge text-[9px] flex-shrink-0 ${issue.severity === 'issue' ? 'badge-error' : 'badge-degraded'}`}>
                              {issue.category}
                            </span>
                            <p className="text-xs text-white/50">{issue.message}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-white/30">No QA runs yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
