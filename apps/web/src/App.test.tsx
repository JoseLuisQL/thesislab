import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

import { App } from './App.js';

const capabilityPayload = {
  ok: true,
  service: 'api',
  mission: 'workflow-ui',
  timestamp: '2026-03-11T15:00:00.000Z',
  posture: {
    mode: 'local-first',
    state: 'ready',
    summary: 'Core thesis workflows are available in local-first mode.',
    detail: 'The API exposes local thesis workflow capabilities directly and keeps optional integrations in explicit degraded states instead of hiding them.',
  },
  workflows: [
    { key: 'create', label: 'Create thesis', state: 'available', summary: 'Ready', detail: 'Local thesis creation remains available without any external connector.' },
    { key: 'intake', label: 'Import thesis', state: 'available', summary: 'Ready', detail: 'Intake status is tracked as part of the local-first thesis workflow surface.' },
    { key: 'resume', label: 'Resume work', state: 'available', summary: 'Ready', detail: 'Resume posture remains available from persisted local thesis state.' },
    { key: 'latex', label: 'LaTeX workbench', state: 'available', summary: 'Ready', detail: 'LaTeX workspace operations are part of the local-first surface contract.' },
    { key: 'qa', label: 'QA review', state: 'available', summary: 'Ready', detail: 'Academic QA remains available independently of optional integrations.' },
  ],
  integrations: [
    { key: 'zotero', label: 'Zotero connector', state: 'degraded', summary: 'Mock connector only', detail: 'Zotero runs in mock mode, so local workflows remain usable while bibliography sync is explicitly degraded.' },
    { key: 'connectors', label: 'External connector adapters', state: 'degraded', summary: 'Optional adapters unavailable', detail: 'OpenClaw-specific or other connector-backed capabilities are optional and currently surfaced as degraded rather than silently disappearing.' },
  ],
};

const thesisListPayload = {
  ok: true,
  theses: [
    {
      thesis: {
        id: 'thesis-alpha',
        title: 'Arquitectura de evidencia académica',
        slug: 'arquitectura-de-evidencia-academica',
        degreeProgram: 'Máster en Ingeniería Informática',
        institution: 'Universidad Local',
        currentState: 'blocked',
        latestStatusAt: '2026-03-10T09:15:00.000Z',
        nextStepSummary: 'Resolver las observaciones metodológicas antes de continuar.',
        activeImportId: 'intake-alpha',
        activeBuildRunId: 'build-alpha',
      },
      statusSummary: 'Pendiente de comentarios del tutor.',
      blockers: ['Esperando comentarios del tutor'],
      latestCheckpointId: 'checkpoint-alpha',
      latestFeedbackId: 'feedback-alpha',
      activeWorkspace: {
        intakeJobId: 'intake-alpha',
        detectedFormat: 'latex',
        entrypoint: 'main.tex',
        nodeCount: 12,
        latestBuildRunId: 'build-alpha',
      },
    },
    {
      thesis: {
        id: 'thesis-beta',
        title: 'Continuidad de QA en tesis locales',
        slug: 'continuidad-de-qa-en-tesis-locales',
        degreeProgram: 'Doctorado en Sistemas',
        institution: 'Instituto de Pruebas',
        currentState: 'active',
        latestStatusAt: '2026-03-11T08:00:00.000Z',
        nextStepSummary: 'Preparar la siguiente reimportación controlada.',
        activeImportId: null,
        activeBuildRunId: null,
      },
      statusSummary: 'Lista para reanudar el análisis.',
      blockers: [],
      latestCheckpointId: null,
      latestFeedbackId: null,
      activeWorkspace: null,
    },
  ],
};

const thesisDetailPayload = {
  ok: true,
  thesis: thesisListPayload.theses[0],
};

