import {
  blendedDay,
  cohortTable,
  engagementAndMoney,
  integrationChecklist,
  levelFunnel,
  MIN_RELIABLE_COHORT,
  toTotals,
  daysBetween,
  type CohortRow,
  type HealthRow,
  type LevelRow,
} from './metrics.js';
import type { Warehouse } from './warehouse.js';

export interface Range {
  from: string;
  to: string;
  /** 'all', 'android' or 'ios'. */
  platform: string;
  /** 'all' or a UA source such as 'organic', 'meta', 'google_ads'. */
  source: string;
}

/** Platform and UA source filters; every KPI table has both columns. */
const PLATFORM_FILTER = `(@platform = 'all' OR platform = @platform) AND (@source = 'all' OR ua_source = @source)`;

const SUM_TOTALS = `
  SUM(dau) AS dau, SUM(new_players) AS new_players, SUM(sessions) AS sessions,
  SUM(playtime_sec) AS playtime_sec, SUM(level_starts) AS level_starts,
  SUM(level_completes) AS level_completes, SUM(level_fails) AS level_fails,
  SUM(ad_impressions) AS ad_impressions, SUM(rewarded_impressions) AS rewarded_impressions,
  SUM(interstitial_impressions) AS interstitial_impressions, SUM(banner_impressions) AS banner_impressions,
  SUM(rewarded_viewers) AS rewarded_viewers, SUM(ad_revenue_usd) AS ad_revenue_usd,
  SUM(rewarded_revenue_usd) AS rewarded_revenue_usd, SUM(interstitial_revenue_usd) AS interstitial_revenue_usd,
  SUM(banner_revenue_usd) AS banner_revenue_usd, SUM(ad_offers_shown) AS ad_offers_shown,
  SUM(ad_offers_accepted) AS ad_offers_accepted, SUM(purchases) AS purchases, SUM(payers) AS payers,
  SUM(iap_revenue_gross_usd) AS iap_revenue_gross_usd, SUM(iap_revenue_net_usd) AS iap_revenue_net_usd,
  SUM(store_viewers) AS store_viewers, SUM(store_viewer_payers) AS store_viewer_payers,
  SUM(blocked_players) AS blocked_players, SUM(blocker_hits) AS blocker_hits,
  MIN(event_date) AS first_date`;

/** Yesterday in UTC: the last day whose numbers are complete. */
export function lastCompleteDate(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return d.toISOString().slice(0, 10);
}

export class KpiService {
  constructor(private readonly wh: Warehouse, private readonly now: () => Date = () => new Date()) {}

  games() {
    return this.wh.query<{
      game_id: string; name: string; engine: string; timezone: string;
      d1_target: number; d7_target: number;
    }>(`SELECT game_id, name, engine, timezone, d1_target, d7_target FROM {{dataset}}.dim_games ORDER BY name`);
  }

  platforms(gameId: string) {
    return this.wh
      .query<{ platform: string }>(
        `SELECT DISTINCT platform FROM {{dataset}}.kpi_daily WHERE game_id = @game ORDER BY platform`,
        { game: gameId },
      )
      .then((rows) => rows.map((r) => r.platform));
  }

  private params(gameId: string, r: Range) {
    return { game: gameId, from: r.from, to: r.to, platform: r.platform, source: r.source };
  }

  /**
   * Days to average over: the range, but starting no earlier than the first day with data,
   * so a game that launched mid-range is not averaged over days before it existed.
   */
  private days(r: Range, firstDate?: unknown) {
    const start = typeof firstDate === 'string' && firstDate > r.from ? firstDate : r.from;
    return Math.max(1, daysBetween(start, r.to) + 1);
  }

