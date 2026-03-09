import { afterAll, describe, expect, it } from 'vitest';

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