const resumePayload = {
  ok: true,
  resume: {
    thesis: thesisListPayload.theses[0].thesis,
    statusSummary: 'Pendiente de comentarios del tutor.',
    blockers: ['Esperando comentarios del tutor'],
    nextAction: 'Revisa el feedback recibido y planifica la siguiente iteración.',
    latestCheckpoint: {
      id: 'checkpoint-alpha',
      label: 'Checkpoint previo a edición',
      reason: 'before-latex-edit',
      checkpointedAt: '2026-03-10T09:10:00.000Z',
    },
    recentFeedback: [
      {
        id: 'feedback-alpha',
        sourceType: 'user',
        summary: 'Revisar comentarios del tutor',
        body: 'Actualizar la metodología con base en el último feedback.',
        recordedAt: '2026-03-10T09:12:00.000Z',
      },
    ],
    latestComplianceRun: { id: 'compliance-alpha', status: 'completed_with_warnings', createdAt: '2026-03-10T09:05:00.000Z' },
    latestAcademicQaRun: { id: 'qa-alpha', status: 'completed', createdAt: '2026-03-10T09:06:00.000Z' },
    recentComplianceFindings: [
      { id: 'issue-1', severity: 'warning', title: 'Formato pendiente', message: 'Revisar el formato APA.' },
    ],
    recentAcademicQaFindings: [
      { id: 'qa-1', severity: 'warning', title: 'Evidencia débil', message: 'Falta una referencia primaria.' },
    ],
  },
};

const intakeJobPayload = {
  ok: true,
  intakeJob: {
    id: 'intake-alpha',
    thesisId: 'thesis-alpha',
    sourceFormat: 'latex',
    status: 'completed',
    importRootPath: '/workspace/tesis-alpha',
    detectedEntrypoint: 'main.tex',
    detection: {
      format: 'latex',
      reason: 'Main LaTeX file detected from reachable root document.',
      matchedBy: 'entrypoint',
    },
    report: {
      thesisId: 'thesis-alpha',
      intakeJobId: 'intake-alpha',
      terminalStatus: 'completed',
      detectedFormat: 'latex',
      detection: {
        format: 'latex',
        reason: 'Main LaTeX file detected from reachable root document.',
        matchedBy: 'entrypoint',
      },
      extractionStatus: 'completed',
      normalizationStatus: 'completed',
      structureSummary: {
        entrypoint: 'main.tex',
        itemCount: 3,
        items: ['Introducción', 'Marco teórico', 'Metodología'],
        selection: {
          mode: 'deterministic',
          reason: 'Canonical root resolved from the import boundary.',
          candidates: ['main.tex'],
        },
        includeGraph: {
          rootFile: 'main.tex',
          filesInOrder: ['main.tex', 'chapters/intro.tex', 'chapters/method.tex'],
          edges: [
            { from: 'main.tex', to: 'chapters/intro.tex', command: 'include', line: 12 },
          ],
          unresolved: [],
          blocked: [],
          cycles: [],
        },
        outline: [
          {
            id: 'node-1',
            title: 'Introducción',
            level: 1,
            nodeType: 'chapter',
            sourcePath: 'chapters/intro.tex',
            anchor: { start: '1', end: '40' },
          },
        ],
      },
      normalizationSummary: {
        nodeCount: 12,
        rootNodeIds: ['node-1'],
        provenanceCoverage: { available: 12, unavailable: 0 },
      },
      replacement: null,
      warnings: ['La bibliografía requiere una revisión manual antes de compilar.'],
      failures: [],
      recommendedNextSteps: [
        {
          code: 'REVIEW_BIBLIOGRAPHY_MAPPING',
          message: 'Revisa la bibliografía detectada antes de continuar con QA.',
          triggeredBy: ['warning:bibliography'],
        },
      ],
    },
    warnings: ['La bibliografía requiere una revisión manual antes de compilar.'],
    recommendations: [
      {
        code: 'REVIEW_BIBLIOGRAPHY_MAPPING',
        message: 'Revisa la bibliografía detectada antes de continuar con QA.',
        triggeredBy: ['warning:bibliography'],
      },
    ],
    startedAt: '2026-03-10T09:00:00.000Z',
    completedAt: '2026-03-10T09:04:00.000Z',
    createdAt: '2026-03-10T09:00:00.000Z',
    updatedAt: '2026-03-10T09:04:00.000Z',
  },
};