  /** Engagement, monetization and the launch scorecard for one game. */
  async summary(gameId: string, r: Range) {
    const [totalsRows, stickRows, cohorts] = await Promise.all([
      this.wh.query(
        `SELECT ${SUM_TOTALS} FROM {{dataset}}.kpi_daily
         WHERE game_id = @game AND event_date BETWEEN DATE(@from) AND DATE(@to) AND ${PLATFORM_FILTER}`,
        this.params(gameId, r),
      ),
      this.wh.query<{ dau: number; mau: number }>(
        `SELECT SUM(dau) AS dau, SUM(mau) AS mau FROM {{dataset}}.kpi_active_users
         WHERE game_id = @game AND event_date BETWEEN DATE(@from) AND DATE(@to) AND ${PLATFORM_FILTER}`,
        this.params(gameId, r),
      ),
      this.cohortRows(gameId, r),
    ]);
    const totals = toTotals(totalsRows[0] ?? {}, this.days(r, totalsRows[0]?.first_date));
    const last = lastCompleteDate(this.now());
    const day = (d: number) => {
      const b = blendedDay(cohorts, last, d);
      return { ...b, reliable: b.players >= MIN_RELIABLE_COHORT };
    };
    const stick = stickRows[0];
    return {
      range: r,
      last_complete_date: last,
      ...engagementAndMoney(totals),
      stickiness: stick && Number(stick.mau) > 0 ? Number(stick.dau) / Number(stick.mau) : null,
      retention: { d1: day(1), d3: day(3), d7: day(7), d14: day(14), d30: day(30) },
      ltv: { d0: day(0), d7: day(7), d30: day(30) },
    };
  }

  /** Daily series for charts. */
  async daily(gameId: string, r: Range) {
    const [rows, active] = await Promise.all([
      this.wh.query<Record<string, unknown> & { event_date: string }>(
        `SELECT event_date, ${SUM_TOTALS} FROM {{dataset}}.kpi_daily
         WHERE game_id = @game AND event_date BETWEEN DATE(@from) AND DATE(@to) AND ${PLATFORM_FILTER}
         GROUP BY event_date ORDER BY event_date`,
        this.params(gameId, r),
      ),
      this.wh.query<{ event_date: string; dau: number; wau: number; mau: number }>(
        `SELECT event_date, SUM(dau) AS dau, SUM(wau) AS wau, SUM(mau) AS mau FROM {{dataset}}.kpi_active_users
         WHERE game_id = @game AND event_date BETWEEN DATE(@from) AND DATE(@to) AND ${PLATFORM_FILTER}
         GROUP BY event_date`,
        this.params(gameId, r),
      ),
    ]);
    const activeByDate = new Map(active.map((a) => [String(a.event_date), a]));
    return rows.map((row) => {
      const a = activeByDate.get(String(row.event_date));
      return {
        date: String(row.event_date),
        ...engagementAndMoney(toTotals(row, 1)),
        wau: a ? Number(a.wau) : null,
        mau: a ? Number(a.mau) : null,
        stickiness: a && Number(a.mau) > 0 ? Number(a.dau) / Number(a.mau) : null,
      };
    });
  }

  private cohortRows(gameId: string, r: Range) {
    return this.wh.query<CohortRow>(
      `SELECT install_date, day_n, SUM(active_players) AS active_players,
              SUM(ad_revenue_usd) AS ad_revenue_usd, SUM(iap_revenue_net_usd) AS iap_revenue_net_usd
       FROM {{dataset}}.kpi_cohort
       WHERE game_id = @game AND install_date BETWEEN DATE(@from) AND DATE(@to) AND day_n <= 90 AND ${PLATFORM_FILTER}
       GROUP BY install_date, day_n`,
      this.params(gameId, r),
    );
  }

  /** Cohort triangle: one row per install day with retention and LTV for days 0..30. */
  async retention(gameId: string, r: Range) {
    const rows = await this.cohortRows(gameId, r);
    const last = lastCompleteDate(this.now());
    const curve = [0, 1, 2, 3, 4, 5, 6, 7, 14, 21, 30, 60, 90].map((d) => blendedDay(rows, last, d));
    return { last_complete_date: last, curve, cohorts: cohortTable(rows, last, 30) };
  }

