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
    for (const name of ['summary', 'daily', 'retention', 'levels', 'tutorial', 'economy', 'sources', 'platforms', 'integration', 'ua']) {
      await get(`/api/games/demo_puzzle/${name}`);
      await get(`/api/games/demo_puzzle/${name}?platform=android&source=meta`);
      await get(`/api/games/demo_puzzle/${name}?country=Germany`);
    }
    await get('/api/portfolio?source=organic');
    await get('/api/profit?platform=android&country=Germany');
    await get('/api/compare?platform=android&source=meta&country=Germany');
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

  it('narrows every tab to one country and lists countries by players', async () => {
    expect(await get('/api/countries')).toEqual(['United States', 'Brazil', 'Germany', 'India']);
    const all = await get('/api/games/demo_puzzle/summary');
    const de = await get('/api/games/demo_puzzle/summary?country=Germany');
    expect(de.installs).toBeGreaterThan(0);
    expect(de.installs).toBeLessThan(all.installs * 0.3);
    const levels = await get('/api/games/demo_puzzle/levels?country=Germany');
    const allLevels = await get('/api/games/demo_puzzle/levels');
    expect(levels.levels[0].starts).toBeLessThan(allLevels.levels[0].starts * 0.3);
    const none = await get('/api/games/demo_puzzle/summary?country=Peru');
    expect(none.installs).toBe(0);
  });

  it('puts income next to UA spend, per game and in total', async () => {
    const profit = await get('/api/profit');
    expect(profit.games.length).toBeGreaterThan(0);
    const sum = (k: string) => profit.games.reduce((t: number, g: Record<string, number>) => t + g[k]!, 0);
    for (const k of ['ad_revenue_usd', 'iap_revenue_net_usd', 'income_usd', 'spend_usd']) expect(profit.total[k]).toBeCloseTo(sum(k));
    const g = profit.games[0];
    expect(g.spend_usd).toBeGreaterThan(0);
    expect(g.income_usd).toBeCloseTo(g.ad_revenue_usd + g.iap_revenue_net_usd);
    expect(g.profit_usd).toBeCloseTo(g.income_usd - g.spend_usd);
    expect(g.roas).toBeCloseTo(g.income_usd / g.spend_usd);

    const ua = await get(`/api/games/${g.game_id}/ua`);
    expect(ua.total.spend_usd).toBeCloseTo(g.spend_usd);
    expect(ua.total.income_usd).toBeCloseTo(g.income_usd);
    expect(ua.campaigns.reduce((t: number, c: { spend_usd: number }) => t + c.spend_usd, 0)).toBeCloseTo(g.spend_usd);
    expect(ua.daily.reduce((t: number, d: { spend_usd: number }) => t + d.spend_usd, 0)).toBeCloseTo(g.spend_usd);
    expect(ua.total.cpi).toBeGreaterThan(0);
    // The UA source filter does not apply: store revenue has no UA source.
    const filtered = await get(`/api/games/${g.game_id}/ua?source=organic`);
    expect(filtered.total.spend_usd).toBeCloseTo(g.spend_usd);
    const de = await get(`/api/games/${g.game_id}/ua?country=Germany`);
    expect(de.countries.map((c: { country: string }) => c.country)).toEqual(['Germany']);
  });
});
