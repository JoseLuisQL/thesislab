import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';

vi.mock('@thesis-research-os/db', async () => {
  const actual = await vi.importActual<typeof import('@thesis-research-os/db')>('@thesis-research-os/db');

  return {
    ...actual,
    runMigrations: vi.fn().mockResolvedValue({
      filePath: '/tmp/test.sqlite',
      migrationsFolder: '/tmp/migrations',
      migrationFiles: [],
    }),
  };
});

describe('GET /health', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns the baseline readiness payload', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      service: 'api',
      mission: 'foundation-platform',
      timestamp: expect.any(String),
    });
  });

  it('supports manifest validation via curl-friendly json fields', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        accept: 'application/json',
      },
    });

    const payload = response.json() as {
      ok: boolean;
      service: string;
      mission: string;
      timestamp: string;
    };

    expect(response.headers['content-type']).toContain('application/json');
    expect(payload.ok).toBe(true);
    expect(payload.service).toBe('api');
    expect(payload.mission).toBe('foundation-platform');
    expect(() => new Date(payload.timestamp).toISOString()).not.toThrow();
  });

});

describe('API port contract', () => {
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('prefers PORT_API over PORT and falls back to the mission default', async () => {
    vi.stubEnv('PORT_API', '3123');
    vi.stubEnv('PORT', '3999');

    const { resolveApiPort } = await import('./server.js');

    expect(resolveApiPort()).toBe(3123);

    vi.stubEnv('PORT_API', '');
    expect(resolveApiPort()).toBe(3100);
  });
});

describe('GET /status/capabilities', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.unstubAllEnvs();
    app = createApp();
  });

  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns local-first posture with explicit core workflow capabilities', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/status/capabilities',
    });

    expect(response.statusCode).toBe(200);

    const payload = response.json() as {
      ok: boolean;
      service: string;
      mission: string;
      timestamp: string;
      posture: {
        mode: string;
        state: string;
        summary: string;
      };
      workflows: Array<{
        key: string;
        state: string;
        kind: string;
        localFirst: boolean;
      }>;
      integrations: Array<{
        key: string;
        state: string;
        kind: string;
        optional: boolean;
      }>;
    };

    expect(payload.ok).toBe(true);
    expect(payload.service).toBe('api');
    expect(payload.mission).toBe('foundation-platform');
    expect(payload.posture).toMatchObject({
      mode: 'local-first',
      state: 'ready',
    });
    expect(() => new Date(payload.timestamp).toISOString()).not.toThrow();
    expect(payload.workflows).toEqual([
      expect.objectContaining({
        key: 'create',
        state: 'available',
        kind: 'core',
        localFirst: true,
      }),
      expect.objectContaining({
        key: 'intake',
        state: 'available',
        kind: 'core',
        localFirst: true,
      }),
      expect.objectContaining({
        key: 'resume',
        state: 'available',
        kind: 'core',
        localFirst: true,
      }),
      expect.objectContaining({
        key: 'latex',
        state: 'available',
        kind: 'core',
        localFirst: true,
      }),
      expect.objectContaining({
        key: 'qa',
        state: 'available',
        kind: 'core',
        localFirst: true,
      }),
    ]);
    expect(payload.integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'zotero',
          state: 'degraded',
          kind: 'integration',
          optional: true,
        }),
        expect.objectContaining({
          key: 'connectors',
          state: 'degraded',
          kind: 'integration',
          optional: true,
        }),
      ]),
    );
  });

  it('surfaces explicit degraded Zotero status from connector mode', async () => {
    vi.stubEnv('ZOTERO_CONNECTOR_MODE', 'offline');
    const response = await app.inject({
      method: 'GET',
      url: '/status/capabilities',
    });

    expect(response.statusCode).toBe(200);

    const payload = response.json() as {
      integrations: Array<{
        key: string;
        state: string;
        summary: string;
        detail: string;
      }>;
    };

    expect(payload.integrations).toContainEqual(
      expect.objectContaining({
        key: 'zotero',
        state: 'degraded',
        summary: 'Connector not fully attached',
        detail: expect.stringContaining('offline'),
      }),
    );
  });

  it('keeps the default mock-mode degradation explicit for validator-facing service checks', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/status/capabilities',
      headers: {
        accept: 'application/json',
      },
    });

    expect(response.headers['content-type']).toContain('application/json');

    const payload = response.json() as {
      integrations: Array<{
        key: string;
        summary: string;
        detail: string;
      }>;
    };

    expect(payload.integrations).toContainEqual(
      expect.objectContaining({
        key: 'zotero',
        summary: 'Mock connector only',
        detail: expect.stringContaining('local workflows remain usable'),
      }),
    );
  });
});

