// Pure KPI math. Everything here is unit tested; the SQL only sums and counts.

export function div(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return a / b;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const n = (v: unknown): number => (typeof v === 'number' ? v : v == null ? 0 : Number(v));

/** Additive totals from kpi_daily, summed over any filter. `dau` is player-days. */
export interface Totals {
  days: number;
  dau: number;
  new_players: number;
  sessions: number;
  playtime_sec: number;
  level_starts: number;
  level_completes: number;
  level_fails: number;
  ad_impressions: number;
  rewarded_impressions: number;
  interstitial_impressions: number;
  banner_impressions: number;
  rewarded_viewers: number;
  ad_revenue_usd: number;
  rewarded_revenue_usd: number;
  interstitial_revenue_usd: number;
  banner_revenue_usd: number;
  ad_offers_shown: number;
  ad_offers_accepted: number;
  purchases: number;
  payers: number;
  iap_revenue_gross_usd: number;
  iap_revenue_net_usd: number;
  store_viewers: number;
  store_viewer_payers: number;
  blocked_players: number;
  blocker_hits: number;
}

export const TOTAL_FIELDS = [
  'dau', 'new_players', 'sessions', 'playtime_sec', 'level_starts', 'level_completes', 'level_fails',
  'ad_impressions', 'rewarded_impressions', 'interstitial_impressions', 'banner_impressions',
  'rewarded_viewers', 'ad_revenue_usd', 'rewarded_revenue_usd', 'interstitial_revenue_usd',
  'banner_revenue_usd', 'ad_offers_shown', 'ad_offers_accepted', 'purchases', 'payers',
  'iap_revenue_gross_usd', 'iap_revenue_net_usd', 'store_viewers', 'store_viewer_payers',
  'blocked_players', 'blocker_hits',
] as const satisfies readonly (keyof Totals)[];

export function toTotals(row: Record<string, unknown>, days: number): Totals {
  const t = { days } as Totals;
  for (const f of TOTAL_FIELDS) t[f] = n(row[f]);
  return t;
}

/** Ratios a PM reads, from additive totals. Null when the denominator is zero. */
export function engagementAndMoney(t: Totals) {
  const revenue = t.ad_revenue_usd + t.iap_revenue_net_usd;
  return {
    avg_dau: div(t.dau, t.days),
    installs: t.new_players,
    sessions_per_dau: div(t.sessions, t.dau),
    playtime_min_per_dau: div(t.playtime_sec / 60, t.dau),
    revenue_usd: revenue,
    ad_revenue_usd: t.ad_revenue_usd,
    iap_revenue_net_usd: t.iap_revenue_net_usd,
    iap_revenue_gross_usd: t.iap_revenue_gross_usd,
    arpdau: div(revenue, t.dau),
    ad_arpdau: div(t.ad_revenue_usd, t.dau),
    iap_arpdau: div(t.iap_revenue_net_usd, t.dau),
    impressions_per_dau: div(t.ad_impressions, t.dau),
    rewarded_per_dau: div(t.rewarded_impressions, t.dau),
    interstitial_per_dau: div(t.interstitial_impressions, t.dau),
    banner_per_dau: div(t.banner_impressions, t.dau),
    ecpm: div(t.ad_revenue_usd * 1000, t.ad_impressions),
    rewarded_ecpm: div(t.rewarded_revenue_usd * 1000, t.rewarded_impressions),
    interstitial_ecpm: div(t.interstitial_revenue_usd * 1000, t.interstitial_impressions),
    banner_ecpm: div(t.banner_revenue_usd * 1000, t.banner_impressions),
    rewarded_opt_in: div(t.rewarded_viewers, t.dau),
    rewarded_offer_acceptance: div(t.ad_offers_accepted, t.ad_offers_shown),
    payer_conversion: div(t.payers, t.dau),
    arppu: div(t.iap_revenue_net_usd, t.payers),
    store_conversion: div(t.store_viewer_payers, t.store_viewers),
    level_win_rate: div(t.level_completes, t.level_completes + t.level_fails),
    blocked_share: div(t.blocked_players, t.dau),
  };
}

/** One row of kpi_cohort summed over platform and country: install day x day since install. */
export interface CohortRow {
  install_date: string;
  day_n: number;
  active_players: number;
  ad_revenue_usd: number;
  iap_revenue_net_usd: number;
}

export interface CohortSummary {
  install_date: string;
  size: number;
  /** retention[d] = share of the cohort active on day d; null when day d is not over yet. */
  retention: (number | null)[];
  /** ltv[d] = cumulative revenue per installer up to and including day d. */
  ltv: (number | null)[];
}

function indexCohorts(rows: CohortRow[]) {
  const byDate = new Map<string, Map<number, CohortRow>>();
  for (const r of rows) {
    const row = {
      ...r,
      day_n: n(r.day_n),
      active_players: n(r.active_players),
      ad_revenue_usd: n(r.ad_revenue_usd),
      iap_revenue_net_usd: n(r.iap_revenue_net_usd),
    };
    if (!byDate.has(row.install_date)) byDate.set(row.install_date, new Map());
    byDate.get(row.install_date)!.set(row.day_n, row);
  }
  return byDate;
}

/**
 * Cohort table. `lastCompleteDate` is the last fully processed day: day d of a cohort counts
 * only once install_date + d <= lastCompleteDate. Cohort size = players active on day 0.
 */
export function cohortTable(rows: CohortRow[], lastCompleteDate: string, maxDay = 30): CohortSummary[] {
  const byDate = indexCohorts(rows);
  const out: CohortSummary[] = [];
  for (const [installDate, days] of [...byDate.entries()].sort(([a], [b]) => (a < b ? 1 : -1))) {
    const size = days.get(0)?.active_players ?? 0;
    if (size === 0) continue;
    const reached = daysBetween(installDate, lastCompleteDate);
    const retention: (number | null)[] = [];
    const ltv: (number | null)[] = [];
    let cumulative = 0;
    for (let d = 0; d <= maxDay; d++) {
      const r = days.get(d);
      cumulative += (r?.ad_revenue_usd ?? 0) + (r?.iap_revenue_net_usd ?? 0);
      if (d > reached) {
        retention.push(null);
        ltv.push(null);
      } else {
        retention.push((r?.active_players ?? 0) / size);
        ltv.push(cumulative / size);
      }
    }
    out.push({ install_date: installDate, size, retention, ltv });
  }
  return out;
}

/**
 * Size-weighted retention and LTV on day d across all cohorts that have reached day d.
 * Returns null when no cohort has reached day d yet.
 */
export function blendedDay(rows: CohortRow[], lastCompleteDate: string, day: number) {
  const byDate = indexCohorts(rows);
  let size = 0;
  let active = 0;
  let revenue = 0;
  let cohorts = 0;
  for (const [installDate, days] of byDate) {
    const cohortSize = days.get(0)?.active_players ?? 0;
    if (cohortSize === 0 || addDays(installDate, day) > lastCompleteDate) continue;
    cohorts++;
    size += cohortSize;
    active += days.get(day)?.active_players ?? 0;
    for (let d = 0; d <= day; d++) {
      const r = days.get(d);
      revenue += (r?.ad_revenue_usd ?? 0) + (r?.iap_revenue_net_usd ?? 0);
    }
  }
  return {
    day,
    cohorts,
    players: size,
    retention: div(active, size),
    ltv: div(revenue, size),
  };
}

/** Below this many installs a retention or LTV figure is shown greyed out as unreliable. */
export const MIN_RELIABLE_COHORT = 1000;

export interface LevelRow {
  level_number: number;
  level_name: string | null;
  starts: number;
  completes: number;
  fails: number;
  players_started: number;
  players_completed: number;
  complete_duration_sec: number;
  completes_with_duration: number;
  boosters_used: number;
  churned_players?: number;
}

/** Level funnel: difficulty per level and the share of level-1 players who got that far. */
export function levelFunnel(rows: LevelRow[]) {
  const sorted = [...rows].map((r) => ({ ...r, level_number: n(r.level_number) })).sort((a, b) => a.level_number - b.level_number);
  const firstPlayers = n(sorted[0]?.players_started);
  return sorted.map((r) => ({
    level_number: r.level_number,
    level_name: r.level_name,
    starts: n(r.starts),
    completes: n(r.completes),
    fails: n(r.fails),
    players_started: n(r.players_started),
    players_completed: n(r.players_completed),
    win_rate: div(n(r.completes), n(r.completes) + n(r.fails)),
    attempts_per_completion: div(n(r.starts), n(r.completes)),
    avg_completion_sec: div(n(r.complete_duration_sec), n(r.completes_with_duration)),
    boosters_per_attempt: div(n(r.boosters_used), n(r.completes) + n(r.fails)),
    reached_share: div(n(r.players_started), firstPlayers),
    churned_players: n(r.churned_players),
    churn_share: div(n(r.churned_players), n(r.players_started)),
  }));
}

/** Event groups the integration checklist checks, and which events satisfy each. */
export const CHECKLIST: { group: string; label: string; anyOf: string[][]; ifMissing?: string }[] = [
  { group: 'lifecycle', label: 'Installs, sessions and playtime (automatic)', anyOf: [['first_open', 'session_start', 'user_engagement']] },
  { group: 'tutorial', label: 'Tutorial funnel', anyOf: [['tutorial_begin', 'tutorial_step', 'tutorial_complete']] },
  { group: 'progression', label: 'Level start and end', anyOf: [['level_start', 'level_end']] },
  { group: 'ads', label: 'Ad impressions with revenue', anyOf: [['ad_impression']] },
  { group: 'rewarded_offers', label: 'Rewarded ad offers', anyOf: [['ad_offer_shown', 'ad_offer_accepted']] },
  { group: 'iap', label: 'Store views and purchases', anyOf: [['store_view', 'iap_purchase'], ['store_view', 'in_app_purchase']] },
  { group: 'economy', label: 'Currency earned and spent', anyOf: [['earn_virtual_currency', 'spend_virtual_currency']] },
  { group: 'blockers', label: 'Blockers (out of lives, coins)', anyOf: [['blocker_hit']] },
  {
    group: 'attribution',
    label: 'UA source (Play referrer or attribution SDK)',
    anyOf: [['install_attribution']],
    ifMissing: 'No install_attribution yet: players are split by Firebase\'s install source only, which cannot see Meta. Check the game runs the current wrapper on Android, and forwards Tenjin attribution where the game has Tenjin.',
  },
];

export interface HealthRow {
  event_name: string;
  /** kpi_sdk values seen ('firebase' for Firebase's own events). */
  sources?: string[];
  events_7d: number;
  events_24h: number;
  last_seen_at: string | null;
  missing_level_number: number;
  ad_impressions_not_counted: number;
  missing_currency_name: number;
}

export function integrationChecklist(rows: HealthRow[]) {
  const seen = new Map(rows.map((r) => [r.event_name, r]));
  const wrapperRows = rows.filter((r) => (r.sources ?? []).some((s) => s !== 'firebase'));
  const wrapper = {
    group: 'wrapper',
    label: 'Games KPI wrapper sending events',
    status: wrapperRows.length ? 'ok' : 'missing',
    missing_events: [] as string[],
    problems: wrapperRows.length ? [] : ['No event from the Unity or Flutter wrapper yet: check that Kpi.init() runs after Firebase starts.'],
    events_7d: wrapperRows.reduce((s, r) => s + n(r.events_7d), 0),
    last_seen_at: wrapperRows.map((r) => r.last_seen_at).filter(Boolean).sort().at(-1) ?? null,
  };
  return [wrapper, ...CHECKLIST.map((item) => {
    const satisfied = item.anyOf.find((set) => set.every((e) => n(seen.get(e)?.events_7d) > 0));
    const relevant = [...new Set(item.anyOf.flat())];
    const problems: string[] = [];
    for (const e of relevant) {
      const r = seen.get(e);
      if (!r) continue;
      if (n(r.missing_level_number) > 0) problems.push(`${r.missing_level_number} ${e} events without level_number`);
      if (n(r.ad_impressions_not_counted) > 0) problems.push(`${r.ad_impressions_not_counted} ad_impression events without format or revenue (check ad_revenue_source)`);
      if (n(r.missing_currency_name) > 0) problems.push(`${r.missing_currency_name} ${e} events without virtual_currency_name`);
    }
    const missing = satisfied ? [] : (item.anyOf[0] ?? []).filter((e) => !(n(seen.get(e)?.events_7d) > 0));
    if (!satisfied && item.ifMissing) problems.push(item.ifMissing);
    return {
      group: item.group,
      label: item.label,
      // An item with an ifMissing note is optional: it warns instead of failing.
      status: !satisfied ? (item.ifMissing ? 'warning' : 'missing') : problems.length ? 'warning' : 'ok',
      missing_events: missing,
      problems,
      events_7d: relevant.reduce((s, e) => s + n(seen.get(e)?.events_7d), 0),
      last_seen_at: relevant.map((e) => seen.get(e)?.last_seen_at ?? null).filter(Boolean).sort().at(-1) ?? null,
    };
  })];
}

/** Income and UA spend for one slice (a game, a day, a campaign, a country). */
export interface PnlInput {
  ad_revenue_usd: number;
  iap_revenue_net_usd: number;
  spend_usd: number;
  /** Every new player (organic and paid) in the slice. */
  installs: number;
  /** Installs the ad networks report for their own campaigns. */
  paid_installs: number;
}

/**
 * Income minus UA spend over the same days. ROAS here is same-period (blended): all income in the
 * range divided by spend in the range, since store revenue has no player to tie to a campaign.
 */
export function pnl(i: PnlInput) {
  const income = i.ad_revenue_usd + i.iap_revenue_net_usd;
  return {
    ad_revenue_usd: i.ad_revenue_usd,
    iap_revenue_net_usd: i.iap_revenue_net_usd,
    income_usd: income,
    spend_usd: i.spend_usd,
    profit_usd: income - i.spend_usd,
    roas: i.spend_usd > 0 ? income / i.spend_usd : null,
    installs: i.installs,
    paid_installs: i.paid_installs,
    cpi: i.paid_installs > 0 ? i.spend_usd / i.paid_installs : null,
    blended_cpi: i.installs > 0 && i.spend_usd > 0 ? i.spend_usd / i.installs : null,
  };
}

/** Sums PnlInput-shaped rows (numbers may arrive as strings from the warehouse). */
export function sumPnl(rows: object[]): PnlInput {
  const t: PnlInput = { ad_revenue_usd: 0, iap_revenue_net_usd: 0, spend_usd: 0, installs: 0, paid_installs: 0 };
  for (const r of rows) for (const k of Object.keys(t) as (keyof PnlInput)[]) t[k] += Number((r as Record<string, unknown>)[k] ?? 0) || 0;
  return t;
}

/** Ads with fewer of our own attributed installs than this are shown greyed out (too noisy to judge). */
export const MIN_RELIABLE_AD_INSTALLS = 300;

/** One ad's spend in the range, from kpi_ua_spend (Meta's own numbers). */
export interface AdSpendRow {
  campaign_id: string;
  campaign_name: string | null;
  adset_id: string;
  adset_name: string | null;
  ad_id: string;
  ad_name: string | null;
  spend_usd: number;
  /** Spend on days at least 7 days ago: the base of D7 ROAS. */
  spend_d7_usd: number;
  impressions: number;
  clicks: number;
  paid_installs: number;
  network_purchases: number;
  network_purchase_value_usd: number;
}

/** One ad's install cohorts in the range, from kpi_ua_ad_cohort (our own attribution). */
export interface AdCohortRow {
  campaign_id: string;
  adset_id: string;
  ad_id: string;
  installs: number;
  /** Installs at least 1 (7) days old, and how many of them came back on day 1 (7). */
  installs_d1: number;
  returned_d1: number;
  installs_d7: number;
  returned_d7: number;
  /** Revenue in days 0-7 of the installs at least 7 days old. */
  revenue_d7_usd: number;
  revenue_usd: number;
}

export interface AdInfo {
  ad_id: string;
  status: string | null;
  thumbnail_url: string | null;
  title: string | null;
}

const AD_SUMS = ['spend_usd', 'spend_d7_usd', 'impressions', 'clicks', 'paid_installs', 'network_purchases',
  'network_purchase_value_usd', 'installs', 'installs_d1', 'returned_d1', 'installs_d7', 'returned_d7',
  'revenue_d7_usd', 'revenue_usd'] as const;
type AdSums = Record<(typeof AD_SUMS)[number], number>;

export interface AdNode extends AdSums {
  level: 'campaign' | 'adset' | 'ad';
  id: string;
  name: string;
  ctr: number | null;
  /** Spend per install Meta reports, and per install our attribution gives the ad. */
  meta_cpi: number | null;
  cpi: number | null;
  d1: number | null;
  d7: number | null;
  roas_d7: number | null;
  roas: number | null;
  /** Purchase value Meta reports (Meta SDK purchases) / spend. */
  meta_roas: number | null;
  reliable: boolean;
  status?: string | null;
  thumbnail_url?: string | null;
  title?: string | null;
  children: AdNode[];
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

function node(level: AdNode['level'], id: string, name: string, s: AdSums, children: AdNode[]): AdNode {
  return {
    level, id, name, ...s, children,
    ctr: ratio(s.clicks, s.impressions),
    meta_cpi: ratio(s.spend_usd, s.paid_installs),
    cpi: ratio(s.spend_usd, s.installs),
    d1: ratio(s.returned_d1, s.installs_d1),
    d7: ratio(s.returned_d7, s.installs_d7),
    roas_d7: s.installs_d7 > 0 ? ratio(s.revenue_d7_usd, s.spend_d7_usd) : null,
    roas: s.installs > 0 ? ratio(s.revenue_usd, s.spend_usd) : null,
    // No purchase value at all usually means the game sends Meta no purchase events: show nothing, not 0%.
    meta_roas: s.network_purchase_value_usd > 0 ? ratio(s.network_purchase_value_usd, s.spend_usd) : null,
    reliable: s.installs >= MIN_RELIABLE_AD_INSTALLS,
  };
}

function addSums(rows: object[]): AdSums {
  const t = Object.fromEntries(AD_SUMS.map((k) => [k, 0])) as AdSums;
  for (const r of rows) for (const k of AD_SUMS) t[k] += Number((r as Record<string, unknown>)[k] ?? 0) || 0;
  return t;
}

/**
 * Campaign > ad set > ad tree with Meta's spend next to our own installs, retention and revenue
 * per ad, biggest spend first. Ads with installs but no spend in the range are kept.
 */
export function adTree(spend: AdSpendRow[], cohorts: AdCohortRow[], info: AdInfo[] = []): AdNode[] {
  const key = (r: { campaign_id: string; adset_id: string; ad_id: string }) => `${r.campaign_id}|${r.adset_id}|${r.ad_id}`;
  type Ad = { campaign_id: string; adset_id: string; ad_id: string; names: Partial<AdSpendRow>; rows: object[] };
  const ads = new Map<string, Ad>();
  for (const r of [...spend, ...cohorts]) {
    const k = key(r);
    const a = ads.get(k) ?? { campaign_id: r.campaign_id, adset_id: r.adset_id, ad_id: r.ad_id, names: {}, rows: [] };
    a.rows.push(r);
    if ('campaign_name' in r) a.names = r;
    ads.set(k, a);
  }
  const infoById = new Map(info.map((i) => [i.ad_id, i]));
  const bySpend = (a: AdNode, b: AdNode) => b.spend_usd - a.spend_usd || b.installs - a.installs;
  const campaigns = new Map<string, Map<string, Ad[]>>();
  for (const a of ads.values()) {
    const sets = campaigns.get(a.campaign_id) ?? new Map<string, Ad[]>();
    sets.set(a.adset_id, [...(sets.get(a.adset_id) ?? []), a]);
    campaigns.set(a.campaign_id, sets);
  }
  const out: AdNode[] = [];
  for (const [campaignId, sets] of campaigns) {
    const setNodes: AdNode[] = [];
    let campaignName = '';
    for (const [adsetId, list] of sets) {
      let adsetName = '';
      const adNodes = list.map((a) => {
        campaignName ||= a.names.campaign_name ?? '';
        adsetName ||= a.names.adset_name ?? '';
        const i = infoById.get(a.ad_id);
        const n = node('ad', a.ad_id, a.ad_id ? (a.names.ad_name ?? `Ad ${a.ad_id}`) : 'Before per-ad data', addSums(a.rows), []);
        return { ...n, status: i?.status ?? null, thumbnail_url: i?.thumbnail_url ?? null, title: i?.title ?? null };
      }).sort(bySpend);
      setNodes.push(node('adset', adsetId, adsetName || `Ad set ${adsetId}`, addSums(adNodes), adNodes));
    }
    setNodes.sort(bySpend);
    out.push(node('campaign', campaignId, campaignName || `Campaign ${campaignId}`, addSums(setNodes), setNodes));
  }
  return out.sort(bySpend);
}
