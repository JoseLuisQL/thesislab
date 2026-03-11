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

type IntakeRecommendation = {
  code: string;
  message: string;
  triggeredBy: string[];
};

type IntakeReport = {
  thesisId: string;
  intakeJobId: string;
  terminalStatus: string;
  detectedFormat: string;
  detection: {
    format: string;
    reason: string;
    matchedBy: string;
  };
  extractionStatus: string;
  normalizationStatus: string;
  structureSummary: {
    entrypoint: string | null;
    itemCount: number;
    items: string[];
  } | null;
  normalizationSummary: {
    nodeCount: number;
    provenanceCoverage: {
      available: number;
      unavailable: number;
    };
  } | null;
  warnings: string[];
  failures: Array<{ code: string; message: string }>;
  recommendedNextSteps: IntakeRecommendation[];
};

type IntakeJobResponse = {
  ok: true;
  intakeJob: {
    id: string;
    detectedEntrypoint: string | null;
    report: IntakeReport | null;
  };
};

type IntakeReportResponse = {
  ok: true;
  report: IntakeReport;
};

type SourceRecord = {
  id: string;
  title: string;
  sourceType: string;
  locator: string | null;
  status: string;
  authors: string[];
  publicationYear: number | null;
  evidenceCount: number;
  claimCount: number;
  ingest: {
    ingestStatus: string;
    pdfExtractionStatus: string;
    warnings: string[];
  };
};

type SourcesResponse = {
  ok: true;
  sources: SourceRecord[];
};

type EvidenceRecord = {
  id: string;
  locator: string | null;
  snippet: string;
  extractionMethod: string;
  status: string;
  source: {
    id: string;
    title: string;
    sourceType: string;
    status: string;
  };
  context: {
    section: { id: string; title: string | null; nodeType: string } | null;
    task: { id: string; title: string; status: string } | null;
  };
};

type EvidenceResponse = {
  ok: true;
  evidenceFragments: EvidenceRecord[];
};

type ComplianceIssue = {
  id: string;
  severity: string;
  message: string;
  remediation: string | null;
  normalizedNodeId: string | null;
};

type ComplianceRun = {
  id: string;
  status: string;
  issues: ComplianceIssue[];
};

type ComplianceRunsResponse = {
  ok: true;
  complianceRuns: ComplianceRun[];
};

type AcademicQaIssue = {
  id: string;
  category: string;
  severity: string;
  message: string;
  rationale: string;
  remediation: string | null;
  groundedIn: {
    entityType: string;
    entityId: string;
  };
};

type AcademicQaRun = {
  id: string;
  status: string;
  issues: AcademicQaIssue[];
};

type AcademicQaRunsResponse = {
  ok: true;
  academicQaRuns: AcademicQaRun[];
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
  selectedIntakeJob: IntakeJobResponse['intakeJob'] | null;
  selectedIntakeReport: IntakeReport | null;
  selectedSources: SourceRecord[];
  selectedEvidence: EvidenceRecord[];
  selectedComplianceRuns: ComplianceRun[];
  selectedAcademicQaRuns: AcademicQaRun[];
};

type LoadingState = {
  status: boolean;
  dashboard: boolean;
  thesis: boolean;
  intake: boolean;
  research: boolean;
  qa: boolean;
};

type ErrorState = {
  status: string | null;
  dashboard: string | null;
  thesis: string | null;
  intake: string | null;
  research: string | null;
  qa: string | null;
};

const WORKFLOW_ENTRY_ORDER: WorkflowKey[] = ['create', 'intake', 'resume', 'latex', 'qa'];

const emptyDataState: AppDataState = {
  status: null,
  theses: [],
  selectedThesisId: null,
  selectedDetail: null,
  selectedResume: null,
  selectedIntakeJob: null,
  selectedIntakeReport: null,
  selectedSources: [],
  selectedEvidence: [],
  selectedComplianceRuns: [],
  selectedAcademicQaRuns: [],
};

const emptyLoadingState: LoadingState = {
  status: true,
  dashboard: true,
  thesis: false,
  intake: false,
  research: false,
  qa: false,
};

