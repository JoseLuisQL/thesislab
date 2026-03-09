import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3100);
const host = '0.0.0.0';

const app = createApp();

app.listen({ host, port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
