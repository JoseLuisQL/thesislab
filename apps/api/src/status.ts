type CapabilityState = 'available' | 'degraded' | 'unavailable';
type CapabilityKind = 'core' | 'integration';

export type WorkflowCapability = {
  key: 'create' | 'intake' | 'resume' | 'latex' | 'qa';
  label: string;
  state: CapabilityState;
  kind: CapabilityKind;
  localFirst: true;
  summary: string;
  detail: string;
};

export type IntegrationCapability = {
  key: 'zotero' | 'connectors';
  label: string;
  state: CapabilityState;
  kind: CapabilityKind;
  optional: true;
  summary: string;
  detail: string;
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

const mission = 'misc-foundation-followup';

export function buildLocalFirstStatusPayload(): LocalFirstStatusPayload {
  const timestamp = new Date().toISOString();
  const zoteroMode = process.env.ZOTERO_CONNECTOR_MODE?.trim() || 'mock';

  return {
    ok: true,
    service: 'api',
    mission,
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
        state: 'available',
        kind: 'core',
        localFirst: true,
        summary: 'Ready',
        detail: 'Local thesis creation remains available without any external connector.',
      },
      {
        key: 'intake',
        label: 'Import thesis',
        state: 'available',
        kind: 'core',
        localFirst: true,
        summary: 'Ready',
        detail: 'Intake status is tracked as part of the local-first thesis workflow surface.',
      },
      {
        key: 'resume',
        label: 'Resume work',
        state: 'available',
        kind: 'core',
        localFirst: true,
        summary: 'Ready',
        detail: 'Resume posture remains available from persisted local thesis state.',
      },
      {
        key: 'latex',
        label: 'LaTeX workbench',
        state: 'available',
        kind: 'core',
        localFirst: true,
        summary: 'Ready',
        detail: 'LaTeX workspace operations are part of the local-first surface contract.',
      },
      {
        key: 'qa',
        label: 'QA review',
        state: 'available',
        kind: 'core',
        localFirst: true,
        summary: 'Ready',
        detail: 'Academic QA remains available independently of optional integrations.',
      },
    ],
    integrations: [
      {
        key: 'zotero',
        label: 'Zotero connector',
        state: 'degraded',
        kind: 'integration',
        optional: true,
        summary: zoteroMode === 'mock' ? 'Mock connector only' : 'Connector not fully attached',
        detail:
          zoteroMode === 'mock'
            ? 'Zotero runs in mock mode, so local workflows remain usable while bibliography sync is explicitly degraded.'
            : `Zotero connector mode \"${zoteroMode}\" is configured, but the connector-backed capability is still treated as an optional degraded integration.`,
      },
      {
        key: 'connectors',
        label: 'External connector adapters',
        state: 'degraded',
        kind: 'integration',
        optional: true,
        summary: 'Optional adapters unavailable',
        detail:
          'OpenClaw-specific or other connector-backed capabilities are optional and currently surfaced as degraded rather than silently disappearing.',
      },
    ],
  };
}
