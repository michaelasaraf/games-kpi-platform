const TOKEN_KEY = 'games_kpi_id_token';

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked: the user signs in again next visit */
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, params?: Record<string, string>): Promise<T> {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  const token = getToken();
  const res = await fetch(`/api${path}${qs}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = (await res.json()).message ?? message;
    } catch {
      /* not JSON */
    }
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export interface Game {
  game_id: string;
  name: string;
  engine: string;
  d1_target: number;
  d7_target: number;
}

export interface Filters {
  from: string;
  to: string;
  platform: 'all' | 'android' | 'ios';
  /** 'all' or a UA source id such as organic, meta, google_ads. */
  source: string;
  /** 'all' or a country name such as 'United States'. */
  country: string;
}

const SOURCE_LABELS: Record<string, string> = {
  organic: 'Organic',
  meta: 'Meta',
  google_ads: 'Google Ads',
  tiktok: 'TikTok',
  apple_search_ads: 'Apple Search Ads',
  unity_ads: 'Unity Ads',
  applovin: 'AppLovin',
  ironsource: 'ironSource',
  mintegral: 'Mintegral',
  moloco: 'Moloco',
  liftoff: 'Liftoff',
  snapchat: 'Snapchat',
  unknown: 'Unknown',
};

/** Display name of a country filter value. */
export function countryLabel(c: string): string {
  return c === 'unknown' ? 'Unknown country' : c;
}

/** Display name of a UA source id. */
export function sourceLabel(id: string): string {
  return SOURCE_LABELS[id] ?? id.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export interface SourceRow {
  ua_source: string;
  installs: number;
  install_share: number | null;
  avg_dau: number | null;
  revenue_usd: number;
  arpdau: number | null;
  d1: DayStat;
  d7: DayStat;
  ltv_d7: DayStat;
}

export interface DayStat {
  day: number;
  cohorts: number;
  players: number;
  retention: number | null;
  ltv: number | null;
  reliable?: boolean;
}

export interface Summary {
  last_complete_date: string;
  avg_dau: number | null;
  installs: number;
  sessions_per_dau: number | null;
  playtime_min_per_dau: number | null;
  revenue_usd: number;
  ad_revenue_usd: number;
  iap_revenue_net_usd: number;
  arpdau: number | null;
  ad_arpdau: number | null;
  iap_arpdau: number | null;
  impressions_per_dau: number | null;
  rewarded_per_dau: number | null;
  interstitial_per_dau: number | null;
  banner_per_dau: number | null;
  ecpm: number | null;
  rewarded_ecpm: number | null;
  interstitial_ecpm: number | null;
  banner_ecpm: number | null;
  rewarded_opt_in: number | null;
  rewarded_offer_acceptance: number | null;
  payer_conversion: number | null;
  arppu: number | null;
  store_conversion: number | null;
  level_win_rate: number | null;
  blocked_share: number | null;
  stickiness: number | null;
  retention: Record<'d1' | 'd3' | 'd7' | 'd14' | 'd30', DayStat>;
  ltv: Record<'d0' | 'd7' | 'd30', DayStat>;
}

export type DailyRow = Omit<Summary, 'retention' | 'ltv' | 'last_complete_date'> & {
  date: string;
  wau: number | null;
  mau: number | null;
};

/** Income next to UA spend over the same days (see api/src/metrics.ts pnl). */
export interface Pnl {
  ad_revenue_usd: number;
  iap_revenue_net_usd: number;
  income_usd: number;
  spend_usd: number;
  profit_usd: number;
  /** Same-period ROAS: income in the range / spend in the range. */
  roas: number | null;
  installs: number;
  paid_installs: number;
  cpi: number | null;
  blended_cpi: number | null;
}

export interface ProfitResponse {
  games: (Pnl & { game_id: string; name: string })[];
  total: Pnl;
  /** All visible games together per day, newest first. */
  daily: (Pnl & { date: string })[];
}

export interface CampaignRow {
  channel: string;
  campaign_id: string;
  campaign_name: string;
  platform: string;
  first_date: string;
  last_date: string;
  spend_usd: number;
  spend_share: number | null;
  impressions: number;
  clicks: number;
  ctr: number | null;
  paid_installs: number;
  cpi: number | null;
  cpm: number | null;
}

/** One row of the campaign > ad set > ad tree on the UA tab. */
export interface AdNode {
  level: 'campaign' | 'adset' | 'ad';
  id: string;
  name: string;
  spend_usd: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  /** Meta's own count and its CPI and purchase ROAS (Meta SDK purchases). */
  paid_installs: number;
  meta_cpi: number | null;
  network_purchase_value_usd: number;
  meta_roas: number | null;
  /** Our own: installs the decrypted Play referrer gives the ad, and their cohorts. */
  installs: number;
  cpi: number | null;
  d1: number | null;
  d7: number | null;
  revenue_d7_usd: number;
  revenue_usd: number;
  roas_d7: number | null;
  roas: number | null;
  /** Enough of our own installs (300+) to judge the ad. */
  reliable: boolean;
  status?: string | null;
  thumbnail_url?: string | null;
  title?: string | null;
  children: AdNode[];
}

export interface UaResponse {
  total: Pnl & { impressions: number; clicks: number; ctr: number | null };
  daily: (Pnl & { date: string })[];
  campaigns: CampaignRow[];
  /** Campaign > ad set > ad, biggest spend first. Empty until the per-ad models are built. */
  ads?: AdNode[];
  /** Top countries by spend, then one row with other: true for the rest. */
  countries: (Pnl & { country: string; other: boolean })[];
}
