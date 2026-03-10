import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';

describe('GET /health', () => {
  const app = createApp();

  afterAll(async () => {
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
  const app = createApp();

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
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
    expect(payload.mission).toBe('misc-foundation-followup');
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
