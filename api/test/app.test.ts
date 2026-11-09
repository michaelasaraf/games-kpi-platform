import { describe, expect, it } from 'vitest';
import { gameAccessFor } from '../src/access.js';
import { buildApp, parseRange } from '../src/app.js';
import type { Authenticator } from '../src/auth.js';
import { accessSchema } from '../src/config.js';
import { KpiService } from '../src/queries.js';
import { CachedWarehouse, type Params, type Warehouse } from '../src/warehouse.js';

/** Answers by table name, and records every query so tests can inspect params. */
class FakeWarehouse implements Warehouse {
  calls: { sql: string; params: Params }[] = [];
  constructor(private readonly tables: Record<string, Record<string, unknown>[]>) {}
  async query<T>(sql: string, params: Params = {}): Promise<T[]> {
    this.calls.push({ sql, params });
    const table = /\{\{dataset\}\}\.(\w+)/.exec(sql)?.[1] ?? '';
    return (this.tables[table] ?? []) as T[];
  }
}

const access = accessSchema.parse({
  admins: ['boss@studio.com'],
  users: { 'pm@studio.com': ['gems_crafter'] },
  domains: { 'partner.com': ['storm_bloom'] },
});

const games = [
  { game_id: 'gems_crafter', name: 'Gems Crafter', engine: 'unity', timezone: 'UTC', d1_target: 0.4, d7_target: 0.15 },
  { game_id: 'storm_bloom', name: 'StormBloom', engine: 'flutter', timezone: 'UTC', d1_target: 0.4, d7_target: 0.15 },
];

const auth: Authenticator = async (header) => {
  const email = header?.replace('Bearer ', '');
  return email && email.includes('@') ? { email } : null;
};

function makeApp(wh: Warehouse) {
  return buildApp({
    kpis: new KpiService(wh, () => new Date('2026-11-09T12:00:00Z')),
    authenticate: auth,
    access,
    publicConfig: { googleClientId: 'cid', devAuth: false },
  });
}

describe('access', () => {
  it('gives admins every game', () => expect(gameAccessFor('Boss@Studio.com', access)).toBe('*'));
  it('gives users their listed games', () => expect(gameAccessFor('pm@studio.com', access)).toEqual(['gems_crafter']));
  it('grants by email domain', () => expect(gameAccessFor('x@partner.com', access)).toEqual(['storm_bloom']));
  it('gives strangers nothing', () => expect(gameAccessFor('x@other.com', access)).toEqual([]));
});

describe('parseRange', () => {
  const now = new Date('2026-11-09T12:00:00Z');
  it('defaults to the 30 days ending yesterday', () => {
    expect(parseRange({}, now)).toEqual({ from: '2026-10-10', to: '2026-11-08', platform: 'all', source: 'all', country: 'all' });
  });
  it('rejects reversed and huge ranges', () => {
    expect(() => parseRange({ from: '2026-11-08', to: '2026-11-01' }, now)).toThrow();
    expect(() => parseRange({ from: '2024-01-01', to: '2026-01-01' }, now)).toThrow();
  });
  it('rejects unknown platforms', () => {
    expect(() => parseRange({ platform: 'web' }, now)).toThrow();
  });
});

