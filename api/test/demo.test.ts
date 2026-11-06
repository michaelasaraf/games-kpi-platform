import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { accessSchema } from '../src/config.js';
import { DemoWarehouse } from '../src/demo.js';
import { KpiService } from '../src/queries.js';

// Runs every endpoint's real SQL against the demo data in DuckDB.
describe('API on demo data', () => {
  let app: ReturnType<typeof buildApp>;
  const get = async (url: string) => {
    const res = await app.inject({ url, headers: { authorization: 'Bearer demo' } });
    expect(res.statusCode, url).toBe(200);
    return res.json();
  };

  beforeAll(async () => {
    app = buildApp({
      kpis: new KpiService(await DemoWarehouse.create()),
      authenticate: async () => ({ email: 'demo@example.com' }),
      access: accessSchema.parse({ admins: ['demo@example.com'] }),
      publicConfig: { googleClientId: null, devAuth: true },
    });
  }, 120_000);

  it('answers every per-game endpoint, with and without filters', async () => {
    for (const name of ['summary', 'daily', 'retention', 'levels', 'tutorial', 'economy', 'sources', 'platforms', 'integration']) {
      await get(`/api/games/demo_puzzle/${name}`);
      await get(`/api/games/demo_puzzle/${name}?platform=android&source=meta`);
    }
    await get('/api/portfolio?source=organic');
  });

  it('splits installs by UA source and the filter narrows to one', async () => {
    const sources: { ua_source: string; installs: number; install_share: number; d1: { retention: number } }[] =
      await get('/api/games/demo_puzzle/sources');
    expect(sources.map((s) => s.ua_source).sort()).toEqual(['google_ads', 'meta', 'organic']);
    expect(sources.reduce((sum, s) => sum + s.install_share, 0)).toBeCloseTo(1);
    const all = await get('/api/games/demo_puzzle/summary');
    const meta = await get('/api/games/demo_puzzle/summary?source=meta');
    const metaRow = sources.find((s) => s.ua_source === 'meta')!;
    expect(meta.installs).toBe(metaRow.installs);
    expect(meta.installs).toBeLessThan(all.installs);
    expect(meta.retention.d1.retention).toBeCloseTo(metaRow.d1.retention);
    expect(await get('/api/ua-sources')).toEqual(['google_ads', 'meta', 'organic']);
  });
});
