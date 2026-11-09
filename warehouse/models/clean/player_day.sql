{#-
  One row per game, player and game-local day. Almost every KPI is computed from this
  table, which is small compared with clean_events (one row per daily active player).
-#}
{{
  config(
    materialized='incremental',
    incremental_strategy='insert_overwrite',
    partition_by={'field': 'event_date', 'data_type': 'date', 'granularity': 'day'},
    cluster_by=['game_id', 'install_date'],
    on_schema_change='append_new_columns'
  )
}}

select
  game_id,
  event_date,
  player_id,
  min(install_date) as install_date,
  date_diff(event_date, min(install_date), day) as days_since_install,
  -- Latest known attributes of the day.
  array_agg(platform ignore nulls order by event_ts desc limit 1)[safe_offset(0)] as platform,
  array_agg(country ignore nulls order by event_ts desc limit 1)[safe_offset(0)] as country,
  array_agg(app_version ignore nulls order by event_ts desc limit 1)[safe_offset(0)] as app_version,

  count(*) as events,
  count(distinct session_id) as sessions,
  coalesce(sum(engagement_msec), 0) / 1000 as playtime_sec,

  countif(event_name = 'tutorial_begin' or (is_tutorial_step and tutorial_step = 0)) > 0 as tutorial_began,
  countif(event_name = 'tutorial_complete') > 0 as tutorial_completed,
  countif(event_name = 'level_start') as level_starts,
  countif(event_name = 'level_end' and success = 1) as level_completes,
  countif(event_name = 'level_end' and coalesce(success, 0) = 0) as level_fails,
  -- level_up: games that log only Firebase's level_up with the player's level;
  -- is_game_level_up: games with the level in the event name (level_event_pattern).
  max(if(event_name in ('level_start', 'level_end', 'level_up') or is_game_level_up, level_number, null)) as max_level_number,
  max(if(event_name = 'level_end' and success = 1, level_number, null)) as max_level_completed,

  countif(ad_revenue_usd is not null) as ad_impressions,
  countif(ad_revenue_usd is not null and ad_format = 'rewarded') as rewarded_impressions,
  countif(ad_revenue_usd is not null and ad_format = 'interstitial') as interstitial_impressions,
  countif(ad_revenue_usd is not null and ad_format = 'banner') as banner_impressions,
  coalesce(sum(ad_revenue_usd), 0) as ad_revenue_usd,
  coalesce(sum(if(ad_format = 'rewarded', ad_revenue_usd, null)), 0) as rewarded_revenue_usd,
  coalesce(sum(if(ad_format = 'interstitial', ad_revenue_usd, null)), 0) as interstitial_revenue_usd,
  coalesce(sum(if(ad_format = 'banner', ad_revenue_usd, null)), 0) as banner_revenue_usd,
  countif(event_name = 'ad_offer_shown') as ad_offers_shown,
  countif(event_name = 'ad_offer_accepted') as ad_offers_accepted,

  countif(iap_revenue_usd is not null) as purchases,
  coalesce(sum(iap_revenue_usd), 0) as iap_revenue_gross_usd,
  coalesce(sum(iap_revenue_usd * (1 - store_fee)), 0) - coalesce(sum(refund_usd * (1 - store_fee)), 0) as iap_revenue_net_usd,
  countif(event_name = 'store_view') as store_views,
  countif(event_name = 'offer_shown') as offers_shown,

  countif(event_name = 'blocker_hit') as blocker_hits,
  countif(event_name = 'item_used') as items_used
from {{ ref('clean_events') }}
where event_date >= {{ start_date_expr() }}
group by game_id, event_date, player_id
