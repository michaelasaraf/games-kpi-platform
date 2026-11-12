// Demo mode: the dashboard runs on generated data in an in-memory DuckDB instead of
// BigQuery, so it can be tried and developed without any Google Cloud setup.
//   npm run demo   (then open http://localhost:8080)
// The data is synthetic and only roughly realistic. Never used in production.
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Params, Warehouse } from './warehouse.js';

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
function dayList(days: number) {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - 1);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - (days - 1 - i));
    return iso(d);
  });
}

interface DemoGame {
  game_id: string; name: string; engine: string; platforms: string[];
  installsPerDay: number; d1: number; decay: number; arpdau: number; levels: number;
}

const GAMES: DemoGame[] = [
  { game_id: 'demo_puzzle', name: 'Demo Puzzle', engine: 'unity', platforms: ['android', 'ios'], installsPerDay: 260, d1: 0.42, decay: 0.55, arpdau: 0.09, levels: 40 },
  { game_id: 'demo_tycoon', name: 'Demo Tycoon', engine: 'flutter', platforms: ['android'], installsPerDay: 140, d1: 0.31, decay: 0.62, arpdau: 0.05, levels: 30 },
];
const COUNTRIES: [string, number][] = [['United States', 0.35], ['Germany', 0.2], ['Brazil', 0.25], ['India', 0.2]];
/** UA source, share of installs, retention and revenue multipliers. */
const SOURCES: [string, number, number, number][] = [['organic', 0.5, 1.1, 0.85], ['meta', 0.3, 0.88, 1.25], ['google_ads', 0.2, 1.0, 1.1]];
/** Days since install the demo fills in (the dashboard reads 0..30, 60 and 90). */
const COHORT_DAYS = [...Array.from({ length: 31 }, (_, i) => i), 60, 90];