const sourcesPayload = {
  ok: true,
  sources: [
    {
      id: 'source-alpha',
      thesisId: 'thesis-alpha',
      sourceType: 'article',
      title: 'Evidence-grounded methodology',
      authors: ['María Citation'],
      publicationYear: 2024,
      locator: 'doi:10.1234/evidence',
      status: 'ready',
      ingest: {
        ingestStatus: 'succeeded',
        duplicateState: 'unique',
        duplicateOfSourceId: null,
        pdfExtractionStatus: 'succeeded',
        pdfMetadata: { pageCount: 18 },
        warnings: [],
        failures: [],
        signature: 'sig-source-alpha',
      },
      evidenceCount: 1,
      claimCount: 1,
      createdAt: '2026-03-10T09:01:00.000Z',
      updatedAt: '2026-03-10T09:02:00.000Z',
    },
  ],
};

const evidencePayload = {
  ok: true,
  evidenceFragments: [
    {
      id: 'evidence-alpha',
      thesisId: 'thesis-alpha',
      sourceId: 'source-alpha',
      normalizedNodeId: 'node-1',
      taskId: 'task-1',
      locator: 'p. 14',
      snippet: 'La triangulación metodológica mejora la trazabilidad de resultados.',
      extractionMethod: 'pdf-parse',
      confidence: 0.93,
      status: 'captured',
      provenance: { page: 14 },
      source: {
        id: 'source-alpha',
        title: 'Evidence-grounded methodology',
        sourceType: 'article',
        status: 'ready',
      },
      context: {
        section: { id: 'node-1', title: 'Introducción', nodeType: 'chapter' },
        task: { id: 'task-1', title: 'Relacionar evidencia', status: 'active' },
      },
      createdAt: '2026-03-10T09:03:00.000Z',
      updatedAt: '2026-03-10T09:03:00.000Z',
    },
  ],
};

const complianceRunsPayload = {
  ok: true,
  complianceRuns: [
    {
      id: 'compliance-alpha',
      thesisId: 'thesis-alpha',
      policyProfileId: 'policy-alpha',
      policyProfileVersion: '2026.1',
      policyInstitutionId: 'uni-local',
      status: 'completed_with_warnings',
      summary: {
        degradedConfidence: false,
        warnings: [],
        evaluatedNodeCount: 12,
        structureSelectionMode: 'deterministic',
      },
      counts: { evaluated: 5, warnings: 1, skipped: 0, violations: 0 },
      ruleResults: [],
      issues: [
        {
          id: 'issue-1',
          thesisId: 'thesis-alpha',
          complianceRunId: 'compliance-alpha',
          policyProfileId: 'policy-alpha',
          ruleId: 'rule-apa',
          normalizedNodeId: 'node-1',
          severity: 'warning',
          message: 'Revisar el formato APA.',
          remediation: 'Añade la versión APA requerida.',
          disposition: 'warning',
          evidenceContext: {
            sourceIds: ['source-alpha'],
            evidenceFragmentIds: ['evidence-alpha'],
            zoteroMappingIds: [],
            buildRunId: 'build-alpha',
          },
          createdAt: '2026-03-10T09:05:00.000Z',
          updatedAt: '2026-03-10T09:05:00.000Z',
        },
      ],
      startedAt: '2026-03-10T09:05:00.000Z',
      completedAt: '2026-03-10T09:05:30.000Z',
      createdAt: '2026-03-10T09:05:00.000Z',
      updatedAt: '2026-03-10T09:05:30.000Z',
    },
  ],
};

