import { useCallback, useEffect, useMemo, useState } from 'react';

type CapabilityState = 'available' | 'degraded' | 'unavailable';
type WorkflowKey = 'create' | 'intake' | 'resume' | 'latex' | 'qa';

type ThesisSummary = {
  thesis: {
    id: string;
    title: string;
    slug: string;
    degreeProgram: string;
    institution: string;
    currentState: string;
    latestStatusAt: string;
    nextStepSummary: string;
    activeImportId: string | null;
    activeBuildRunId: string | null;
  };
  statusSummary: string;
  blockers: string[];
  latestCheckpointId: string | null;
  latestFeedbackId: string | null;
  activeWorkspace: {
    intakeJobId: string;
    detectedFormat: string;
    entrypoint: string | null;
    nodeCount: number;
    latestBuildRunId: string | null;
  } | null;
};

type ThesisResume = {
  thesis: ThesisSummary['thesis'];
  statusSummary: string;
  blockers: string[];
  nextAction: string;
  latestCheckpoint: {
    id: string;
    label: string | null;
    reason: string;
    checkpointedAt: string;
  } | null;
  recentFeedback: Array<{
    id: string;
    sourceType: string;
    summary: string | null;
    body: string;
    recordedAt: string;
  }>;
  latestComplianceRun: { id: string; status: string; createdAt: string } | null;
  latestAcademicQaRun: { id: string; status: string; createdAt: string } | null;
  recentComplianceFindings: Array<{ id: string; severity: string; title: string; message: string }>;
  recentAcademicQaFindings: Array<{ id: string; severity: string; title: string; message: string }>;
};

type WorkflowCapability = {
  key: WorkflowKey;
  label: string;
  state: CapabilityState;
  summary: string;
  detail: string;
};

type IntegrationCapability = {
  key: string;
  label: string;
  state: CapabilityState;
  summary: string;
  detail: string;
};

type LocalFirstStatusPayload = {
  posture: {
    mode: string;
    state: string;
    summary: string;
    detail: string;
  };
  workflows: WorkflowCapability[];
  integrations: IntegrationCapability[];
};

type DashboardResponse = {
  ok: true;
  theses: ThesisSummary[];
};

type ThesisDetailResponse = {
  ok: true;
  thesis: ThesisSummary;
};

type ResumeResponse = {
  ok: true;
  resume: ThesisResume;
};

type StatusResponse = {
  ok: true;
  service: string;
  mission: string;
  timestamp: string;
} & LocalFirstStatusPayload;

type AppDataState = {
  status: StatusResponse | null;
  theses: ThesisSummary[];
  selectedThesisId: string | null;
  selectedDetail: ThesisSummary | null;
  selectedResume: ThesisResume | null;
};

type LoadingState = {
  status: boolean;
  dashboard: boolean;
  thesis: boolean;
};

type ErrorState = {
  status: string | null;
  dashboard: string | null;
  thesis: string | null;
};

const WORKFLOW_ENTRY_ORDER: WorkflowKey[] = ['create', 'intake', 'resume', 'latex', 'qa'];

const emptyDataState: AppDataState = {
  status: null,
  theses: [],
  selectedThesisId: null,
  selectedDetail: null,
  selectedResume: null,
};

const emptyLoadingState: LoadingState = {
  status: true,
  dashboard: true,
  thesis: false,
};

