-- DAU, WAU and MAU per game, date, platform, country and UA source. Distinct counts over rolling
-- windows are not additive, so they get their own table. A player keeps one platform, one
-- country (player_country) and one UA source per game, so the API can still sum those.
-- Days before the BigQuery export (and its partial first day) come from GA4's own 1/7/28-day
-- active users in history_daily, with ua_source 'unknown'; MAU there is GA4's 28-day count.
with ga4 as (
  select * from {{ ref('history_daily') }} where source = 'ga4'
),
players as (
  select pd.game_id, pd.event_date, pd.player_id, pd.platform, pc.country, ua.ua_source
  from {{ ref('player_day') }} as pd
  left join {{ ref('player_attribution') }} as ua using (game_id, player_id)
  left join {{ ref('player_country') }} as pc using (game_id, player_id)
),
days as (
  select distinct p.game_id, p.event_date
  from players as p
  left join (select distinct game_id, event_date from ga4) as h
    on h.game_id = p.game_id and h.event_date = p.event_date
  where h.game_id is null
)
select
  d.game_id,
  d.event_date,
  coalesce(p.platform, 'unknown') as platform,
  coalesce(p.country, 'unknown') as country,
  coalesce(p.ua_source, 'unknown') as ua_source,
  count(distinct if(p.event_date = d.event_date, p.player_id, null)) as dau,
  count(distinct if(p.event_date > date_sub(d.event_date, interval 7 day), p.player_id, null)) as wau,
  count(distinct p.player_id) as mau
from days as d
join players as p
  on p.game_id = d.game_id
 and p.event_date between date_sub(d.event_date, interval 29 day) and d.event_date
group by 1, 2, 3, 4, 5

union all

select game_id, event_date, platform, country, 'unknown' as ua_source,
  sum(dau) as dau, sum(wau) as wau, sum(mau) as mau
from ga4
group by 1, 2, 3, 4
