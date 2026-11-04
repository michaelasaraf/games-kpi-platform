-- DAU, WAU and MAU per game, date, platform and UA source. Distinct counts over rolling
-- windows are not additive, so they get their own table. A player keeps one platform and one
-- UA source per game (Firebase ids are per install), so the API can still sum those.
with players as (
  select pd.game_id, pd.event_date, pd.player_id, pd.platform, ua.ua_source
  from {{ ref('player_day') }} as pd
  left join {{ ref('player_attribution') }} as ua using (game_id, player_id)
),
days as (
  select distinct game_id, event_date from players
)
select
  d.game_id,
  d.event_date,
  coalesce(p.platform, 'unknown') as platform,
  coalesce(p.ua_source, 'unknown') as ua_source,
  count(distinct if(p.event_date = d.event_date, p.player_id, null)) as dau,
  count(distinct if(p.event_date > date_sub(d.event_date, interval 7 day), p.player_id, null)) as wau,
  count(distinct p.player_id) as mau
from days as d
join players as p
  on p.game_id = d.game_id
 and p.event_date between date_sub(d.event_date, interval 29 day) and d.event_date
group by 1, 2, 3, 4
