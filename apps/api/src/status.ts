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
  const zoteroApiKey = process.env.ZOTERO_API_KEY?.trim();
  const mcpAvailable = true; // MCP server package is installed
  const crossrefAvailable = true; // Crossref is a public API, always available

  const integrationDefaults: Record<IntegrationKey, IntegrationStatusSnapshot> = {
    zotero: {
      key: 'zotero',
      state: (zoteroMode === 'live' && zoteroApiKey) || zoteroMode === 'local' ? 'available' : 'degraded',
      summary: zoteroMode === 'local' ? 'Connected to Zotero desktop' : zoteroMode === 'live' && zoteroApiKey ? 'Live connector active' : zoteroMode === 'mock' ? 'Mock connector only' : 'Connector not fully attached',
      detail:
        zoteroMode === 'local'
          ? 'Zotero connector is using the local desktop API at localhost:23119. No API key needed.'
          : zoteroMode === 'live' && zoteroApiKey
          ? 'Zotero connector is using the live Web API v3 with your API key.'
          : zoteroMode === 'mock'
          ? 'Zotero runs in mock mode, so local workflows remain usable while bibliography sync is explicitly degraded.'
          : `Zotero connector mode "${zoteroMode}" is configured, but the connector-backed capability is still treated as an optional degraded integration.`,
    },
    connectors: {
      key: 'connectors',
      state: 'degraded',
      summary: 'Optional adapters unavailable',
      detail:
        'OpenClaw-specific or other connector-backed capabilities are optional and currently surfaced as degraded rather than silently disappearing.',
    },
    mcp: {
      key: 'mcp',
      state: mcpAvailable ? 'available' : 'unavailable',
      summary: mcpAvailable ? 'MCP server available' : 'MCP server not installed',
      detail: mcpAvailable
        ? 'The MCP server package (@thesis-research-os/mcp-server) is installed. Run with: npx thesis-mcp'
        : 'Install @thesis-research-os/mcp-server to enable MCP support.',
    },
    crossref: {
      key: 'crossref',
      state: crossrefAvailable ? 'available' : 'degraded',
      summary: 'Crossref DOI resolution active',
      detail: 'Crossref public API is available for DOI metadata resolution. Use GET /resolve-doi?doi=... to resolve.',
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
        'The API exposes local thesis workflow capabilities directly and keeps optional integrations in explicit degraded states instead of hiding them.',
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
