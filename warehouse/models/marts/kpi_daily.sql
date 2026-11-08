-- Additive daily totals per game, date, platform, country and UA source. The API sums these
-- over any filter and divides (for example ARPDAU = (ad + IAP net revenue) / DAU).
-- Games on store revenue (play_reports, admob_api) get extra rows from store_revenue with
-- ua_source 'unattributed' and no players: the stores report totals, not players.
select
  pd.game_id,
  pd.event_date,
  coalesce(pd.platform, 'unknown') as platform,
  coalesce(pd.country, 'unknown') as country,
  coalesce(ua.ua_source, 'unknown') as ua_source,
  count(*) as dau,
  countif(days_since_install = 0) as new_players,
  sum(sessions) as sessions,
  sum(playtime_sec) as playtime_sec,
  sum(level_starts) as level_starts,
  sum(level_completes) as level_completes,
  sum(level_fails) as level_fails,
  sum(ad_impressions) as ad_impressions,
  sum(rewarded_impressions) as rewarded_impressions,
  sum(interstitial_impressions) as interstitial_impressions,
  sum(banner_impressions) as banner_impressions,
  countif(rewarded_impressions > 0) as rewarded_viewers,
  sum(ad_revenue_usd) as ad_revenue_usd,
  sum(rewarded_revenue_usd) as rewarded_revenue_usd,
  sum(interstitial_revenue_usd) as interstitial_revenue_usd,
  sum(banner_revenue_usd) as banner_revenue_usd,
  sum(ad_offers_shown) as ad_offers_shown,
  sum(ad_offers_accepted) as ad_offers_accepted,
  sum(purchases) as purchases,
  countif(purchases > 0) as payers,
  sum(iap_revenue_gross_usd) as iap_revenue_gross_usd,
  sum(iap_revenue_net_usd) as iap_revenue_net_usd,
  countif(store_views > 0) as store_viewers,
  countif(store_views > 0 and purchases > 0) as store_viewer_payers,
  countif(blocker_hits > 0) as blocked_players,
  sum(blocker_hits) as blocker_hits
from {{ ref('player_day') }} as pd
left join {{ ref('player_attribution') }} as ua using (game_id, player_id)
group by 1, 2, 3, 4, 5

union all

select
  game_id,
  revenue_date as event_date,
  platform,
  country,
  'unattributed' as ua_source,
  0 as dau,
  0 as new_players,
  0 as sessions,
  0 as playtime_sec,
  0 as level_starts,
  0 as level_completes,
  0 as level_fails,
  sum(if(revenue_type = 'ad', impressions, 0)) as ad_impressions,
  sum(if(ad_format = 'rewarded', impressions, 0)) as rewarded_impressions,
  sum(if(ad_format = 'interstitial', impressions, 0)) as interstitial_impressions,
  sum(if(ad_format = 'banner', impressions, 0)) as banner_impressions,
  0 as rewarded_viewers,
  sum(if(revenue_type = 'ad', net_usd, 0)) as ad_revenue_usd,
  sum(if(ad_format = 'rewarded', net_usd, 0)) as rewarded_revenue_usd,
  sum(if(ad_format = 'interstitial', net_usd, 0)) as interstitial_revenue_usd,
  sum(if(ad_format = 'banner', net_usd, 0)) as banner_revenue_usd,
  0 as ad_offers_shown,
  0 as ad_offers_accepted,
  sum(orders) as purchases,
  0 as payers,
  sum(if(revenue_type = 'iap', gross_usd, 0)) as iap_revenue_gross_usd,
  sum(if(revenue_type = 'iap', net_usd, 0)) as iap_revenue_net_usd,
  0 as store_viewers,
  0 as store_viewer_payers,
  0 as blocked_players,
  0 as blocker_hits
from {{ ref('store_revenue') }}
group by 1, 2, 3, 4
