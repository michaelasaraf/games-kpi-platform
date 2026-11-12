{#-
  Install cohorts of the players a Meta ad brought (player_meta_ad), by campaign, ad set and ad and
  by day since install: retention, revenue and payers per ad. With kpi_ua_spend (spend per ad and day)
  this gives CPI, retention and ROAS per campaign, ad set and ad.

  Revenue is per player (player_day.player_*: Firebase ad_impression and in_app_purchase events), not
  the store and AdMob totals, so it covers only what those events carry (AdMob linked to Firebase).
  As in kpi_cohort, a cohort is the player's platform and country on their install day.
-#}
with cohort_players as (
  select
    pd.game_id,
    pd.player_id,
    pd.install_date,
    coalesce(pd.platform, 'unknown') as platform,
    coalesce(pd.country, 'unknown') as country,
    coalesce(m.campaign_id, '') as campaign_id,
    coalesce(m.adset_id, '') as adset_id,
    coalesce(m.ad_id, '') as ad_id
  from {{ ref('player_day') }} as pd
  join {{ ref('player_meta_ad') }} as m using (game_id, player_id)
  where pd.days_since_install = 0
),

cohort_sizes as (
  select game_id, install_date, platform, country, campaign_id, adset_id, ad_id, count(*) as cohort_size
  from cohort_players
  group by 1, 2, 3, 4, 5, 6, 7
)

select
  c.game_id,
  c.install_date,
  c.platform,
  c.country,
  c.campaign_id,
  c.adset_id,
  c.ad_id,
  pd.days_since_install as day_n,
  count(*) as active_players,
  sum(pd.player_ad_revenue_usd) as ad_revenue_usd,
  sum(pd.player_iap_revenue_net_usd) as iap_revenue_net_usd,
  countif(pd.player_purchases > 0) as payers,
  sum(pd.playtime_sec) as playtime_sec,
  any_value(s.cohort_size) as cohort_size
from cohort_players as c
join {{ ref('player_day') }} as pd
  on pd.game_id = c.game_id
 and pd.player_id = c.player_id
join cohort_sizes as s
  on s.game_id = c.game_id and s.install_date = c.install_date and s.platform = c.platform
 and s.country = c.country and s.campaign_id = c.campaign_id and s.adset_id = c.adset_id and s.ad_id = c.ad_id
where pd.days_since_install between 0 and 90
group by 1, 2, 3, 4, 5, 6, 7, 8
