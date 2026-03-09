import Fastify from 'fastify';

import { buildHealthPayload } from '@thesis-research-os/shared';

export function createApp() {
  const app = Fastify({ logger: true });

  app.get('/health', async () => ({
    ok: true,
    service: 'api',
    ...buildHealthPayload('foundation-platform'),
  }));

  return app;
}
