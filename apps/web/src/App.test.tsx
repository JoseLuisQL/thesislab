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
});
