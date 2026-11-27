-- Integration checklist: which events each game sent in the last 7 days, from which
-- wrapper versions and platforms. The dashboard turns this into green and red checks.
select
  game_id,
  event_name,
  count(*) as events_7d,
  countif(event_ts >= timestamp_sub(current_timestamp(), interval 1 day)) as events_24h,
  count(distinct player_id) as players_7d,
  max(event_ts) as last_seen_at,
  array_agg(distinct coalesce(kpi_sdk, 'firebase') ignore nulls) as sources,
  array_agg(distinct platform ignore nulls) as platforms,
  -- Share of required params that arrived empty, per event, to catch half-done integrations.
  countif(event_name in ('level_start', 'level_end') and level_number is null) as missing_level_number,
  countif(event_name = 'ad_impression' and (ad_format is null or coalesce(ad_revenue_usd, player_ad_revenue_usd) is null)) as ad_impressions_not_counted,
  countif(event_name in ('earn_virtual_currency', 'spend_virtual_currency') and currency_name is null) as missing_currency_name
from {{ ref('clean_events') }}
where event_date >= date_sub(current_date(), interval 7 day)
group by 1, 2
