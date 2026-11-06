import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { googleAuthenticator } from './auth.js';
import { loadConfig } from './config.js';
import { KpiService } from './queries.js';
import { BigQueryWarehouse, CachedWarehouse } from './warehouse.js';

const config = loadConfig();
const warehouse = new CachedWarehouse(new BigQueryWarehouse(config), config.CACHE_TTL_SECONDS * 1000);
const here = dirname(fileURLToPath(import.meta.url));

const app = buildApp({
  kpis: new KpiService(warehouse),
  authenticate: googleAuthenticator(config),
  access: config.access,
  publicConfig: { googleClientId: config.GOOGLE_CLIENT_ID ?? null, devAuth: Boolean(config.DEV_AUTH_EMAIL) },
  webDir: process.env.WEB_DIR ?? resolve(here, '../../web/dist'),
  logger: true,
});

app.listen({ port: config.PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