describe('API', () => {
  const wh = new FakeWarehouse({
    dim_games: games,
    kpi_daily: [{ dau: 300, new_players: 30, sessions: 900, playtime_sec: 180_000, ad_revenue_usd: 3, iap_revenue_net_usd: 6 }],
    kpi_active_users: [{ dau: 300, mau: 1500 }],
    kpi_cohort: [
      { install_date: '2026-11-01', day_n: 0, active_players: 30, ad_revenue_usd: 0.3, iap_revenue_net_usd: 0 },
      { install_date: '2026-11-01', day_n: 1, active_players: 12, ad_revenue_usd: 0.1, iap_revenue_net_usd: 0 },
    ],
  });
  const app = makeApp(wh);

  it('requires sign-in', async () => {
    const res = await app.inject({ url: '/api/games' });
    expect(res.statusCode).toBe(401);
  });

  it('serves public config and health without sign-in', async () => {
    expect((await app.inject({ url: '/healthz' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/config' })).json()).toEqual({ googleClientId: 'cid', devAuth: false });
  });

  it('lists only the games a user may see', async () => {
    const res = await app.inject({ url: '/api/games', headers: { authorization: 'Bearer pm@studio.com' } });
    expect(res.json().map((g: { game_id: string }) => g.game_id)).toEqual(['gems_crafter']);
  });

  it('hides other games behind a 404', async () => {
    const res = await app.inject({ url: '/api/games/storm_bloom/summary', headers: { authorization: 'Bearer pm@studio.com' } });
    expect(res.statusCode).toBe(404);
  });

  it('returns a summary with filters passed as query params', async () => {
    wh.calls = [];
    const res = await app.inject({
      url: '/api/games/gems_crafter/summary?from=2026-11-01&to=2026-11-08&platform=android',
      headers: { authorization: 'Bearer pm@studio.com' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.avg_dau).toBe(37.5);
    expect(body.arpdau).toBeCloseTo(0.03);
    expect(body.stickiness).toBe(0.2);
    expect(body.retention.d1.retention).toBeCloseTo(0.4);
    expect(body.retention.d1.reliable).toBe(false);
    expect(wh.calls.every((c) => c.params.game === 'gems_crafter' && c.params.platform === 'android')).toBe(true);
    // Values never go into the SQL text itself.
    expect(wh.calls.some((c) => c.sql.includes('gems_crafter'))).toBe(false);
  });

  it('passes the UA source filter as a param', async () => {
    wh.calls = [];
    const res = await app.inject({
      url: '/api/games/gems_crafter/summary?source=meta',
      headers: { authorization: 'Bearer pm@studio.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(wh.calls.every((c) => c.params.source === 'meta')).toBe(true);
    expect(wh.calls.some((c) => c.sql.includes('meta'))).toBe(false);
  });

  it('passes the country filter as a param', async () => {
    wh.calls = [];
    const res = await app.inject({
      url: `/api/games/gems_crafter/summary?country=${encodeURIComponent('Côte d’Ivoire')}`,
      headers: { authorization: 'Bearer pm@studio.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(wh.calls.every((c) => c.params.country === 'Côte d’Ivoire')).toBe(true);
    expect(wh.calls.some((c) => c.sql.includes('Ivoire'))).toBe(false);
  });

  it('rejects countries with characters no country name has', async () => {
    const res = await app.inject({
      url: '/api/games/gems_crafter/summary?country=x%3B%20DROP',
      headers: { authorization: 'Bearer pm@studio.com' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects UA sources that are not identifiers', async () => {
    const res = await app.inject({
      url: "/api/games/gems_crafter/summary?source=x'%20OR%201=1",
      headers: { authorization: 'Bearer pm@studio.com' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('lists UA sources only from games the user may see', async () => {
    const sourcesApp = makeApp(new FakeWarehouse({
      kpi_daily: [
        { game_id: 'gems_crafter', ua_source: 'organic' },
        { game_id: 'gems_crafter', ua_source: 'meta' },
        { game_id: 'storm_bloom', ua_source: 'tiktok' },
      ],
    }));
    const res = await sourcesApp.inject({ url: '/api/ua-sources', headers: { authorization: 'Bearer pm@studio.com' } });
    expect(res.json()).toEqual(['meta', 'organic']);
  });

  it('rejects bad input with 400', async () => {
    const res = await app.inject({
      url: '/api/games/gems_crafter/summary?from=yesterday',
      headers: { authorization: 'Bearer pm@studio.com' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects game ids that are not identifiers', async () => {
    const res = await app.inject({ url: '/api/games/DROP%20TABLE/summary', headers: { authorization: 'Bearer boss@studio.com' } });
    expect(res.statusCode).toBe(400);
  });

  it('builds the portfolio for an admin across all games', async () => {
    const res = await app.inject({ url: '/api/portfolio', headers: { authorization: 'Bearer boss@studio.com' } });
    expect(res.json().map((g: { game_id: string }) => g.game_id)).toEqual(['gems_crafter', 'storm_bloom']);
  });
});

describe('CachedWarehouse', () => {
  it('reuses results within the TTL', async () => {
    const inner = new FakeWarehouse({ kpi_daily: [{ dau: 1 }] });
    const cached = new CachedWarehouse(inner, 60_000);
    await cached.query('SELECT * FROM {{dataset}}.kpi_daily', { game: 'a' });
    await cached.query('SELECT * FROM {{dataset}}.kpi_daily', { game: 'a' });
    await cached.query('SELECT * FROM {{dataset}}.kpi_daily', { game: 'b' });
    expect(inner.calls.length).toBe(2);
  });
});