function generate() {
  const days = dayList(120);
  const rand = rng(42);
  const tables: Record<string, Record<string, unknown>[]> = {
    dim_games: [], kpi_daily: [], kpi_active_users: [], kpi_cohort: [], kpi_levels: [],
    kpi_tutorial: [], kpi_churn_levels: [], kpi_economy: [], kpi_data_health: [], kpi_ua_spend: [],
    kpi_ua_ad_cohort: [], dim_ua_ads: [],
  };

  const adIds = new Set<string>();
  for (const g of GAMES) {
    tables.dim_games!.push({ game_id: g.game_id, name: g.name, engine: g.engine, timezone: 'UTC', d1_target: 0.4, d7_target: 0.15 });
    const retention = (n: number) => (n === 0 ? 1 : g.d1 * Math.pow(n, -g.decay));

    for (const platform of g.platforms) {
      const pShare = platform === 'ios' ? 0.3 : g.platforms.length > 1 ? 0.7 : 1;
      for (const [country, cShare] of COUNTRIES) for (const [ua_source, sShare, rMult, vMult] of SOURCES) {
        const installs = days.map(() => Math.round(g.installsPerDay * pShare * cShare * sShare * (0.8 + rand() * 0.4)));
        const activeByDay = days.map(() => 0);
        if (ua_source === 'meta') {
          // Meta reports ~90% of the installs our attribution gives it, at a country-dependent CPI.
          const cpi = country === 'United States' ? 1.9 : country === 'Germany' ? 1.2 : 0.35;
          // Two creatives per campaign: a video that retains better and a playable that installs cheaper.
          const creatives: [string, string, number, number, number][] = [['video', 'Video: empire timelapse', 0.6, 1.0, 1.1], ['playable', 'Playable: first trade', 0.4, 0.8, 0.85]];
          days.forEach((date, i) => {
            if (installs[i] === 0) return;
            const phase = i < 60 ? 'launch' : 'scale';
            const campaign_id = `${g.game_id}_${platform}_${phase}`;
            const adset_id = `${campaign_id}_${country === 'United States' ? 'us' : 'row'}`;
            for (const [kind, adName, share, cpiMult, retMult] of creatives) {
              const n = installs[i]! * share;
              const ad_id = `${adset_id}_${kind}`;
              tables.kpi_ua_spend!.push({
                game_id: g.game_id, spend_date: date, platform, country, channel: 'meta',
                campaign_id, campaign_name: `${g.name} ${platform === 'ios' ? 'iOS' : 'Android'} ${phase === 'launch' ? 'Launch' : 'Scale'}`,
                adset_id, adset_name: country === 'United States' ? 'US' : 'Rest of world', ad_id, ad_name: adName,
                spend_usd: n * cpi * cpiMult * (0.85 + ((i * 37) % 30) / 100), impressions: Math.round(n * 900),
                clicks: Math.round(n * 12), network_installs: Math.round(n * 0.9),
                network_purchases: Math.round(n * 0.02), network_purchase_value_usd: n * 0.02 * 4.99,
              });
              if (!adIds.has(ad_id)) {
                adIds.add(ad_id);
                tables.dim_ua_ads!.push({ ad_id, ad_name: adName, adset_id, campaign_id, status: phase === 'launch' ? 'PAUSED' : 'ACTIVE', thumbnail_url: null, title: adName });
              }
              // Our own attribution sees ~80% of Meta's installs (click-through only).
              const size = Math.round(n * 0.8);
              for (const dayN of [0, 1, 7, 14, 30]) {
                if (i + dayN >= days.length || size === 0) continue;
                const active = dayN === 0 ? size : Math.round(size * retention(dayN) * 0.88 * retMult);
                const rev = active * g.arpdau * 1.25 * (country === 'United States' ? 1.8 : 0.7) * (dayN === 0 ? 1 : dayN === 1 ? 1 : 3);
                tables.kpi_ua_ad_cohort!.push({
                  game_id: g.game_id, install_date: date, platform, country, campaign_id, adset_id, ad_id, day_n: dayN,
                  active_players: active, ad_revenue_usd: rev * 0.7, iap_revenue_net_usd: rev * 0.3, payers: 0, playtime_sec: active * 1000, cohort_size: size,
                });
              }
            }
          });
        }
        days.forEach((installDate, i) => {
          for (let n = 0; i + n < days.length && n <= 90; n++) {
            const active = Math.round(installs[i]! * (n === 0 ? 1 : retention(n) * rMult) * (0.9 + rand() * 0.2));
            if (active === 0) continue;
            activeByDay[i + n]! += active;
            if (!COHORT_DAYS.includes(n)) continue;
            const rev = active * g.arpdau * vMult * (0.7 + rand() * 0.6) * (country === 'United States' ? 1.8 : 0.7);
            tables.kpi_cohort!.push({
              game_id: g.game_id, install_date: installDate, platform, country, ua_source, day_n: n,
              active_players: active, ad_revenue_usd: rev * 0.65, iap_revenue_net_usd: rev * 0.35,
              payers: Math.round(active * 0.015), playtime_sec: active * 1100, cohort_size: installs[i],
            });
          }
        });
        days.forEach((date, i) => {
          const dau = activeByDay[i]!;
          const imps = dau * 6.5;
          const adRev = dau * g.arpdau * vMult * 0.65 * (0.85 + rand() * 0.3) * (country === 'United States' ? 1.8 : 0.7);
          const payers = Math.round(dau * 0.012 * (0.7 + rand() * 0.6));
          const storeViewers = Math.round(dau * 0.08);
          tables.kpi_daily!.push({
            game_id: g.game_id, event_date: date, platform, country, ua_source, dau, new_players: installs[i],
            sessions: Math.round(dau * (3.2 + rand())), playtime_sec: Math.round(dau * 60 * (16 + rand() * 6)),
            level_starts: Math.round(dau * 9), level_completes: Math.round(dau * 6.5), level_fails: Math.round(dau * 2.5),
            ad_impressions: Math.round(imps), rewarded_impressions: Math.round(imps * 0.3),
            interstitial_impressions: Math.round(imps * 0.25), banner_impressions: Math.round(imps * 0.45),
            rewarded_viewers: Math.round(dau * 0.38), ad_revenue_usd: adRev,
            rewarded_revenue_usd: adRev * 0.55, interstitial_revenue_usd: adRev * 0.35, banner_revenue_usd: adRev * 0.1,
            ad_offers_shown: Math.round(dau * 3), ad_offers_accepted: Math.round(dau * 1.1),
            purchases: Math.round(payers * 1.2), payers,
            iap_revenue_gross_usd: payers * 4.9, iap_revenue_net_usd: payers * 4.9 * 0.85,
            store_viewers: storeViewers, store_viewer_payers: Math.min(payers, Math.round(storeViewers * 0.09)),
            blocked_players: Math.round(dau * 0.2), blocker_hits: Math.round(dau * 0.35),
          });
          tables.kpi_active_users!.push({
            game_id: g.game_id, event_date: date, platform, country, ua_source,
            dau, wau: Math.round(dau * 2.3), mau: Math.round(dau * 4.6),
          });
        });
      }

      for (const [country, cShare] of COUNTRIES) for (const [ua_source, uShare] of SOURCES) days.forEach((date) => {
        const sShare = uShare * cShare;
        let players = Math.round(g.installsPerDay * pShare * sShare * 3.5);
        for (let lvl = 1; lvl <= g.levels; lvl++) {
          const hard = lvl % 10 === 7;
          const win = hard ? 0.38 : 0.62 + rand() * 0.25;
          const starts = Math.round(players / win);
          tables.kpi_levels!.push({
            game_id: g.game_id, event_date: date, platform, country, ua_source, level_number: lvl, level_name: `level_${lvl}`,
            starts, completes: Math.round(starts * win), fails: Math.round(starts * (1 - win)),
            players_started: players, players_completed: Math.round(players * 0.92),
            complete_duration_sec: Math.round(starts * win * (60 + lvl * 4)), completes_with_duration: Math.round(starts * win),
            boosters_used: Math.round(starts * (hard ? 0.4 : 0.08)),
          });
          players = Math.round(players * (hard ? 0.82 : 0.96));
        }
        for (const [currency, scale] of [['coins', 120], ['gems', 3]] as const) {
          const dauish = g.installsPerDay * pShare * sShare * 3;
          const flows: [string, string, number][] = [
            ['source', 'level_reward', 0.55], ['source', 'daily_bonus', 0.2], ['source', 'rewarded_ad', 0.15], ['source', 'purchase', 0.1],
            ['sink', 'booster', 0.4], ['sink', 'continue', 0.3], ['sink', 'unlock', 0.15],
          ];
          for (const [flow, reason, share] of flows) {
            tables.kpi_economy!.push({
              game_id: g.game_id, event_date: date, platform, country, ua_source, currency_name: currency, flow, reason,
              events: Math.round(dauish * share * 3), players: Math.round(dauish * share), amount: Math.round(dauish * scale * share * (0.9 + rand() * 0.2)),
            });
          }
        }
      });

      for (const [country, cShare] of COUNTRIES) for (const [ua_source, uShare] of SOURCES) days.forEach((installDate) => {
        const size = Math.round(g.installsPerDay * pShare * uShare * cShare);
        [[0, 'Tutorial started', 0.97], [1, 'tap_to_match', 0.93], [2, 'first_combo', 0.88], [3, 'use_booster', 0.84], [9999, 'Tutorial completed', 0.8]].forEach(([step, name, share]) =>
          tables.kpi_tutorial!.push({ game_id: g.game_id, install_date: installDate, platform, country, ua_source, step, step_name: name, players: Math.round(size * (share as number)) }),
        );
        for (let lvl = 0; lvl <= g.levels; lvl++) {
          const churned = Math.round(size * 0.6 * (lvl % 10 === 7 ? 0.08 : 0.02) * (lvl === 0 ? 3 : 1));
          tables.kpi_churn_levels!.push({ game_id: g.game_id, install_date: installDate, platform, country, ua_source, last_level_number: lvl, churned_players: churned });
        }
      });
    }

    const now = new Date().toISOString();
    const sdk = `${g.engine}-0.1.0`;
    const health: [string, number, string[], number][] = [
      ['first_open', 1800, ['firebase'], 0], ['session_start', 30000, ['firebase'], 0], ['user_engagement', 90000, ['firebase'], 0],
      ['tutorial_begin', 1700, [sdk], 0], ['tutorial_step', 5000, [sdk], 0], ['tutorial_complete', 1400, [sdk], 0],
      ['level_start', 80000, [sdk], 0], ['level_end', 76000, [sdk], g.engine === 'flutter' ? 120 : 0],
      ['ad_impression', 60000, [sdk], 0], ['ad_offer_shown', 25000, [sdk], 0], ['ad_offer_accepted', 9000, [sdk], 0],
      ['store_view', 900, [sdk], 0], ['iap_purchase', 60, [sdk], 0],
      ['earn_virtual_currency', 70000, [sdk], 0], ['spend_virtual_currency', 30000, [sdk], 0],
      ['install_attribution', 1700, [sdk], 0],
    ];
    for (const [event_name, events_7d, sources, missingLevel] of health) {
      if (g.engine === 'flutter' && event_name === 'iap_purchase') continue; // demo: one game not done yet
      tables.kpi_data_health!.push({
        game_id: g.game_id, event_name, events_7d, events_24h: Math.round(events_7d / 7), players_7d: Math.round(events_7d / 20),
        last_seen_at: now, sources, platforms: g.platforms, missing_level_number: missingLevel,
        ad_impressions_not_counted: 0, missing_currency_name: 0,
      });
    }
  }
  return tables;
}

