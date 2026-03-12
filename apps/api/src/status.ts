import { detectRuntimeEnvironment } from '@thesis-research-os/runtime';

type CapabilityState = 'available' | 'degraded' | 'unavailable';
type CapabilityKind = 'core' | 'integration';

type WorkflowKey = 'create' | 'intake' | 'resume' | 'latex' | 'qa';
type IntegrationKey = 'zotero' | 'connectors' | 'mcp' | 'crossref';

export type WorkflowCapability = {
  key: WorkflowKey;
  label: string;
  state: CapabilityState;
  kind: CapabilityKind;
  localFirst: true;
  summary: string;
  detail: string;
};

export type IntegrationCapability = {
  key: IntegrationKey;
  label: string;
  state: CapabilityState;
  kind: CapabilityKind;
  optional: true;
  summary: string;
  detail: string;
};

export type IntegrationStatusSnapshot = {
  key: IntegrationKey;
  state: CapabilityState;
  summary: string;
  detail: string;
};

export type WorkflowStatusSnapshot = {
  key: WorkflowKey;
  state: CapabilityState;
  summary: string;
  detail: string;
};

export type LocalFirstStatusOptions = {
  mission?: string;
  workflowOverrides?: Partial<Record<WorkflowKey, WorkflowStatusSnapshot>>;
  integrationOverrides?: Partial<Record<IntegrationKey, IntegrationStatusSnapshot>>;
};

export type LocalFirstStatusPayload = {
  ok: true;
  service: 'api';
  mission: string;
  timestamp: string;
  posture: {
    mode: 'local-first';
    state: 'ready';
    summary: string;
    detail: string;
  };
  workflows: WorkflowCapability[];
  integrations: IntegrationCapability[];
};

const defaultMission = 'hardening';