const academicQaRunsPayload = {
  ok: true,
  academicQaRuns: [
    {
      id: 'qa-alpha',
      thesisId: 'thesis-alpha',
      status: 'completed',
      issueCategories: ['citation-weakness'],
      assessedScope: {
        claimIds: ['claim-1'],
        normalizedNodeIds: ['node-1'],
        counts: { claims: 1, sections: 1 },
      },
      skippedScope: [],
      summary: {
        findingsByCategory: {
          'evidence-gap': 0,
          'citation-weakness': 1,
          methodology: 0,
          coherence: 0,
        },
        assessedClaimCount: 1,
        assessedSectionCount: 1,
        skippedCount: 0,
      },
      issues: [
        {
          id: 'qa-1',
          thesisId: 'thesis-alpha',
          academicQaRunId: 'qa-alpha',
          claimId: 'claim-1',
          normalizedNodeId: 'node-1',
          category: 'citation-weakness',
          severity: 'warning',
          message: 'Falta una referencia primaria.',
          rationale: 'La afirmación depende de una sola referencia secundaria.',
          remediation: 'Añade una referencia primaria o un fragmento de evidencia directo.',
          triggeringCondition: 'weak-citation-support',
          supportContext: {
            sourceIds: ['source-alpha'],
            evidenceFragmentIds: ['evidence-alpha'],
            zoteroMappingIds: [],
            buildRunId: 'build-alpha',
          },
          groundedIn: {
            entityType: 'claim',
            entityId: 'claim-1',
          },
          createdAt: '2026-03-10T09:06:00.000Z',
          updatedAt: '2026-03-10T09:06:00.000Z',
        },
      ],
      startedAt: '2026-03-10T09:06:00.000Z',
      completedAt: '2026-03-10T09:06:30.000Z',
      createdAt: '2026-03-10T09:06:00.000Z',
      updatedAt: '2026-03-10T09:06:30.000Z',
    },
  ],
};

function mockFetchSequence(handlers: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (!(url in handlers)) {
      return { ok: false, status: 404, json: async () => ({}) };
    }

    return {
      ok: true,
      status: 200,
      json: async () => handlers[url],
    };
  }));
}