describe('thesis lifecycle registry routes', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    vi.unstubAllEnvs();
    app = createApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a thesis with durable identity and safe empty-state detail payload', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis sobre aprendizaje automático',
        degreeProgram: 'Máster en IA',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-a',
      },
    });

    expect(createResponse.statusCode).toBe(201);

    const created = createResponse.json() as {
      ok: boolean;
      thesis: {
        thesis: {
          id: string;
          title: string;
          slug: string;
          workspacePath: string;
          currentState: string;
        };
        checkpointCount: number;
        feedbackCount: number;
        latestCheckpointId: string | null;
        latestFeedbackId: string | null;
        nextStepSummary: string;
        transitions: Array<{
          transitionedFrom: string | null;
          source: string;
          isCurrent: boolean;
        }>;
      };
    };

    expect(created.ok).toBe(true);
    expect(created.thesis.thesis.id).toEqual(expect.any(String));
    expect(created.thesis.thesis.slug).toBe('tesis-sobre-aprendizaje-automatico');
    expect(created.thesis.thesis.currentState).toBe('draft');
    expect(created.thesis.checkpointCount).toBe(0);
    expect(created.thesis.feedbackCount).toBe(0);
    expect(created.thesis.latestCheckpointId).toBeNull();
    expect(created.thesis.latestFeedbackId).toBeNull();
    expect(created.thesis.nextStepSummary).toMatch(/Define el alcance inicial/i);
    expect(created.thesis.transitions).toEqual([
      expect.objectContaining({
        transitionedFrom: null,
        source: 'system:create',
        isCurrent: true,
      }),
    ]);

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/theses/${created.thesis.thesis.id}`,
    });

    expect(detailResponse.statusCode).toBe(200);

    const detail = detailResponse.json() as {
      ok: boolean;
      thesis: {
        thesis: {
          id: string;
          title: string;
          workspacePath: string;
        };
        state: string;
        checkpointCount: number;
        feedbackCount: number;
        blockers: string[];
      };
    };

    expect(detail.ok).toBe(true);
    expect(detail.thesis.thesis.id).toBe(created.thesis.thesis.id);
    expect(detail.thesis.thesis.title).toBe('Tesis sobre aprendizaje automático');
    expect(detail.thesis.thesis.workspacePath).toBe('/workspace/thesis-a');
    expect(detail.thesis.state).toBe('draft');
    expect(detail.thesis.blockers).toEqual([]);
    expect(detail.thesis.checkpointCount).toBe(0);
    expect(detail.thesis.feedbackCount).toBe(0);
  });

  it('updates thesis metadata without losing durable identity', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis inicial',
        degreeProgram: 'Máster en Historia',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-b',
      },
    });

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const updateResponse = await app.inject({
      method: 'PATCH',
      url: `/theses/${thesisId}`,
      payload: {
        title: 'Tesis actualizada',
        workspacePath: '/workspace/thesis-b-v2',
      },
    });

    expect(updateResponse.statusCode).toBe(200);

    const updated = updateResponse.json() as {
      thesis: {
        thesis: {
          id: string;
          title: string;
          degreeProgram: string;
          institution: string;
          workspacePath: string;
          slug: string;
        };
        checkpointCount: number;
        feedbackCount: number;
      };
    };

    expect(updated.thesis.thesis.id).toBe(thesisId);
    expect(updated.thesis.thesis.title).toBe('Tesis actualizada');
    expect(updated.thesis.thesis.degreeProgram).toBe('Máster en Historia');
    expect(updated.thesis.thesis.institution).toBe('Universidad Demo');
    expect(updated.thesis.thesis.workspacePath).toBe('/workspace/thesis-b-v2');
    expect(updated.thesis.thesis.slug).toBe('tesis-actualizada');
    expect(updated.thesis.checkpointCount).toBe(0);
    expect(updated.thesis.feedbackCount).toBe(0);
  });

  it('persists inspectable state transitions with thesis-specific blockers and next steps', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/theses',
      payload: {
        title: 'Tesis bloqueada',
        degreeProgram: 'Doctorado en Educación',
        institution: 'Universidad Demo',
        workspacePath: '/workspace/thesis-c',
      },
    });

    const thesisId = (createResponse.json() as { thesis: { thesis: { id: string } } }).thesis.thesis.id;

    const transitionResponse = await app.inject({
      method: 'POST',
      url: `/theses/${thesisId}/state`,
      payload: {
        state: 'blocked',
        source: 'user:status-review',
        statusSummary: 'Faltan aprobaciones del tutor para continuar.',
        blockers: ['Esperando revisión metodológica'],
        nextStepSummary: 'Solicita la revisión metodológica y agenda una reunión con el tutor.',
      },
    });

    expect(transitionResponse.statusCode).toBe(200);

    const transitioned = transitionResponse.json() as {
      thesis: {
        thesis: {
          currentState: string;
        };
        state: string;
        statusSummary: string;
        blockers: string[];
        nextStepSummary: string;
        transitions: Array<{
          state: string;
          source: string;
          transitionedFrom: string | null;
          transitionedAt: string;
          isCurrent: boolean;
        }>;
      };
    };

    expect(transitioned.thesis.thesis.currentState).toBe('blocked');
    expect(transitioned.thesis.state).toBe('blocked');
    expect(transitioned.thesis.statusSummary).toBe('Faltan aprobaciones del tutor para continuar.');
    expect(transitioned.thesis.blockers).toEqual(['Esperando revisión metodológica']);
    expect(transitioned.thesis.nextStepSummary).toBe(
      'Solicita la revisión metodológica y agenda una reunión con el tutor.',
    );
    expect(transitioned.thesis.transitions[0]).toEqual(
      expect.objectContaining({
        state: 'blocked',
        source: 'user:status-review',
        transitionedFrom: 'draft',
        isCurrent: true,
      }),
    );
    expect(() => new Date(transitioned.thesis.transitions[0].transitionedAt).toISOString()).not.toThrow();
    expect(transitioned.thesis.transitions[1]).toEqual(
      expect.objectContaining({
        state: 'draft',
        source: 'system:create',
        isCurrent: false,
      }),
    );
  });

  it('fails safely for unknown thesis IDs without fabricating thesis data', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/theses/does-not-exist',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      ok: false,
      code: 'THESIS_NOT_FOUND',
      message: 'Thesis does-not-exist was not found.',
    });
  });
});
