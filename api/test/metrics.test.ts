import { describe, expect, it } from 'vitest';
import {
  addDays,
  blendedDay,
  cohortTable,
  daysBetween,
  div,
  engagementAndMoney,
  integrationChecklist,
  levelFunnel,
  toTotals,
  type CohortRow,
} from '../src/metrics.js';

describe('dates', () => {
  it('adds days across month ends', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('counts days between', () => {
    expect(daysBetween('2026-11-01', '2026-11-08')).toBe(7);
  });
});

describe('div', () => {
  it('returns null instead of dividing by zero', () => {
    expect(div(5, 0)).toBeNull();
    expect(div(null, 2)).toBeNull();
    expect(div(6, 3)).toBe(2);
  });
});

describe('engagementAndMoney', () => {
  const totals = toTotals(
    {
      dau: 1000, new_players: 200, sessions: 3500, playtime_sec: 1_200_000,
      ad_impressions: 8000, rewarded_impressions: 2000, rewarded_viewers: 300,
      ad_revenue_usd: 80, rewarded_revenue_usd: 40, payers: 20, iap_revenue_net_usd: 120,
      level_completes: 700, level_fails: 300, store_viewers: 100, store_viewer_payers: 10,
    },
    10,
  );
  const m = engagementAndMoney(totals);

  it('computes per-DAU figures from player-days', () => {
    expect(m.avg_dau).toBe(100);
    expect(m.sessions_per_dau).toBe(3.5);
    expect(m.playtime_min_per_dau).toBe(20);
  });
  it('splits ARPDAU into ads and IAP', () => {
    expect(m.arpdau).toBeCloseTo(0.2);
    expect(m.ad_arpdau).toBeCloseTo(0.08);
    expect(m.iap_arpdau).toBeCloseTo(0.12);
  });
  it('computes eCPM, opt-in, conversion and ARPPU', () => {
    expect(m.ecpm).toBe(10);
    expect(m.rewarded_ecpm).toBe(20);
    expect(m.rewarded_opt_in).toBe(0.3);
    expect(m.payer_conversion).toBe(0.02);
    expect(m.arppu).toBe(6);
    expect(m.store_conversion).toBe(0.1);
    expect(m.level_win_rate).toBe(0.7);
  });
  it('returns null ratios when there is no data', () => {
    const empty = engagementAndMoney(toTotals({}, 7));
    expect(empty.arpdau).toBeNull();
    expect(empty.ecpm).toBeNull();
    expect(empty.avg_dau).toBe(0);
  });
});

// Two cohorts: 100 installs on Nov 1 and 50 on Nov 5. Last complete day is Nov 8.
const rows: CohortRow[] = [
  { install_date: '2026-11-01', day_n: 0, active_players: 100, ad_revenue_usd: 5, iap_revenue_net_usd: 0 },
  { install_date: '2026-11-01', day_n: 1, active_players: 40, ad_revenue_usd: 2, iap_revenue_net_usd: 3 },
  { install_date: '2026-11-01', day_n: 7, active_players: 15, ad_revenue_usd: 1, iap_revenue_net_usd: 0 },
  { install_date: '2026-11-05', day_n: 0, active_players: 50, ad_revenue_usd: 1, iap_revenue_net_usd: 0 },
  { install_date: '2026-11-05', day_n: 1, active_players: 25, ad_revenue_usd: 1, iap_revenue_net_usd: 0 },
];
const LAST = '2026-11-08';

describe('cohorts', () => {
  it('blends Dn retention only over cohorts that reached day n', () => {
    const d1 = blendedDay(rows, LAST, 1);
    expect(d1.cohorts).toBe(2);
    expect(d1.players).toBe(150);
    expect(d1.retention).toBeCloseTo(65 / 150);

    const d7 = blendedDay(rows, LAST, 7);
    expect(d7.cohorts).toBe(1); // Nov 5 + 7 = Nov 12, not reached yet
    expect(d7.retention).toBe(0.15);
  });

  it('computes cumulative LTV per installer', () => {
    expect(blendedDay(rows, LAST, 7).ltv).toBeCloseTo(11 / 100);
    expect(blendedDay(rows, LAST, 1).ltv).toBeCloseTo((10 + 2) / 150);
  });

  it('builds the cohort triangle with nulls for days not reached', () => {
    const table = cohortTable(rows, LAST, 7);
    expect(table.map((c) => c.install_date)).toEqual(['2026-11-05', '2026-11-01']);
    const nov5 = table[0]!;
    expect(nov5.size).toBe(50);
    expect(nov5.retention.slice(0, 5)).toEqual([1, 0.5, 0, 0, null]);
    const nov1 = table[1]!;
    expect(nov1.retention[7]).toBe(0.15);
    expect(nov1.retention[3]).toBe(0); // no row means nobody came back that day
    expect(nov1.ltv[7]).toBeCloseTo(0.11);
  });

  it('returns null retention when no cohort is old enough', () => {
    expect(blendedDay(rows, LAST, 30).retention).toBeNull();
  });
});

describe('levelFunnel', () => {
  it('computes difficulty and reach per level', () => {
    const out = levelFunnel([
      { level_number: 2, level_name: 'l2', starts: 120, completes: 60, fails: 60, players_started: 80, players_completed: 60, complete_duration_sec: 3000, completes_with_duration: 60, boosters_used: 12, churned_players: 8 },
      { level_number: 1, level_name: 'l1', starts: 110, completes: 100, fails: 10, players_started: 100, players_completed: 100, complete_duration_sec: 2000, completes_with_duration: 100, boosters_used: 0, churned_players: 0 },
    ]);
    expect(out.map((l) => l.level_number)).toEqual([1, 2]);
    expect(out[1]).toMatchObject({ win_rate: 0.5, attempts_per_completion: 2, avg_completion_sec: 50, reached_share: 0.8, churn_share: 0.1 });
  });
});

describe('integrationChecklist', () => {
  const base = { events_24h: 1, last_seen_at: '2026-11-03T10:00:00Z', missing_level_number: 0, ad_impressions_not_counted: 0, missing_currency_name: 0 };
  it('marks groups ok, missing or warning', () => {
    const list = integrationChecklist([
      { ...base, event_name: 'first_open', events_7d: 5, sources: ['firebase'] },
      { ...base, event_name: 'session_start', events_7d: 9, sources: ['firebase'] },
      { ...base, event_name: 'user_engagement', events_7d: 9, sources: ['firebase'] },
      { ...base, event_name: 'level_start', events_7d: 9, sources: ['unity-0.1.0'] },
      { ...base, event_name: 'level_end', events_7d: 7, sources: ['unity-0.1.0'], missing_level_number: 2 },
    ]);
    const byGroup = Object.fromEntries(list.map((i) => [i.group, i]));
    expect(byGroup.wrapper!.status).toBe('ok');
    expect(byGroup.lifecycle!.status).toBe('ok');
    expect(byGroup.progression!.status).toBe('warning');
    expect(byGroup.progression!.problems[0]).toContain('without level_number');
    expect(byGroup.ads!.status).toBe('missing');
    expect(byGroup.ads!.missing_events).toEqual(['ad_impression']);
  });
  it('accepts either purchase source for IAP', () => {
    const list = integrationChecklist([
      { ...base, event_name: 'store_view', events_7d: 3, sources: ['flutter-0.1.0'] },
      { ...base, event_name: 'in_app_purchase', events_7d: 1, sources: ['firebase'] },
    ]);
    expect(list.find((i) => i.group === 'iap')!.status).toBe('ok');
  });
  it('flags a game with no wrapper events', () => {
    const list = integrationChecklist([{ ...base, event_name: 'first_open', events_7d: 5, sources: ['firebase'] }]);
    expect(list.find((i) => i.group === 'wrapper')!.status).toBe('missing');
  });
});