const emptyErrorState: ErrorState = {
  status: null,
  dashboard: null,
  thesis: null,
};

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'Sin registro';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while loading ${url}`);
  }

  return response.json() as Promise<T>;
}

export function App() {
  const [data, setData] = useState<AppDataState>(emptyDataState);
  const [loading, setLoading] = useState<LoadingState>(emptyLoadingState);
  const [errors, setErrors] = useState<ErrorState>(emptyErrorState);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => {
    setRefreshTick((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      setLoading({ status: true, dashboard: true, thesis: false });
      setErrors(emptyErrorState);

      try {
        const [status, dashboard] = await Promise.all([
          getJson<StatusResponse>('/status/capabilities'),
          getJson<DashboardResponse>('/theses'),
        ]);

        if (cancelled) {
          return;
        }

        const selectedThesisId = dashboard.theses[0]?.thesis.id ?? null;

        setData({
          status,
          theses: dashboard.theses,
          selectedThesisId,
          selectedDetail: null,
          selectedResume: null,
        });
        setLoading({ status: false, dashboard: false, thesis: Boolean(selectedThesisId) });
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : 'No fue posible cargar el dashboard.';
        setErrors({ status: message, dashboard: message, thesis: null });
        setLoading({ status: false, dashboard: false, thesis: false });
      }
    }

    void loadDashboard();

    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  useEffect(() => {
    if (!data.selectedThesisId) {
      setLoading((current) => ({ ...current, thesis: false }));
      setData((current) => ({ ...current, selectedDetail: null, selectedResume: null }));
      return;
    }

    let cancelled = false;
    const thesisId = data.selectedThesisId;

    async function loadThesisContext() {
      setLoading((current) => ({ ...current, thesis: true }));
      setErrors((current) => ({ ...current, thesis: null }));

      try {
        const [detailResponse, resumeResponse] = await Promise.all([
          getJson<ThesisDetailResponse>(`/theses/${thesisId}`),
          getJson<ResumeResponse>(`/theses/${thesisId}/resume`),
        ]);

        if (cancelled) {
          return;
        }

        setData((current) => ({
          ...current,
          selectedDetail: detailResponse.thesis,
          selectedResume: resumeResponse.resume,
        }));
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : 'No fue posible cargar el contexto de la tesis.';
        setErrors((current) => ({ ...current, thesis: message }));
        setData((current) => ({ ...current, selectedDetail: null, selectedResume: null }));
      } finally {
        if (!cancelled) {
          setLoading((current) => ({ ...current, thesis: false }));
        }
      }
    }

    void loadThesisContext();

    return () => {
      cancelled = true;
    };
  }, [data.selectedThesisId]);

  const workflowCards = useMemo(() => {
    const workflowMap = new Map((data.status?.workflows ?? []).map((workflow) => [workflow.key, workflow]));

    return WORKFLOW_ENTRY_ORDER.map((key) => workflowMap.get(key)).filter((value): value is WorkflowCapability => Boolean(value));
  }, [data.status]);

  const selectedSummary = useMemo(
    () => data.theses.find((entry) => entry.thesis.id === data.selectedThesisId) ?? null,
    [data.selectedThesisId, data.theses],
  );

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Thesis Research OS</p>
          <h1>Workflow dashboard</h1>
          <p className="lede">
            Core thesis workflows are available in local-first mode.
          </p>
          <p className="sublede">
            Dashboard, thesis detail, and resume routes now render persisted thesis-scoped data instead of route-only placeholders.
          </p>
        </div>

        <button className="refresh-button" type="button" onClick={refresh}>
          Refresh persisted state
        </button>
      </header>

      <section className="status-banner" aria-label="Local-first posture">
        <strong>Local-first posture: {data.status?.posture.state ?? 'loading'}</strong>
        <p>{data.status?.posture.summary ?? 'Cargando estado local-first...'}</p>
        <p className="status-detail">{data.status?.posture.detail ?? 'Esperando el contrato de capacidades del API.'}</p>
        {errors.status ? <p className="error-text">{errors.status}</p> : null}
      </section>

      <section className="grid" aria-label="Core workflow entry points">
        {workflowCards.map((card) => (
          <article className="card" key={card.key}>
            <h2>{card.label}</h2>
            <p className={`badge badge-${card.state}`}>{card.summary}</p>
            <p>{card.detail}</p>
          </article>
        ))}
      </section>

      <section className="workspace-layout" aria-label="Thesis workspace dashboard shell">
        <section className="panel" aria-labelledby="dashboard-heading">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Dashboard route</p>
              <h2 id="dashboard-heading">Persisted thesis workspaces</h2>
            </div>
            <span className="meta-chip">{data.theses.length} thesis records</span>
          </div>

          {loading.dashboard ? <p>Cargando tesis persistidas...</p> : null}
          {errors.dashboard ? <p className="error-text">{errors.dashboard}</p> : null}

          {!loading.dashboard && !errors.dashboard && data.theses.length === 0 ? (
            <div className="empty-state">
              <h3>No thesis workspaces yet</h3>
              <p>
                Create a thesis through the API to populate the dashboard with persisted titles, current states, and resume markers.
              </p>
            </div>
          ) : null}

          <div className="thesis-list">
            {data.theses.map((entry) => {
              const isSelected = entry.thesis.id === data.selectedThesisId;
              return (
                <button
                  key={entry.thesis.id}
                  type="button"
                  className={`thesis-card${isSelected ? ' selected' : ''}`}
                  onClick={() => setData((current) => ({ ...current, selectedThesisId: entry.thesis.id }))}
                >
                  <div className="thesis-card-header">
                    <div>
                      <h3>{entry.thesis.title}</h3>
                      <p className="card-meta">{entry.thesis.degreeProgram} · {entry.thesis.institution}</p>
                    </div>
                    <span className={`status-pill status-${entry.thesis.currentState}`}>{entry.thesis.currentState}</span>
                  </div>
                  <p className="card-copy">{entry.statusSummary}</p>
                  <ul className="marker-list">
                    <li>Next step: {entry.thesis.nextStepSummary}</li>
                    <li>Checkpoint marker: {entry.latestCheckpointId ?? 'No checkpoint yet'}</li>
                    <li>Feedback marker: {entry.latestFeedbackId ?? 'No feedback yet'}</li>
                    <li>Latest persisted status: {formatDateTime(entry.thesis.latestStatusAt)}</li>
                  </ul>
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel" aria-labelledby="detail-heading">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Thesis detail route</p>
              <h2 id="detail-heading">Requested thesis context</h2>
            </div>
            {selectedSummary ? <span className="meta-chip">thesisId: {selectedSummary.thesis.id}</span> : null}
          </div>

          {loading.thesis ? <p>Cargando detalle y resume persistidos...</p> : null}
          {errors.thesis ? <p className="error-text">{errors.thesis}</p> : null}

          {!loading.thesis && !errors.thesis && !selectedSummary ? (
            <div className="empty-state">
              <h3>Select a thesis to inspect its persisted state</h3>
              <p>The detail and resume panels stay thesis-scoped and will not fall back to an arbitrary record.</p>
            </div>
          ) : null}

          {!loading.thesis && !errors.thesis && selectedSummary && data.selectedDetail && data.selectedResume ? (
            <div className="detail-stack">
              <article className="detail-card">
                <h3>{data.selectedDetail.thesis.title}</h3>
                <p className="card-meta">slug: {data.selectedDetail.thesis.slug}</p>
                <p>{data.selectedDetail.statusSummary}</p>
                <ul className="marker-list">
                  <li>Requested thesis marker: {data.selectedDetail.thesis.id}</li>
                  <li>Active import marker: {data.selectedDetail.thesis.activeImportId ?? 'No active import yet'}</li>
                  <li>Active workspace nodes: {data.selectedDetail.activeWorkspace?.nodeCount ?? 0}</li>
                  <li>Latest build marker: {data.selectedDetail.activeWorkspace?.latestBuildRunId ?? data.selectedDetail.thesis.activeBuildRunId ?? 'No LaTeX build yet'}</li>
                </ul>
              </article>

              <article className="detail-card">
                <div className="detail-card-header">
                  <h3>Resume route</h3>
                  <span className="meta-chip">state: {data.selectedResume.thesis.currentState}</span>
                </div>
                <p>{data.selectedResume.nextAction}</p>
                <ul className="marker-list">
                  <li>Latest checkpoint marker: {data.selectedResume.latestCheckpoint?.id ?? 'No checkpoint yet'}</li>
                  <li>Latest checkpoint time: {formatDateTime(data.selectedResume.latestCheckpoint?.checkpointedAt)}</li>
                  <li>Compliance run marker: {data.selectedResume.latestComplianceRun?.id ?? 'No compliance run yet'}</li>
                  <li>Academic QA marker: {data.selectedResume.latestAcademicQaRun?.id ?? 'No academic QA run yet'}</li>
                </ul>
                <div className="signal-block">
                  <h4>Blockers / diagnostics</h4>
                  {data.selectedResume.blockers.length > 0 ? (
                    <ul className="marker-list">
                      {data.selectedResume.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                    </ul>
                  ) : (
                    <p>No blockers are persisted for this thesis yet.</p>
                  )}
                </div>
                <div className="signal-block">
                  <h4>Recent feedback</h4>
                  {data.selectedResume.recentFeedback.length > 0 ? (
                    <ul className="marker-list">
                      {data.selectedResume.recentFeedback.map((entry) => (
                        <li key={entry.id}>
                          <strong>{entry.summary ?? entry.sourceType}</strong> · {formatDateTime(entry.recordedAt)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No persisted feedback entries yet.</p>
                  )}
                </div>
              </article>
            </div>
          ) : null}
        </section>
      </section>

      <section className="integration-panel" aria-label="Degraded integrations">
        <div className="section-heading">
          <p className="eyebrow">Capability contract</p>
          <h2>Explicit degraded integration status</h2>
        </div>

        <div className="grid integration-grid">
          {(data.status?.integrations ?? []).map((integration) => (
            <article className="card integration-card" key={integration.key}>
              <div className="integration-header">
                <h3>{integration.label}</h3>
                <span className={`status-pill status-${integration.state}`}>{integration.state}</span>
              </div>
              <p className={`badge badge-${integration.state}`}>{integration.summary}</p>
              <p>{integration.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