  async levels(gameId: string, r: Range) {
    const [levels, churn] = await Promise.all([
      this.wh.query<LevelRow>(
        `SELECT level_number, ANY_VALUE(level_name) AS level_name, SUM(starts) AS starts,
                SUM(completes) AS completes, SUM(fails) AS fails, SUM(players_started) AS players_started,
                SUM(players_completed) AS players_completed, SUM(complete_duration_sec) AS complete_duration_sec,
                SUM(completes_with_duration) AS completes_with_duration, SUM(boosters_used) AS boosters_used
         FROM {{dataset}}.kpi_levels
         WHERE game_id = @game AND event_date BETWEEN DATE(@from) AND DATE(@to) AND ${PLATFORM_FILTER}
         GROUP BY level_number ORDER BY level_number`,
        this.params(gameId, r),
      ),
      this.wh.query<{ last_level_number: number; churned_players: number }>(
        `SELECT last_level_number, SUM(churned_players) AS churned_players
         FROM {{dataset}}.kpi_churn_levels
         WHERE game_id = @game AND install_date BETWEEN DATE(@from) AND DATE(@to) AND ${PLATFORM_FILTER}
         GROUP BY last_level_number`,
        this.params(gameId, r),
      ),
    ]);
    const churnByLevel = new Map(churn.map((c) => [Number(c.last_level_number), Number(c.churned_players)]));
    return {
      note: 'players_started sums daily distinct players, so a player active on several days counts once per day.',
      levels: levelFunnel(levels.map((l) => ({ ...l, churned_players: churnByLevel.get(Number(l.level_number)) ?? 0 }))),
      churned_before_level_1: churnByLevel.get(0) ?? 0,
    };
  }

  async tutorial(gameId: string, r: Range) {
    const rows = await this.wh.query<{ step: number; step_name: string | null; players: number }>(
      `SELECT step, ANY_VALUE(step_name) AS step_name, SUM(players) AS players
       FROM {{dataset}}.kpi_tutorial
       WHERE game_id = @game AND install_date BETWEEN DATE(@from) AND DATE(@to) AND ${PLATFORM_FILTER}
       GROUP BY step ORDER BY step`,
      this.params(gameId, r),
    );
    const installs = await this.wh.query<{ installs: number }>(
      `SELECT SUM(new_players) AS installs FROM {{dataset}}.kpi_daily
       WHERE game_id = @game AND event_date BETWEEN DATE(@from) AND DATE(@to) AND ${PLATFORM_FILTER}`,
      this.params(gameId, r),
    );
    const total = Number(installs[0]?.installs ?? 0);
    return {
      installs: total,
      steps: rows.map((s) => ({
        step: Number(s.step),
        label: Number(s.step) === 0 ? 'Tutorial started' : Number(s.step) === 9999 ? 'Tutorial completed' : s.step_name ?? `Step ${s.step}`,
        players: Number(s.players),
        share_of_installs: total > 0 ? Number(s.players) / total : null,
      })),
    };
  }

  async economy(gameId: string, r: Range) {
    const [flows, dau] = await Promise.all([
      this.wh.query<{ currency_name: string; flow: string; reason: string; amount: number; players: number; events: number }>(
        `SELECT currency_name, flow, reason, SUM(amount) AS amount, SUM(players) AS players, SUM(events) AS events
         FROM {{dataset}}.kpi_economy
         WHERE game_id = @game AND event_date BETWEEN DATE(@from) AND DATE(@to) AND ${PLATFORM_FILTER}
         GROUP BY currency_name, flow, reason ORDER BY currency_name, flow, amount DESC`,
        this.params(gameId, r),
      ),
      this.wh.query<{ dau: number }>(
        `SELECT SUM(dau) AS dau FROM {{dataset}}.kpi_daily
         WHERE game_id = @game AND event_date BETWEEN DATE(@from) AND DATE(@to) AND ${PLATFORM_FILTER}`,
        this.params(gameId, r),
      ),
    ]);
    const dauDays = Number(dau[0]?.dau ?? 0);
    const currencies = new Map<string, { earned: number; spent: number; sources: unknown[]; sinks: unknown[] }>();
    for (const f of flows) {
      const c = currencies.get(f.currency_name) ?? { earned: 0, spent: 0, sources: [], sinks: [] };
      const item = { reason: f.reason, amount: Number(f.amount), events: Number(f.events) };
      if (f.flow === 'source') {
        c.earned += item.amount;
        c.sources.push(item);
      } else {
        c.spent += item.amount;
        c.sinks.push(item);
      }
      currencies.set(f.currency_name, c);
    }
    return [...currencies.entries()].map(([currency, c]) => ({
      currency,
      earned: c.earned,
      spent: c.spent,
      net: c.earned - c.spent,
      net_per_dau: dauDays > 0 ? (c.earned - c.spent) / dauDays : null,
      spend_ratio: c.earned > 0 ? c.spent / c.earned : null,
      sources: c.sources,
      sinks: c.sinks,
    }));
  }

