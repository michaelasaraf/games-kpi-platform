-- Install cohorts by day since install, for retention (Dn) and LTV.
-- A cohort is defined by the player's platform and country on their install day, and UA source.
-- Only players whose install day is in the data are counted, so cohorts are complete.
with cohort_players as (
  select
    game_id,
    player_id,
    install_date,
    coalesce(platform, 'unknown') as platform,
    coalesce(country, 'unknown') as country,
    coalesce(ua.ua_source, 'unknown') as ua_source
  from {{ ref('player_day') }}
  left join {{ ref('player_attribution') }} as ua using (game_id, player_id)
  where days_since_install = 0
),

cohort_sizes as (
  select game_id, install_date, platform, country, ua_source, count(*) as cohort_size
  from cohort_players
  group by 1, 2, 3, 4, 5, 6
),

activity as (
  select
    c.game_id,
    c.install_date,
    c.platform,
    c.country,
    c.ua_source,
    pd.days_since_install as day_n,
    count(*) as active_players,
    sum(pd.ad_revenue_usd) as ad_revenue_usd,
    sum(pd.iap_revenue_net_usd) as iap_revenue_net_usd,
    countif(pd.purchases > 0) as payers,
    sum(pd.playtime_sec) as playtime_sec
  from cohort_players as c
  join {{ ref('player_day') }} as pd
    on pd.game_id = c.game_id
   and pd.player_id = c.player_id
  where pd.days_since_install between 0 and 180
  group by 1, 2, 3, 4, 5, 6
)

select
  a.*,
  s.cohort_size
from activity as a
join cohort_sizes as s using (game_id, install_date, platform, country, ua_source)
