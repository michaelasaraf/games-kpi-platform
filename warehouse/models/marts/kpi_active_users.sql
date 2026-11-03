-- DAU, WAU and MAU per game, date and platform. Distinct counts over rolling windows are not
-- additive, so they get their own table. A player keeps one platform per game (Firebase ids
-- are per install), so the API can still sum platforms.
with days as (
  select distinct game_id, event_date from {{ ref('player_day') }}
)
select
  d.game_id,
  d.event_date,
  coalesce(p.platform, 'unknown') as platform,
  count(distinct if(p.event_date = d.event_date, p.player_id, null)) as dau,
  count(distinct if(p.event_date > date_sub(d.event_date, interval 7 day), p.player_id, null)) as wau,
  count(distinct p.player_id) as mau
from days as d
join {{ ref('player_day') }} as p
  on p.game_id = d.game_id
 and p.event_date between date_sub(d.event_date, interval 29 day) and d.event_date
group by 1, 2, 3