  async integration(gameId: string) {
    const rows = await this.wh.query<HealthRow & { sources: string[]; platforms: string[]; players_7d: number }>(
      `SELECT * FROM {{dataset}}.kpi_data_health WHERE game_id = @game ORDER BY event_name`,
      { game: gameId },
    );
    const wrapperVersions = [...new Set(rows.flatMap((r) => r.sources ?? []).filter((s) => s !== 'firebase'))].sort();
    return {
      wrapper_versions: wrapperVersions,
      checklist: integrationChecklist(rows),
      events: rows,
    };
  }

  /** UA sources seen in the games the user may see, for the filter. */
  async uaSources(gameIds: string[] | '*') {
    const rows = await this.wh.query<{ game_id: string; ua_source: string }>(
      `SELECT DISTINCT game_id, ua_source FROM {{dataset}}.kpi_daily`,
    );
    const visible = rows.filter((r) => gameIds === '*' || gameIds.includes(r.game_id));
    return [...new Set(visible.map((r) => r.ua_source))].sort();
  }

  /**
   * KPIs per UA source for one game: installs, retention, LTV and ARPDAU side by side.
   * Uses the platform filter but not the source filter, so every source shows.
   */
  async sources(gameId: string, r: Range) {
    const all = { ...r, source: 'all' };
    const [totals, cohorts] = await Promise.all([
      this.wh.query<Record<string, unknown> & { ua_source: string }>(
        `SELECT ua_source, ${SUM_TOTALS} FROM {{dataset}}.kpi_daily
         WHERE game_id = @game AND event_date BETWEEN DATE(@from) AND DATE(@to) AND ${PLATFORM_FILTER}
         GROUP BY ua_source`,
        this.params(gameId, all),
      ),
      this.wh.query<CohortRow & { ua_source: string }>(
        `SELECT ua_source, install_date, day_n, SUM(active_players) AS active_players,
                SUM(ad_revenue_usd) AS ad_revenue_usd, SUM(iap_revenue_net_usd) AS iap_revenue_net_usd
         FROM {{dataset}}.kpi_cohort
         WHERE game_id = @game AND install_date BETWEEN DATE(@from) AND DATE(@to) AND day_n <= 7 AND ${PLATFORM_FILTER}
         GROUP BY ua_source, install_date, day_n`,
        this.params(gameId, all),
      ),
    ]);
    const last = lastCompleteDate(this.now());
    const installsAll = totals.reduce((sum, t) => sum + Number(t.new_players ?? 0), 0);
    // Every source is averaged over the same days: from the game's first day with data.
    const firstDate = totals.map((t) => t.first_date).filter((d): d is string => typeof d === 'string').sort()[0];
    const rows = totals.map((t) => {
      const mine = cohorts.filter((c) => c.ua_source === t.ua_source);
      const day = (d: number) => {
        const b = blendedDay(mine, last, d);
        return { ...b, reliable: b.players >= MIN_RELIABLE_COHORT };
      };
      const money = engagementAndMoney(toTotals(t, this.days(r, firstDate)));
      return {
        ua_source: t.ua_source,
        installs: money.installs,
        install_share: installsAll > 0 ? money.installs / installsAll : null,
        avg_dau: money.avg_dau,
        revenue_usd: money.revenue_usd,
        arpdau: money.arpdau,
        d1: day(1),
        d7: day(7),
        ltv_d7: day(7),
      };
    });
    return rows.sort((a, b) => b.installs - a.installs);
  }

  /** One row per game the user may see, for the portfolio page. */
  async portfolio(gameIds: string[] | '*', r: Range) {
    const games = await this.games();
    const visible = gameIds === '*' ? games : games.filter((g) => gameIds.includes(g.game_id));
    return Promise.all(
      visible.map(async (g) => {
        const s = await this.summary(g.game_id, r);
        return {
          game_id: g.game_id,
          name: g.name,
          engine: g.engine,
          targets: { d1: g.d1_target, d7: g.d7_target },
          avg_dau: s.avg_dau,
          installs: s.installs,
          d1: s.retention.d1,
          d7: s.retention.d7,
          playtime_min_per_dau: s.playtime_min_per_dau,
          arpdau: s.arpdau,
          ltv_d7: s.ltv.d7,
          revenue_usd: s.revenue_usd,
        };
      }),
    );
  }
}
