import { afterAll, describe, expect, it, vi } from 'vitest';

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
