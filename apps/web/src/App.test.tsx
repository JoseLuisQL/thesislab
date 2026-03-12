import { renderToString } from 'react-dom/server';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import { AppProviders, createAppQueryClient } from './providers.js';
import { useThesisStore } from './stores/thesis.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const capabilityPayload = {
  ok: true,
  service: 'api',
  mission: 'workflow-ui',
  timestamp: '2026-03-11T15:00:00.000Z',
  posture: {
    mode: 'local-first',
    state: 'ready',
    summary: 'Core thesis workflows are available in local-first mode.',
  },
  workflows: [
    { key: 'create', label: 'Create thesis', state: 'available', summary: 'Ready', detail: 'Ready', kind: 'core', localFirst: true },
    { key: 'intake', label: 'Import thesis', state: 'available', summary: 'Ready', detail: 'Ready', kind: 'core', localFirst: true },
    { key: 'resume', label: 'Resume work', state: 'available', summary: 'Ready', detail: 'Ready', kind: 'core', localFirst: true },
    { key: 'latex', label: 'LaTeX workbench', state: 'available', summary: 'Ready', detail: 'Ready', kind: 'core', localFirst: true },
  ],
  integrations: [
    { key: 'zotero', label: 'Zotero connector', state: 'degraded', summary: 'Mock connector only', detail: 'Mock connector only', kind: 'integration', optional: true },
  ],
};

const policyProfilesPayload = {
  ok: true,
  policyProfiles: [
    {
      id: 'policy-pucp',
      institution: 'PUCP',
      faculty: 'FCI',
      version: '2026.1',
      title: 'PUCP FCI',
      requiredSections: ['Introducción', 'Metodología'],
      isActive: true,
    },
  ],
};

const openClawStatusPayload = {
  ok: true,
  status: {
    installed: true,
    statusAvailable: true,
    configPath: 'C:\\Users\\jquis\\.openclaw\\openclaw.json',
    gatewayUrl: 'ws://127.0.0.1:18789',
    gatewayReachable: true,
    gatewayError: null,
    defaultAgentId: 'main',
    agents: [
      {
        id: 'main',
        workspace: 'C:\\Users\\jquis\\.openclaw\\workspace',
        agentDir: 'C:\\Users\\jquis\\.openclaw\\agents\\main\\agent',
        isDefault: true,
        routes: ['default (no explicit rules)'],
        bindingDetails: [],
      },
      {
        id: 'research',
        workspace: 'C:\\Users\\jquis\\.openclaw\\agents\\research\\workspace',
        agentDir: 'C:\\Users\\jquis\\.openclaw\\agents\\research\\agent',
        isDefault: false,
        routes: ['research routing'],
        bindingDetails: [],
      },
    ],
    issues: [],
  },
};

const thesisSummary = {
  thesis: {
    id: 'thesis-alpha',
    title: 'Arquitectura de evidencia académica',
    slug: 'arquitectura-de-evidencia-academica',
    degreeProgram: 'Máster en Ingeniería Informática',
    institution: 'PUCP',
    workspacePath: 'C:\\tesis\\alpha',
    defaultLanguage: 'es',
    currentState: 'active',
    latestStatusAt: '2026-03-11T08:00:00.000Z',
    nextStepSummary: 'Revisar metodología.',
    activeImportId: 'intake-alpha',
    activeBuildRunId: 'build-alpha',
    openClawAgentId: 'main',
    openClawSessionKey: null,
    policyProfileId: 'policy-pucp',
    officialWorkspacePath: 'C:\\tesis\\alpha\\managed-latex',
    officialEntrypoint: 'main.tex',
    createdAt: '2026-03-10T08:00:00.000Z',
    updatedAt: '2026-03-11T08:00:00.000Z',
  },
  state: 'active',
  latestStatusAt: '2026-03-11T08:00:00.000Z',
  statusSummary: 'Lista para continuar.',
  blockers: [],
  nextStepSummary: 'Revisar metodología.',
  checkpointCount: 2,
  feedbackCount: 1,
  latestCheckpointId: 'checkpoint-alpha',
  latestFeedbackId: 'feedback-alpha',
  activeWorkspace: {
    intakeJobId: 'intake-alpha',
    detectedFormat: 'latex',
    entrypoint: 'main.tex',
    nodeCount: 12,
    latestBuildRunId: 'build-alpha',
  },
  transitions: [],
};

const thesesPayload = {
  ok: true,
  theses: [thesisSummary],
};

const thesisDetailPayload = {
  ok: true,
  thesis: thesisSummary,
};

const resumePayload = {
  ok: true,
  resume: {
    thesis: thesisSummary.thesis,
    statusSummary: 'Lista para continuar.',
    blockers: [],
    nextAction: 'Actualizar la metodología.',
    latestCheckpoint: {
      id: 'checkpoint-alpha',
      label: 'Antes de edición',
      reason: 'before-latex-edit',
      checkpointedAt: '2026-03-11T08:05:00.000Z',
    },
    recentFeedback: [],
    latestComplianceRun: null,
    latestAcademicQaRun: null,
    recentComplianceFindings: [],
    recentAcademicQaFindings: [],
  },
};