export function buildLocalFirstStatusPayload(options: LocalFirstStatusOptions = {}): LocalFirstStatusPayload {
  const timestamp = new Date().toISOString();
  const zoteroMode = process.env.ZOTERO_CONNECTOR_MODE?.trim() || 'mock';
  const runtimeEnvironment = detectRuntimeEnvironment();
  const workflowDefaults: Record<WorkflowKey, WorkflowStatusSnapshot> = {
    create: {
      key: 'create',
      state: 'available',
      summary: 'Ready',
      detail: 'Local thesis creation remains available without any external connector.',
    },
    intake: {
      key: 'intake',
      state: 'available',
      summary: 'Ready',
      detail: 'Intake status is tracked as part of the local-first thesis workflow surface.',
    },
    resume: {
      key: 'resume',
      state: 'available',
      summary: 'Ready',
      detail: 'Resume posture remains available from persisted local thesis state.',
    },
    latex: {
      key: 'latex',
      state: 'available',
      summary: 'Ready',
      detail: 'LaTeX workspace operations are part of the local-first surface contract.',
    },
    qa: {
      key: 'qa',
      state: 'available',
      summary: 'Ready',
      detail: 'Academic QA remains available independently of optional integrations.',
    },
  };
  const zoteroCapability = runtimeEnvironment.capabilities.zotero;
  const openClawCapability = runtimeEnvironment.capabilities.openclaw;
  const playwrightCapability = runtimeEnvironment.capabilities.playwright;
  const pandocCapability = runtimeEnvironment.capabilities.pandoc;
  const libreOfficeCapability = runtimeEnvironment.capabilities.libreoffice;
  const latexCapability = runtimeEnvironment.capabilities.latex;
  const ocrCapability = runtimeEnvironment.capabilities.ocr;
  const mcpCapability = runtimeEnvironment.capabilities.mcp;
  const crossrefCapability = runtimeEnvironment.capabilities.crossref;

  const integrationDefaults: Record<IntegrationKey, IntegrationStatusSnapshot> = {
    zotero: {
      key: 'zotero',
      state: zoteroCapability.state,
      summary: zoteroCapability.summary,
      detail: zoteroCapability.detail,
    },
    connectors: {
      key: 'connectors',
      state: openClawCapability.state === 'available' || playwrightCapability.state === 'available'
        || pandocCapability.state === 'available' || libreOfficeCapability.state === 'available'
        || latexCapability.state === 'available' || ocrCapability.state === 'available'
        ? 'available'
        : 'degraded',
      summary: openClawCapability.state === 'available'
        ? 'Runtime adapters configured'
        : 'Runtime adapters partially configured',
      detail: [
        `OpenClaw: ${openClawCapability.summary}.`,
        `Playwright: ${playwrightCapability.summary}.`,
        `Pandoc: ${pandocCapability.summary}.`,
        `LibreOffice: ${libreOfficeCapability.summary}.`,
        `LaTeX: ${latexCapability.summary}.`,
        `OCR: ${ocrCapability.summary}.`,
      ].join(' '),
    },
    mcp: {
      key: 'mcp',
      state: mcpCapability.state,
      summary: mcpCapability.summary,
      detail: mcpCapability.state === 'available'
        ? 'The MCP server package (@thesis-research-os/mcp-server) is installed. Run with: npx thesis-mcp'
        : mcpCapability.detail,
    },
    crossref: {
      key: 'crossref',
      state: crossrefCapability.state,
      summary: crossrefCapability.summary,
      detail: `${crossrefCapability.detail} Use GET /resolve-doi?doi=... to resolve.`,
    },
  };
  const workflows = {
    ...workflowDefaults,
    ...(options.workflowOverrides ?? {}),
  };
  const integrations = {
    ...integrationDefaults,
    ...(options.integrationOverrides ?? {}),
  };

  return {
    ok: true,
    service: 'api',
    mission: options.mission ?? defaultMission,
    timestamp,
    posture: {
      mode: 'local-first',
      state: 'ready',
      summary: 'Core thesis workflows are available in local-first mode.',
      detail:
        'The API exposes local thesis workflow capabilities directly and reports runtime/toolchain readiness from the real machine instead of hard-coded optimistic defaults.',
    },
    workflows: [
      {
        key: 'create',
        label: 'Create thesis',
        state: workflows.create.state,
        kind: 'core',
        localFirst: true,
        summary: workflows.create.summary,
        detail: workflows.create.detail,
      },
      {
        key: 'intake',
        label: 'Import thesis',
        state: workflows.intake.state,
        kind: 'core',
        localFirst: true,
        summary: workflows.intake.summary,
        detail: workflows.intake.detail,
      },
      {
        key: 'resume',
        label: 'Resume work',
        state: workflows.resume.state,
        kind: 'core',
        localFirst: true,
        summary: workflows.resume.summary,
        detail: workflows.resume.detail,
      },
      {
        key: 'latex',
        label: 'LaTeX workbench',
        state: workflows.latex.state,
        kind: 'core',
        localFirst: true,
        summary: workflows.latex.summary,
        detail: workflows.latex.detail,
      },
      {
        key: 'qa',
        label: 'QA review',
        state: workflows.qa.state,
        kind: 'core',
        localFirst: true,
        summary: workflows.qa.summary,
        detail: workflows.qa.detail,
      },
    ],
    integrations: [
      {
        key: 'zotero',
        label: 'Zotero connector',
        state: integrations.zotero.state,
        kind: 'integration',
        optional: true,
        summary: integrations.zotero.summary,
        detail: integrations.zotero.detail,
      },
      {
        key: 'connectors',
        label: 'External connector adapters',
        state: integrations.connectors.state,
        kind: 'integration',
        optional: true,
        summary: integrations.connectors.summary,
        detail: integrations.connectors.detail,
      },
      {
        key: 'mcp',
        label: 'MCP Server',
        state: integrations.mcp.state,
        kind: 'integration',
        optional: true,
        summary: integrations.mcp.summary,
        detail: integrations.mcp.detail,
      },
      {
        key: 'crossref',
        label: 'Crossref DOI resolver',
        state: integrations.crossref.state,
        kind: 'integration',
        optional: true,
        summary: integrations.crossref.summary,
        detail: integrations.crossref.detail,
      },
    ],
  };
}
