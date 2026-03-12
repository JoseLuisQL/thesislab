import { createApp } from './app.js';
import { pathToFileURL } from 'node:url';

export const resolveApiPort = (): number => {
  const configuredPort = process.env.PORT_API;

  if (!configuredPort) {
    return 3100;
  }

  const parsedPort = Number(configuredPort);

  return Number.isFinite(parsedPort) ? parsedPort : 3100;
};

const port = resolveApiPort();
const host = '0.0.0.0';

export function startServer() {
  const app = createApp();

  return app.listen({ host, port }).catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  void startServer();
}