const workflowPacksPayload = {
  ok: true,
  workflowPacks: [
    {
      id: 'pack-1',
      name: 'Intake',
      description: 'Normalize imported material.',
      status: 'in_progress',
      openClawAgentId: null,
      openClawSessionKey: null,
      progress: { totalSteps: 4, completedSteps: 2, blockedSteps: 0 },
      steps: [{ id: 'step-1', title: 'Detect format', description: 'Detect', status: 'completed', isCurrent: false }],
    },
  ],
};

const openClawAssignmentPayload = {
  ok: true,
  assignment: {
    thesisId: 'thesis-alpha',
    thesisTarget: {
      agentId: 'main',
      sessionKey: null,
    },
    workflowPackTargets: [
      {
        workflowPackId: 'pack-1',
        name: 'Intake',
        status: 'in_progress',
        agentId: null,
        sessionKey: null,
      },
    ],
  },
};

const latexStructurePayload = {
  ok: true,
  structure: {
    entrypoint: 'main.tex',
    selection: {
      mode: 'deterministic',
      reason: 'single root',
      candidates: ['main.tex'],
    },
    includeGraph: null,
    outline: [
      {
        normalizedNodeId: 'node-1',
        title: 'Introducción',
        nodeType: 'chapter',
        sourcePath: 'chapters/intro.tex',
        anchor: { start: '1', end: '20' },
        level: 1,
      },
    ],
  },
};

const latexSectionPayload = {
  ok: true,
  section: {
    node: latexStructurePayload.structure.outline[0],
    content: '\\chapter{Introducción}\nContenido base.',
  },
};

const latexBuildsPayload = {
  ok: true,
  history: {
    runs: [],
  },
};

function renderApp() {
  return (
    <AppProviders client={createAppQueryClient()}>
      <App />
    </AppProviders>
  );
}

async function renderClientApp(container: HTMLElement) {
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(container);

  await act(async () => {
    root.render(renderApp());
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 240));
  });

  return {
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

function mockFetchSequence(handlers: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (!(url in handlers)) {
      return {
        ok: false,
        status: 404,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: `Unhandled mock for ${url}` }),
      };
    }

    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => handlers[url],
    };
  }));
}

describe('App', () => {
  beforeEach(() => {
    useThesisStore.getState().setSelectedThesisId(null);
    window.history.pushState({}, '', '/');
    mockFetchSequence({
      '/status/capabilities': capabilityPayload,
      '/openclaw/status': openClawStatusPayload,
      '/policy-profiles': policyProfilesPayload,
      '/theses': thesesPayload,
      '/theses/thesis-alpha': thesisDetailPayload,
      '/theses/thesis-alpha/openclaw-assignment': openClawAssignmentPayload,
      '/theses/thesis-alpha/resume': resumePayload,
      '/theses/thesis-alpha/workflow-packs': workflowPacksPayload,
      '/theses/thesis-alpha/latex/structure': latexStructurePayload,
      '/theses/thesis-alpha/latex/sections/node-1': latexSectionPayload,
      '/theses/thesis-alpha/latex/builds': latexBuildsPayload,
    });
  });

  afterEach(() => {
    useThesisStore.getState().setSelectedThesisId(null);
    vi.unstubAllGlobals();
  });

  it('renders the mission-control shell safely during server render', () => {
    const html = renderToString(renderApp());

    expect(html).toContain('Mission Control');
    expect(html).toContain('Create Thesis');
    expect(html).toContain('Thesis Registry');
  });

  it('hydrates dashboard data and active thesis markers from the API', async () => {
    const container = document.createElement('div');
    document.body.append(container);

    const root = await renderClientApp(container);

    expect(container.textContent).toContain('Ship the thesis, not just the chat.');
    expect(container.textContent).toContain('Arquitectura de evidencia académica');
    expect(container.textContent).toContain('PUCP FCI');

    await root.unmount();
    container.remove();
  });

  it('renders the empty registry state when no thesis records exist', async () => {
    mockFetchSequence({
      '/status/capabilities': capabilityPayload,
      '/openclaw/status': openClawStatusPayload,
      '/policy-profiles': policyProfilesPayload,
      '/theses': { ok: true, theses: [] },
    });

    const container = document.createElement('div');
    document.body.append(container);

    const root = await renderClientApp(container);

    expect(container.textContent).toContain('No thesis project exists yet.');

    await root.unmount();
    container.remove();
  });

  it('opens the LaTeX workbench with live structure when a thesis is available', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    window.history.pushState({}, '', '/latex');

    const root = await renderClientApp(container);

    expect(container.textContent).toContain('LaTeX workbench');
    expect(container.textContent).toContain('Introducción');
    expect(container.textContent).toContain('Official Document');

    await root.unmount();
    container.remove();
  });

  it('keeps the shell usable when the API is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 503,
      headers: { get: () => 'application/json' },
      json: async () => ({ message: 'Service unavailable' }),
    })));

    const container = document.createElement('div');
    document.body.append(container);

    const root = await renderClientApp(container);

    expect(container.textContent).toContain('API offline');
    expect(container.textContent).toContain('Create thesis');

    await root.unmount();
    container.remove();
  });
});