const emptyErrorState: ErrorState = {
  status: null,
  dashboard: null,
  thesis: null,
  intake: null,
  research: null,
  qa: null,
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

function formatSentenceList(values: string[]) {
  return values.join(' · ');
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
      setLoading({ status: true, dashboard: true, thesis: false, intake: false, research: false, qa: false });
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
          selectedIntakeJob: null,
          selectedIntakeReport: null,
          selectedSources: [],
          selectedEvidence: [],
          selectedComplianceRuns: [],
          selectedAcademicQaRuns: [],
        });
        setLoading({
          status: false,
          dashboard: false,
          thesis: Boolean(selectedThesisId),
          intake: Boolean(selectedThesisId),
          research: Boolean(selectedThesisId),
          qa: Boolean(selectedThesisId),
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : 'No fue posible cargar el dashboard.';
        setErrors({ status: message, dashboard: message, thesis: null, intake: null, research: null, qa: null });
        setLoading({ status: false, dashboard: false, thesis: false, intake: false, research: false, qa: false });
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
      setData((current) => ({
        ...current,
        selectedDetail: null,
        selectedResume: null,
        selectedIntakeJob: null,
        selectedIntakeReport: null,
        selectedSources: [],
        selectedEvidence: [],
        selectedComplianceRuns: [],
        selectedAcademicQaRuns: [],
      }));
      return;
    }

    let cancelled = false;
    const thesisId = data.selectedThesisId;

    async function loadThesisContext() {
      setLoading((current) => ({ ...current, thesis: true, intake: true, research: true, qa: true }));
      setErrors((current) => ({ ...current, thesis: null, intake: null, research: null, qa: null }));

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

        const activeImportId = detailResponse.thesis.thesis.activeImportId;

        const intakePromise = activeImportId
          ? Promise.all([
              getJson<IntakeJobResponse>(`/theses/${thesisId}/intake-jobs/${activeImportId}`),
              getJson<IntakeReportResponse>(`/theses/${thesisId}/intake-jobs/${activeImportId}/report`),
            ])
          : Promise.resolve(null);

        const researchPromise = Promise.all([
          getJson<SourcesResponse>(`/theses/${thesisId}/sources`),
          getJson<EvidenceResponse>(`/theses/${thesisId}/evidence-fragments`),
        ]);

        const qaPromise = Promise.all([
          getJson<ComplianceRunsResponse>(`/theses/${thesisId}/compliance-runs`),
          getJson<AcademicQaRunsResponse>(`/theses/${thesisId}/academic-qa-runs`),
        ]);

        const [intakeResult, researchResult, qaResult] = await Promise.allSettled([
          intakePromise,
          researchPromise,
          qaPromise,
        ]);

        if (cancelled) {
          return;
        }

        if (intakeResult.status === 'fulfilled') {
          setData((current) => ({
            ...current,
            selectedIntakeJob: intakeResult.value?.[0].intakeJob ?? null,
            selectedIntakeReport: intakeResult.value?.[1].report ?? null,
          }));
        } else {
          setErrors((current) => ({
            ...current,
            intake: 'Intake report unavailable. Retry the intake route after the import service recovers.',
          }));
          setData((current) => ({ ...current, selectedIntakeJob: null, selectedIntakeReport: null }));
        }

        if (researchResult.status === 'fulfilled') {
          setData((current) => ({
            ...current,
            selectedSources: researchResult.value[0].sources,
            selectedEvidence: researchResult.value[1].evidenceFragments,
          }));
        } else {
          setErrors((current) => ({
            ...current,
            research: 'Research route unavailable. The source/evidence shell remains available while the research API recovers.',
          }));
          setData((current) => ({ ...current, selectedSources: [], selectedEvidence: [] }));
        }

        if (qaResult.status === 'fulfilled') {
          setData((current) => ({
            ...current,
            selectedComplianceRuns: qaResult.value[0].complianceRuns,
            selectedAcademicQaRuns: qaResult.value[1].academicQaRuns,
          }));
        } else {
          setErrors((current) => ({
            ...current,
            qa: 'QA route unavailable. Retry compliance and academic QA once the analysis endpoints recover.',
          }));
          setData((current) => ({ ...current, selectedComplianceRuns: [], selectedAcademicQaRuns: [] }));
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : 'No fue posible cargar el contexto de la tesis.';
        setErrors((current) => ({ ...current, thesis: message, intake: null, research: null, qa: null }));
        setData((current) => ({
          ...current,
          selectedDetail: null,
          selectedResume: null,
          selectedIntakeJob: null,
          selectedIntakeReport: null,
          selectedSources: [],
          selectedEvidence: [],
          selectedComplianceRuns: [],
          selectedAcademicQaRuns: [],
        }));
      } finally {
        if (!cancelled) {
          setLoading((current) => ({ ...current, thesis: false, intake: false, research: false, qa: false }));
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

      <section className="route-grid" aria-label="Domain views">
        <section className="panel" aria-labelledby="intake-heading">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Intake report route</p>
              <h2 id="intake-heading">Detected inputs and normalization guidance</h2>
            </div>
            {data.selectedIntakeJob ? <span className="meta-chip">intakeId: {data.selectedIntakeJob.id}</span> : null}
          </div>

          {loading.intake ? <p>Cargando reporte de intake...</p> : null}
          {errors.intake ? <div className="error-state"><h3>Intake report unavailable</h3><p>{errors.intake}</p></div> : null}

          {!loading.intake && !errors.intake && !data.selectedIntakeReport ? (
            <div className="empty-state">
              <h3>No intake report yet</h3>
              <p>Start an intake import to capture detected inputs, structure summaries, warnings, and recommended next steps.</p>
            </div>
          ) : null}

          {!loading.intake && !errors.intake && data.selectedIntakeReport ? (
            <div className="detail-stack">
              <article className="detail-card">
                <h3>Import summary</h3>
                <ul className="marker-list">
                  <li>Detected input marker: {data.selectedIntakeReport.detectedFormat}</li>
                  <li>Entrypoint marker: {data.selectedIntakeJob?.detectedEntrypoint ?? data.selectedIntakeReport.structureSummary?.entrypoint ?? 'No entrypoint detected'}</li>
                  <li>Extraction status: {data.selectedIntakeReport.extractionStatus}</li>
                  <li>Normalization status: {data.selectedIntakeReport.normalizationStatus}</li>
                </ul>
                <p>{data.selectedIntakeReport.detection.reason}</p>
              </article>

              <article className="detail-card">
                <h3>Structure summary</h3>
                {data.selectedIntakeReport.structureSummary ? (
                  <>
                    <p>{data.selectedIntakeReport.structureSummary.itemCount} items detected inside the requested thesis import.</p>
                    <p className="card-meta">{formatSentenceList(data.selectedIntakeReport.structureSummary.items)}</p>
                  </>
                ) : (
                  <p>No structure summary was persisted for this intake yet.</p>
                )}
                {data.selectedIntakeReport.normalizationSummary ? (
                  <ul className="marker-list">
                    <li>Normalized node marker: {data.selectedIntakeReport.normalizationSummary.nodeCount}</li>
                    <li>Available provenance markers: {data.selectedIntakeReport.normalizationSummary.provenanceCoverage.available}</li>
                  </ul>
                ) : null}
              </article>

              <article className="detail-card">
                <h3>Warnings and recommendations</h3>
                {data.selectedIntakeReport.warnings.length > 0 ? (
                  <ul className="marker-list">
                    {data.selectedIntakeReport.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                ) : (
                  <p>No intake warnings were persisted for this thesis.</p>
                )}
                {data.selectedIntakeReport.recommendedNextSteps.length > 0 ? (
                  <ul className="marker-list">
                    {data.selectedIntakeReport.recommendedNextSteps.map((step) => (
                      <li key={step.code}>
                        <strong>{step.code}</strong>: {step.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No tailored next-step recommendations were persisted yet.</p>
                )}
              </article>
            </div>
          ) : null}
        </section>

        <section className="panel" aria-labelledby="research-heading">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Source and evidence route</p>
              <h2 id="research-heading">Traceable research artifacts</h2>
            </div>
            <span className="meta-chip">{data.selectedSources.length + data.selectedEvidence.length} research records</span>
          </div>

          {loading.research ? <p>Cargando artefactos de investigación...</p> : null}
          {errors.research ? <div className="error-state"><h3>Research route unavailable</h3><p>{errors.research}</p></div> : null}

          {!loading.research && !errors.research && data.selectedSources.length === 0 && data.selectedEvidence.length === 0 ? (
            <div className="empty-state">
              <h3>No research artifacts yet</h3>
              <p>Register a source or capture an evidence fragment to inspect provenance, section context, and thesis-linked support.</p>
            </div>
          ) : null}

          {!loading.research && !errors.research && (data.selectedSources.length > 0 || data.selectedEvidence.length > 0) ? (
            <div className="detail-stack">
              <article className="detail-card">
                <h3>Sources</h3>
                <ul className="marker-list">
                  {data.selectedSources.map((source) => (
                    <li key={source.id}>
                      <strong>{source.title}</strong> · {source.sourceType} · status {source.status} · evidence {source.evidenceCount}
                    </li>
                  ))}
                </ul>
              </article>

              <article className="detail-card">
                <h3>Evidence fragments</h3>
                <ul className="marker-list">
                  {data.selectedEvidence.map((evidence) => (
                    <li key={evidence.id}>
                      <strong>Evidence provenance marker: {evidence.locator ?? 'No locator'}</strong> · {evidence.extractionMethod} · {evidence.context.section?.title ?? 'No section context'}
                    </li>
                  ))}
                </ul>
                {data.selectedEvidence[0] ? <p>{data.selectedEvidence[0].snippet}</p> : null}
              </article>
            </div>
          ) : null}
        </section>

        <section className="panel" aria-labelledby="qa-heading">
          <div className="panel-header">
            <div>
              <p className="eyebrow">QA and compliance route</p>
              <h2 id="qa-heading">Issues, severity, and remediation context</h2>
            </div>
            <span className="meta-chip">{data.selectedComplianceRuns.length + data.selectedAcademicQaRuns.length} runs</span>
          </div>

          {loading.qa ? <p>Cargando hallazgos de QA y compliance...</p> : null}
          {errors.qa ? <div className="error-state"><h3>QA route unavailable</h3><p>{errors.qa}</p></div> : null}

          {!loading.qa && !errors.qa && data.selectedComplianceRuns.length === 0 && data.selectedAcademicQaRuns.length === 0 ? (
            <div className="empty-state">
              <h3>No QA or compliance findings yet</h3>
              <p>Run compliance and academic QA checks to surface severity, explanation, and affected thesis areas.</p>
            </div>
          ) : null}

          {!loading.qa && !errors.qa && (data.selectedComplianceRuns.length > 0 || data.selectedAcademicQaRuns.length > 0) ? (
            <div className="detail-stack">
              <article className="detail-card">
                <h3>Compliance findings</h3>
                {data.selectedComplianceRuns[0]?.issues.length ? (
                  <ul className="marker-list">
                    {data.selectedComplianceRuns[0].issues.map((issue) => (
                      <li key={issue.id}>
                        <strong>{issue.severity}</strong> · {issue.message} · affected node {issue.normalizedNodeId ?? 'thesis-wide'}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No compliance issues were persisted for the latest run.</p>
                )}
              </article>

              <article className="detail-card">
                <h3>Academic QA findings</h3>
                {data.selectedAcademicQaRuns[0]?.issues.length ? (
                  <ul className="marker-list">
                    {data.selectedAcademicQaRuns[0].issues.map((issue) => (
                      <li key={issue.id}>
                        <strong>QA issue marker: {issue.id}</strong> · {issue.category} · {issue.severity} · {issue.groundedIn.entityType} {issue.groundedIn.entityId}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No academic QA issues were persisted for the latest run.</p>
                )}
                {data.selectedAcademicQaRuns[0]?.issues[0] ? <p>{data.selectedAcademicQaRuns[0].issues[0].rationale}</p> : null}
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