function toPlain(v: unknown): unknown {
  if (typeof v === 'bigint') return Number(v);
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(toPlain);
  if ('items' in (v as object) && Array.isArray((v as { items: unknown[] }).items)) return (v as { items: unknown[] }).items.map(toPlain);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.length === 10 ? s : s.replace(' ', 'T').replace(/\+00$/, 'Z');
  if (s !== '[object Object]' && !Number.isNaN(Number(s))) return Number(s);
  return s;
}

/** Translates the BigQuery SQL the API uses into DuckDB SQL. Only covers what queries.ts writes. */
export function toDuckSql(sql: string): string {
  return sql
    .replaceAll('{{dataset}}.', '')
    .replace(/DATE\(@(\w+)\)/g, 'CAST($$$1 AS DATE)')
    .replace(/@(\w+)/g, '$$$1');
}

export class DemoWarehouse implements Warehouse {
  private constructor(private readonly conn: DuckDBConnection) {}

  static async create(): Promise<DemoWarehouse> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    const dir = mkdtempSync(join(tmpdir(), 'games-kpi-demo-'));
    for (const [table, rows] of Object.entries(generate())) {
      const file = join(dir, `${table}.json`);
      writeFileSync(file, JSON.stringify(rows));
      await conn.run(`CREATE TABLE ${table} AS SELECT * FROM read_json_auto('${file}')`);
      if (['kpi_daily', 'kpi_active_users', 'kpi_levels', 'kpi_economy'].includes(table)) {
        await conn.run(`ALTER TABLE ${table} ALTER event_date TYPE DATE`);
      }
      if (table === 'kpi_ua_spend') await conn.run(`ALTER TABLE ${table} ALTER spend_date TYPE DATE`);
      if (['kpi_cohort', 'kpi_tutorial', 'kpi_churn_levels', 'kpi_ua_ad_cohort'].includes(table)) {
        await conn.run(`ALTER TABLE ${table} ALTER install_date TYPE DATE`);
      }
    }
    return new DemoWarehouse(conn);
  }

  async query<T>(sql: string, params: Params = {}): Promise<T[]> {
    const reader = await this.conn.runAndReadAll(toDuckSql(sql), params);
    return reader.getRowObjects().map((row) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) out[k] = toPlain(v);
      return out;
    }) as T[];
  }
}