describe('App', () => {
  beforeEach(() => {
    mockFetchSequence({
      '/status/capabilities': capabilityPayload,
      '/theses': thesisListPayload,
      '/theses/thesis-alpha': thesisDetailPayload,
      '/theses/thesis-alpha/resume': resumePayload,
      '/theses/thesis-alpha/intake-jobs/intake-alpha': intakeJobPayload,
      '/theses/thesis-alpha/intake-jobs/intake-alpha/report': { ok: true, report: intakeJobPayload.intakeJob.report },
      '/theses/thesis-alpha/sources': sourcesPayload,
      '/theses/thesis-alpha/evidence-fragments': evidencePayload,
      '/theses/thesis-alpha/compliance-runs': complianceRunsPayload,
      '/theses/thesis-alpha/academic-qa-runs': academicQaRunsPayload,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders loading-safe dashboard shell markers during server render', () => {
    const html = renderToString(<App />);

    expect(html).toContain('Workflow dashboard');
    expect(html).toContain('Persisted thesis workspaces');
    expect(html).toContain('Requested thesis context');
    expect(html).toContain('Refresh persisted state');
    expect(html).toContain('Cargando estado local-first');
  });

  it('hydrates persisted dashboard and thesis resume markers from API data', async () => {
    const container = document.createElement('div');
    document.body.append(container);

    const { createRoot } = await import('react-dom/client');
    const root = createRoot(container);
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Arquitectura de evidencia académica');
    expect(container.textContent).toContain('Pendiente de comentarios del tutor.');
    expect(container.textContent).toContain('Checkpoint marker: checkpoint-alpha');
    expect(container.textContent).toContain('Requested thesis marker: thesis-alpha');
    expect(container.textContent).toContain('Latest checkpoint marker: checkpoint-alpha');
    expect(container.textContent).toContain('Compliance run marker: compliance-alpha');
    expect(container.textContent).toContain('Academic QA marker: qa-alpha');
    expect(container.textContent).toContain('Detected input marker: latex');
    expect(container.textContent).toContain('Evidence provenance marker: p. 14');
    expect(container.textContent).toContain('QA issue marker: qa-1');
    expect(container.textContent).toContain('Mock connector only');

    root.unmount();
    container.remove();
  });

  it('renders a route-specific empty dashboard state when no thesis records exist', async () => {
    mockFetchSequence({
      '/status/capabilities': capabilityPayload,
      '/theses': { ok: true, theses: [] },
    });

    const container = document.createElement('div');
    document.body.append(container);

    const { createRoot } = await import('react-dom/client');
    const root = createRoot(container);
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('No thesis workspaces yet');
    expect(container.textContent).toContain('Create a thesis through the API to populate the dashboard');
    expect(container.textContent).toContain('Select a thesis to inspect its persisted state');

    root.unmount();
    container.remove();
  });

  it('renders route-specific empty states for intake, research, and qa views', async () => {
    mockFetchSequence({
      '/status/capabilities': capabilityPayload,
      '/theses': thesisListPayload,
      '/theses/thesis-alpha': {
        ok: true,
        thesis: {
          ...thesisListPayload.theses[0],
          thesis: { ...thesisListPayload.theses[0].thesis, activeImportId: null },
        },
      },
      '/theses/thesis-alpha/resume': {
        ok: true,
        resume: {
          ...resumePayload.resume,
          latestComplianceRun: null,
          latestAcademicQaRun: null,
          recentComplianceFindings: [],
          recentAcademicQaFindings: [],
        },
      },
      '/theses/thesis-alpha/sources': { ok: true, sources: [] },
      '/theses/thesis-alpha/evidence-fragments': { ok: true, evidenceFragments: [] },
      '/theses/thesis-alpha/compliance-runs': { ok: true, complianceRuns: [] },
      '/theses/thesis-alpha/academic-qa-runs': { ok: true, academicQaRuns: [] },
    });

    const container = document.createElement('div');
    document.body.append(container);

    const { createRoot } = await import('react-dom/client');
    const root = createRoot(container);
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('No intake report yet');
    expect(container.textContent).toContain('Start an intake import to capture detected inputs');
    expect(container.textContent).toContain('No research artifacts yet');
    expect(container.textContent).toContain('Register a source or capture an evidence fragment');
    expect(container.textContent).toContain('No QA or compliance findings yet');
    expect(container.textContent).toContain('Run compliance and academic QA checks');

    root.unmount();
    container.remove();
  });

  it('keeps route shells usable with recoverable error states when intake, research, or qa requests fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === '/status/capabilities') {
        return { ok: true, status: 200, json: async () => capabilityPayload };
      }
      if (url === '/theses') {
        return { ok: true, status: 200, json: async () => thesisListPayload };
      }
      if (url === '/theses/thesis-alpha') {
        return { ok: true, status: 200, json: async () => thesisDetailPayload };
      }
      if (url === '/theses/thesis-alpha/resume') {
        return { ok: true, status: 200, json: async () => resumePayload };
      }

      return { ok: false, status: 503, json: async () => ({}) };
    }));

    const container = document.createElement('div');
    document.body.append(container);

    const { createRoot } = await import('react-dom/client');
    const root = createRoot(container);
    await act(async () => {
      root.render(<App />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Intake report unavailable');
    expect(container.textContent).toContain('Retry the intake route after the import service recovers');
    expect(container.textContent).toContain('Research route unavailable');
    expect(container.textContent).toContain('The source/evidence shell remains available while the research API recovers');
    expect(container.textContent).toContain('QA route unavailable');
    expect(container.textContent).toContain('Retry compliance and academic QA once the analysis endpoints recover');

    root.unmount();
    container.remove();
  });
});
