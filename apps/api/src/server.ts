import { createApp } from './app.js';

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

const app = createApp();

app.listen({ host, port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
