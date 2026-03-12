import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useActiveThesisSelection } from '../hooks/use-active-thesis';
import {
  useCapabilities,
  useCreateIntakeJobMutation,
  useCreateThesisMutation,
  useOpenClawAssignment,
  useOpenClawStatus,
  usePolicyProfiles,
  useThesisDetail,
  useThesisResume,
  useUpdateOpenClawAssignmentMutation,
  useUpdateThesisMutation,
  useUpdateWorkflowPackOpenClawAssignmentMutation,
  useWorkflowPacks,
} from '../hooks/use-api';

function StateBadge({ state }: { state: string }) {
  const tone = state === 'completed' || state === 'active' || state === 'available'
    ? 'badge-available'
    : state === 'blocked' || state === 'error'
      ? 'badge-error'
      : 'badge-degraded';
  return <span className={`badge ${tone}`}>{state}</span>;
}

function WorkflowPackAgentCard({
  thesisId,
  workflowPackId,
  name,
  status,
  description,
  currentAgentId,
  agentOptions,
}: {
  thesisId: string;
  workflowPackId: string;
  name: string;
  status: string;
  description: string;
  currentAgentId: string | null;
  agentOptions: Array<{ id: string }>;
}) {
  const updateMutation = useUpdateWorkflowPackOpenClawAssignmentMutation(thesisId, workflowPackId);
  const [agentId, setAgentId] = useState(currentAgentId ?? '');

  useEffect(() => {
    setAgentId(currentAgentId ?? '');
  }, [currentAgentId]);

  return (
    <div className="rounded-[20px] border border-white/8 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-white">{name}</p>
        <StateBadge state={status} />
      </div>
      <p className="mt-2 text-xs text-white/40">{description}</p>
      <select className="input-shell mt-4" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
        <option value="">Use thesis default</option>
        {agentOptions.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.id}
          </option>
        ))}
      </select>
      <button
        className="btn-secondary mt-4"
        disabled={updateMutation.isPending}
        onClick={() => updateMutation.mutate({ agentId: agentId || null })}
      >
        {updateMutation.isPending ? 'Saving...' : 'Assign pack agent'}
      </button>
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const capabilities = useCapabilities();
  const policies = usePolicyProfiles();
  const openClawStatus = useOpenClawStatus();
  const {
    theses,
    selectedThesis,
    selectedThesisId,
    setSelectedThesisId,
    isLoading: loadingTheses,
  } = useActiveThesisSelection();
  const detailQuery = useThesisDetail(selectedThesisId);
  const resumeQuery = useThesisResume(selectedThesisId);
  const workflowQuery = useWorkflowPacks(selectedThesisId);
  const openClawAssignmentQuery = useOpenClawAssignment(selectedThesisId);
  const createThesis = useCreateThesisMutation();
  const updateThesis = useUpdateThesisMutation(selectedThesisId);
  const updateOpenClawAssignment = useUpdateOpenClawAssignmentMutation(selectedThesisId);
  const createIntake = useCreateIntakeJobMutation(selectedThesisId);

  const [createForm, setCreateForm] = useState({
    title: '',
    degreeProgram: '',
    institution: 'PUCP',
    workspacePath: '',
    defaultLanguage: 'es',
    policyProfileId: '',
    openClawAgentId: '',
  });
  const [importRootPath, setImportRootPath] = useState('');
  const [policyAssignment, setPolicyAssignment] = useState('');
  const [openClawAgentAssignment, setOpenClawAgentAssignment] = useState('');

  useEffect(() => {
    if (selectedThesis?.policyProfileId) {
      setPolicyAssignment(selectedThesis.policyProfileId);
    }
  }, [selectedThesis?.policyProfileId]);

  useEffect(() => {
    setOpenClawAgentAssignment(openClawAssignmentQuery.data?.assignment.thesisTarget.agentId ?? '');
  }, [openClawAssignmentQuery.data?.assignment.thesisTarget.agentId]);

  const activeWorkspace = detailQuery.data?.thesis.activeWorkspace;
  const resume = resumeQuery.data?.resume;
  const workflowPacks = workflowQuery.data?.workflowPacks ?? [];

  const handleCreateThesis = async () => {
    const title = createForm.title.trim();
    const degreeProgram = createForm.degreeProgram.trim();
    const institution = createForm.institution.trim();
    const workspacePath = createForm.workspacePath.trim();

    if (!title || !degreeProgram || !institution || !workspacePath) {
      return;
    }

    const result = await createThesis.mutateAsync({
      title,
      degreeProgram,
      institution,
      workspacePath,
      defaultLanguage: createForm.defaultLanguage,
      policyProfileId: createForm.policyProfileId || null,
      openClawAgentId: createForm.openClawAgentId || null,
    });

    setSelectedThesisId(result.thesis.thesis.id);
    navigate(`/thesis/${result.thesis.thesis.id}`);
    setImportRootPath('');
  };

  const handleAssignPolicy = async () => {
    if (!selectedThesisId || !policyAssignment) {
      return;
    }

    await updateThesis.mutateAsync({ policyProfileId: policyAssignment });
  };

  const handleImport = async () => {
    if (!selectedThesisId || !importRootPath.trim()) {
      return;
    }

    await createIntake.mutateAsync(importRootPath.trim());
    await Promise.all([detailQuery.refetch(), resumeQuery.refetch(), workflowQuery.refetch()]);
  };

  const handleAssignOpenClawAgent = async () => {
    if (!selectedThesisId) {
      return;
    }

    await updateOpenClawAssignment.mutateAsync({
      agentId: openClawAgentAssignment || null,
    });
  };

  return (
    <div className="space-y-8">
      <section className="glass-card overflow-hidden p-6 md:p-8">
        <div className="grid gap-8 xl:grid-cols-[1.3fr_0.7fr]">
          <div>
            <p className="editorial-kicker">Mission Control</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">Ship the thesis, not just the chat.</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-white/55">
              This workspace now owns the real thesis lifecycle: register the thesis, bind a policy profile, import progress, resume work,
              research with sources, and operate the official LaTeX document.
            </p>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              {(capabilities.data?.workflows ?? []).slice(0, 6).map((workflow) => (
                <div key={workflow.key} className="rounded-[22px] border border-white/8 bg-white/4 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">{workflow.label}</p>
                    <StateBadge state={workflow.state} />
                  </div>
                  <p className="mt-3 text-xs text-white/40">{workflow.summary}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-5">
            <p className="editorial-kicker">Workspace Health</p>
            <div className="mt-5 space-y-3">
              <div className="rounded-[20px] border border-white/8 bg-black/20 p-4">
                <p className="text-xs text-white/35">API posture</p>
                <p className="mt-1 text-lg font-semibold text-white">{capabilities.data?.posture.mode ?? 'offline'}</p>
              </div>
              <div className="rounded-[20px] border border-white/8 bg-black/20 p-4">
                <p className="text-xs text-white/35">Registered theses</p>
                <p className="mt-1 text-lg font-semibold text-white">{theses.length}</p>
              </div>
              <div className="rounded-[20px] border border-white/8 bg-black/20 p-4">
                <p className="text-xs text-white/35">Current active thesis</p>
                <p className="mt-1 text-sm font-semibold text-white">{selectedThesis?.title ?? 'None yet'}</p>
              </div>
              <div className="rounded-[20px] border border-white/8 bg-black/20 p-4">
                <p className="text-xs text-white/35">OpenClaw brain</p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {openClawStatus.data?.status.gatewayReachable ? 'connected' : openClawStatus.data?.status.installed ? 'installed, gateway offline' : 'not installed'}
                </p>
                <p className="mt-2 text-[11px] text-white/35">
                  {openClawStatus.data?.status.defaultAgentId
                    ? `default agent: ${openClawStatus.data.status.defaultAgentId}`
                    : openClawStatus.data?.status.gatewayError ?? 'No OpenClaw status yet'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <section className="glass-card p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="editorial-kicker">Create Thesis</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Register a new project</h2>
            </div>
            <StateBadge state={loadingTheses ? 'loading' : 'ready'} />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <input
              className="input-shell"
              placeholder="Thesis title"
              value={createForm.title}
              onChange={(event) => setCreateForm((state) => ({ ...state, title: event.target.value }))}
            />
            <input
              className="input-shell"
              placeholder="Degree program"
              value={createForm.degreeProgram}
              onChange={(event) => setCreateForm((state) => ({ ...state, degreeProgram: event.target.value }))}
            />
            <input
              className="input-shell"
              placeholder="Institution"
              value={createForm.institution}
              onChange={(event) => setCreateForm((state) => ({ ...state, institution: event.target.value }))}
            />
            <input
              className="input-shell"
              placeholder="Language"
              value={createForm.defaultLanguage}
              onChange={(event) => setCreateForm((state) => ({ ...state, defaultLanguage: event.target.value }))}
            />
            <div className="md:col-span-2">
              <input
                className="input-shell"
                placeholder="Workspace path"
                value={createForm.workspacePath}
                onChange={(event) => setCreateForm((state) => ({ ...state, workspacePath: event.target.value }))}
              />
            </div>
            <div className="md:col-span-2">
              <select
                className="input-shell"
                value={createForm.policyProfileId}
                onChange={(event) => setCreateForm((state) => ({ ...state, policyProfileId: event.target.value }))}
              >
                <option value="">No policy profile yet</option>
                {(policies.data?.policyProfiles ?? []).map((policy) => (
                  <option key={policy.id} value={policy.id}>
                    {policy.title} · {policy.version}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <select
                className="input-shell"
                value={createForm.openClawAgentId}
                onChange={(event) => setCreateForm((state) => ({ ...state, openClawAgentId: event.target.value }))}
              >
                <option value="">No OpenClaw agent assigned</option>
                {(openClawStatus.data?.status.agents ?? []).map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.id}{agent.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {createThesis.error && (
            <p className="mt-4 text-sm text-[var(--color-accent-red)]">{createThesis.error.message}</p>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <button className="btn-primary" disabled={createThesis.isPending} onClick={() => void handleCreateThesis()}>
              {createThesis.isPending ? 'Creating...' : 'Create thesis'}
            </button>
            <button
              className="btn-secondary"
              onClick={() => setCreateForm((state) => ({ ...state, workspacePath: 'C:\\Thesis\\workspace', title: 'Nueva tesis', degreeProgram: 'Ingeniería', institution: 'PUCP' }))}
            >
              Fill sample
            </button>
          </div>
        </section>

        <section className="glass-card p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="editorial-kicker">Active Thesis</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">{selectedThesis?.title ?? 'Select a thesis'}</h2>
            </div>
            {selectedThesis && <StateBadge state={selectedThesis.currentState} />}
          </div>

          {!selectedThesis ? (
            <div className="mt-6 rounded-[24px] border border-dashed border-white/12 bg-white/3 p-8 text-center text-white/45">
              Create or select a thesis to unlock import, policy, research and LaTeX workflows.
            </div>
          ) : (
            <>
              <div className="mt-6 grid gap-3 md:grid-cols-2">
                <div className="rounded-[22px] border border-white/8 bg-black/20 p-4">
                  <p className="text-xs text-white/35">Status</p>
                  <p className="mt-2 text-sm font-semibold text-white">{detailQuery.data?.thesis.statusSummary || selectedThesis.statusSummary || 'No summary yet'}</p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-black/20 p-4">
                  <p className="text-xs text-white/35">Next action</p>
                  <p className="mt-2 text-sm font-semibold text-white">{resume?.nextAction || selectedThesis.nextStepSummary || 'No next step defined yet'}</p>
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-[0.95fr_1.05fr]">
                <div className="rounded-[24px] border border-white/8 bg-white/4 p-4">
                  <p className="editorial-kicker">Policy Binding</p>
                  <select
                    className="input-shell mt-4"
                    value={policyAssignment}
                    onChange={(event) => setPolicyAssignment(event.target.value)}
                  >
                    <option value="">Select policy profile</option>
                    {(policies.data?.policyProfiles ?? []).map((policy) => (
                      <option key={policy.id} value={policy.id}>
                        {policy.title} · {policy.version}
                      </option>
                    ))}
                  </select>
                  <button className="btn-secondary mt-4" disabled={!policyAssignment || updateThesis.isPending} onClick={() => void handleAssignPolicy()}>
                    {updateThesis.isPending ? 'Saving...' : 'Assign policy'}
                  </button>
                </div>

                <div className="rounded-[24px] border border-white/8 bg-white/4 p-4">
                  <p className="editorial-kicker">Import Wizard</p>
                  <input
                    className="input-shell mt-4"
                    placeholder="Import root path (LaTeX, DOCX, PDF)"
                    value={importRootPath}
                    onChange={(event) => setImportRootPath(event.target.value)}
                  />
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button className="btn-primary" disabled={createIntake.isPending || !importRootPath.trim()} onClick={() => void handleImport()}>
                      {createIntake.isPending ? 'Importing...' : 'Run intake'}
                    </button>
                    <button className="btn-secondary" onClick={() => navigate('/latex')}>
                      Open LaTeX desk
                    </button>
                  </div>
                  {createIntake.data?.intakeJob && (
                    <div className="mt-4 rounded-[20px] border border-white/8 bg-black/20 p-4">
                      <p className="text-sm font-semibold text-white">{createIntake.data.intakeJob.sourceFormat.toUpperCase()} imported</p>
                      <p className="mt-1 text-xs text-white/40">{createIntake.data.intakeJob.detectedEntrypoint ?? createIntake.data.intakeJob.importRootPath}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-[0.82fr_1.18fr]">
                <div className="rounded-[24px] border border-white/8 bg-white/4 p-4">
                  <p className="editorial-kicker">OpenClaw Thesis Agent</p>
                  <select
                    className="input-shell mt-4"
                    value={openClawAgentAssignment}
                    onChange={(event) => setOpenClawAgentAssignment(event.target.value)}
                  >
                    <option value="">Use no dedicated agent</option>
                    {(openClawStatus.data?.status.agents ?? []).map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.id}{agent.isDefault ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                  <button className="btn-secondary mt-4" disabled={updateOpenClawAssignment.isPending} onClick={() => void handleAssignOpenClawAgent()}>
                    {updateOpenClawAssignment.isPending ? 'Saving...' : 'Assign thesis agent'}
                  </button>
                  <p className="mt-4 text-xs text-white/40">
                    {openClawStatus.data?.status.gatewayReachable
                      ? `Gateway ${openClawStatus.data.status.gatewayUrl ?? 'local'} reachable`
                      : openClawStatus.data?.status.gatewayError ?? 'OpenClaw gateway is offline'}
                  </p>
                </div>

                <div className="rounded-[24px] border border-white/8 bg-white/4 p-4">
                  <p className="editorial-kicker">Workflow Pack Agents</p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {workflowPacks.map((pack) => {
                      const target = openClawAssignmentQuery.data?.assignment.workflowPackTargets.find(
                        (item) => item.workflowPackId === pack.id,
                      );

                      return (
                        <WorkflowPackAgentCard
                          key={pack.id}
                          thesisId={selectedThesisId}
                          workflowPackId={pack.id}
                          name={pack.name}
                          status={pack.status}
                          description={pack.description}
                          currentAgentId={target?.agentId ?? null}
                          agentOptions={openClawStatus.data?.status.agents ?? []}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
                  <p className="editorial-kicker">Resume</p>
                  <p className="mt-3 text-sm text-white/65">{resume?.statusSummary || 'No resume summary yet.'}</p>
                  {resume?.latestCheckpoint && (
                    <p className="mt-3 text-xs text-white/40">Latest checkpoint: {resume.latestCheckpoint.label}</p>
                  )}
                </div>
                <div className="rounded-[24px] border border-white/8 bg-black/20 p-4">
                  <p className="editorial-kicker">Workspace</p>
                  <p className="mt-3 text-sm text-white/65">
                    {activeWorkspace
                      ? `${String(activeWorkspace.detectedFormat ?? 'workspace').toUpperCase()} · ${String(activeWorkspace.entrypoint ?? activeWorkspace.intakeJobId ?? 'active')}`
                      : 'No active imported workspace yet.'}
                  </p>
                  {detailQuery.data?.thesis.blockers.length ? (
                    <p className="mt-3 text-xs text-[var(--color-accent-red)]">{detailQuery.data.thesis.blockers[0]}</p>
                  ) : null}
                </div>
              </div>

              {workflowPacks.length > 0 && (
                <div className="mt-6 rounded-[24px] border border-white/8 bg-white/4 p-4">
                  <p className="editorial-kicker">Workflow Packs</p>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {workflowPacks.map((pack) => (
                      <div key={pack.id} className="rounded-[20px] border border-white/8 bg-black/20 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-white">{pack.name}</p>
                          <StateBadge state={pack.status} />
                        </div>
                        <p className="mt-2 text-xs text-white/40">{pack.description}</p>
                        <p className="mt-3 text-[11px] text-white/35">
                          {pack.progress.completedSteps}/{pack.progress.totalSteps} steps completed
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <section className="glass-card p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="editorial-kicker">Thesis Registry</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">All projects</h2>
          </div>
          <span className="badge badge-info">{theses.length} registered</span>
        </div>

        {theses.length === 0 ? (
          <div className="mt-6 rounded-[24px] border border-dashed border-white/12 bg-white/3 p-8 text-center text-white/45">
            No thesis project exists yet.
          </div>
        ) : (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {theses.map((thesis) => (
              <button
                key={thesis.id}
                onClick={() => {
                  setSelectedThesisId(thesis.id);
                  navigate(`/thesis/${thesis.id}`);
                }}
                className={`rounded-[26px] border p-5 text-left transition-all ${
                  thesis.id === selectedThesisId
                    ? 'border-[rgba(153,111,44,0.36)] bg-[linear-gradient(135deg,rgba(13,34,48,0.96),rgba(68,49,23,0.72))]'
                    : 'border-white/8 bg-white/4 hover:border-white/16 hover:bg-white/6'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-lg font-semibold text-white">{thesis.title}</p>
                    <p className="mt-2 text-sm text-white/40">{thesis.degreeProgram} · {thesis.institution}</p>
                  </div>
                  <StateBadge state={thesis.currentState} />
                </div>
                <p className="mt-4 text-sm text-white/52">{thesis.statusSummary || thesis.nextStepSummary || 'No summary yet.'}</p>
                <p className="mt-4 text-xs text-white/32">Next: {thesis.nextStepSummary || 'Define the next concrete action.'}</p>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
