import { useActiveThesisSelection } from '../hooks/use-active-thesis';
import {
  useAcademicQaRuns,
  useComplianceRuns,
  useCreateAcademicQaRunMutation,
  useCreateComplianceRunMutation,
  usePolicyProfiles,
  useThesisDetail,
} from '../hooks/use-api';

export function CompliancePage() {
  const { selectedThesis, selectedThesisId } = useActiveThesisSelection();
  const detailQuery = useThesisDetail(selectedThesisId);
  const complianceQuery = useComplianceRuns(selectedThesisId);
  const qaQuery = useAcademicQaRuns(selectedThesisId);
  const policies = usePolicyProfiles();
  const createCompliance = useCreateComplianceRunMutation(selectedThesisId);
  const createQa = useCreateAcademicQaRunMutation(selectedThesisId);

  const complianceRuns = complianceQuery.data?.complianceRuns ?? [];
  const academicQaRuns = qaQuery.data?.academicQaRuns ?? [];
  const policyProfile = policies.data?.policyProfiles.find((policy) => policy.id === detailQuery.data?.thesis.thesis.policyProfileId) ?? null;

  return (
    <div className="space-y-8">
      <section className="glass-card p-6 md:p-8">
        <p className="editorial-kicker">Compliance + QA</p>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">Policy and academic review</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-white/55">
              Run university-policy validation and academic QA against the currently active thesis. The results stay tied to the thesis state
              and reappear in resume workflows.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button className="btn-secondary" disabled={!selectedThesisId || createCompliance.isPending} onClick={() => createCompliance.mutate()}>
              {createCompliance.isPending ? 'Running policy...' : 'Run compliance'}
            </button>
            <button className="btn-primary" disabled={!selectedThesisId || createQa.isPending} onClick={() => createQa.mutate()}>
              {createQa.isPending ? 'Running QA...' : 'Run academic QA'}
            </button>
          </div>
        </div>
      </section>

      {!selectedThesisId ? (
        <div className="glass-card p-10 text-center text-white/45">Create or select a thesis first.</div>
      ) : (
        <>
          <section className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
            <div className="glass-card p-6">
              <p className="editorial-kicker">Active Scope</p>
              <h2 className="mt-3 text-2xl font-semibold text-white">{selectedThesis?.title}</h2>
              <p className="mt-2 text-sm text-white/45">{selectedThesis?.degreeProgram}</p>

              <div className="mt-6 space-y-4">
                <div className="rounded-[22px] border border-white/8 bg-black/20 p-4">
                  <p className="text-xs text-white/35">Assigned policy</p>
                  <p className="mt-2 text-sm font-semibold text-white">{policyProfile?.title ?? 'No thesis policy assigned yet'}</p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-black/20 p-4">
                  <p className="text-xs text-white/35">Active workspace</p>
                  <p className="mt-2 text-sm font-semibold text-white">
                    {detailQuery.data?.thesis.activeWorkspace
                      ? String(detailQuery.data.thesis.activeWorkspace.entrypoint ?? detailQuery.data.thesis.activeWorkspace.intakeJobId ?? 'active')
                      : 'No imported workspace'}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <section className="glass-card p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="editorial-kicker">Compliance Runs</p>
                    <p className="mt-2 text-2xl font-semibold text-white">{complianceRuns.length}</p>
                  </div>
                  <span className="badge badge-info">{complianceRuns[0]?.status ?? 'idle'}</span>
                </div>
                <div className="mt-5 space-y-4">
                  {complianceRuns.length === 0 ? (
                    <p className="text-sm text-white/38">No compliance runs yet.</p>
                  ) : complianceRuns.map((run) => (
                    <div key={run.id} className="rounded-[22px] border border-white/8 bg-black/20 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-white">{run.policyProfileVersion || 'policy run'}</p>
                        <span className="badge badge-degraded">{run.status}</span>
                      </div>
                      <div className="mt-4 grid grid-cols-4 gap-2">
                        <div className="rounded-[16px] bg-white/4 p-3 text-center">
                          <p className="text-lg font-semibold text-white">{run.counts.evaluated}</p>
                          <p className="text-[10px] text-white/30">evaluated</p>
                        </div>
                        <div className="rounded-[16px] bg-white/4 p-3 text-center">
                          <p className="text-lg font-semibold text-[var(--color-accent-amber)]">{run.counts.warnings}</p>
                          <p className="text-[10px] text-white/30">warnings</p>
                        </div>
                        <div className="rounded-[16px] bg-white/4 p-3 text-center">
                          <p className="text-lg font-semibold text-[var(--color-accent-red)]">{run.counts.violations}</p>
                          <p className="text-[10px] text-white/30">violations</p>
                        </div>
                        <div className="rounded-[16px] bg-white/4 p-3 text-center">
                          <p className="text-lg font-semibold text-white">{run.counts.skipped}</p>
                          <p className="text-[10px] text-white/30">skipped</p>
                        </div>
                      </div>
                      <div className="mt-4 space-y-2">
                        {run.issues.slice(0, 4).map((issue) => (
                          <div key={issue.id} className="rounded-[16px] border border-white/8 bg-white/4 p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">{issue.severity}</p>
                            <p className="mt-2 text-sm text-white/72">{issue.message}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="glass-card p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="editorial-kicker">Academic QA Runs</p>
                    <p className="mt-2 text-2xl font-semibold text-white">{academicQaRuns.length}</p>
                  </div>
                  <span className="badge badge-info">{academicQaRuns[0]?.status ?? 'idle'}</span>
                </div>
                <div className="mt-5 space-y-4">
                  {academicQaRuns.length === 0 ? (
                    <p className="text-sm text-white/38">No academic QA runs yet.</p>
                  ) : academicQaRuns.map((run) => (
                    <div key={run.id} className="rounded-[22px] border border-white/8 bg-black/20 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-white">{run.startedAt ? new Date(run.startedAt).toLocaleDateString() : 'qa run'}</p>
                        <span className="badge badge-degraded">{run.status}</span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        {Object.entries(run.summary.findingsByCategory).map(([category, count]) => (
                          <div key={category} className="rounded-[16px] bg-white/4 p-3">
                            <p className="text-lg font-semibold text-white">{count}</p>
                            <p className="text-[10px] uppercase tracking-[0.2em] text-white/35">{category}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 space-y-2">
                        {run.issues.slice(0, 4).map((issue) => (
                          <div key={issue.id} className="rounded-[16px] border border-white/8 bg-white/4 p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/35">{issue.category}</p>
                            <p className="mt-2 text-sm text-white/72">{issue.message}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
