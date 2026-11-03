// Runs the dashboard on generated demo data (no Google Cloud needed): npm run demo
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { DemoWarehouse } from './demo.js';
import { KpiService } from './queries.js';

const here = dirname(fileURLToPath(import.meta.url));
const warehouse = await DemoWarehouse.create();
const app = buildApp({
  kpis: new KpiService(warehouse),
  authenticate: async () => ({ email: 'demo@example.com', name: 'Demo' }),
  access: { admins: ['demo@example.com'], users: {}, domains: {} },
  publicConfig: { googleClientId: null, devAuth: true },
  webDir: process.env.WEB_DIR ?? resolve(here, '../../web/dist'),
  logger: false,
});
const port = Number(process.env.PORT ?? 8080);
await app.listen({ port, host: '0.0.0.0' });
console.log(`Demo dashboard on http://localhost:${port}`);
