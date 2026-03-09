import Fastify from 'fastify';

import { buildHealthPayload } from '@thesis-research-os/shared';

import { buildLocalFirstStatusPayload } from './status.js';

export function createApp() {
  const app = Fastify({ logger: true });

  app.get('/health', async () => ({
    ok: true,
    service: 'api',
    ...buildHealthPayload('foundation-platform'),
  }));

  app.get('/status/capabilities', async () => buildLocalFirstStatusPayload());

  return app;
}
