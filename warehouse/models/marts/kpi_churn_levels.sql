-- Where players stop: for players inactive for 3+ days, the highest level they reached.
with last_seen as (
  select
    game_id,
    player_id,
    min(install_date) as install_date,
    max(event_date) as last_active_date,
    max(max_level_number) as max_level_reached,
    array_agg(coalesce(platform, 'unknown') order by event_date limit 1)[safe_offset(0)] as platform
  from {{ ref('player_day') }}
  group by 1, 2
)
select
  ls.game_id,
  ls.install_date,
  ls.platform,
  coalesce(pc.country, 'unknown') as country,
  coalesce(ua.ua_source, 'unknown') as ua_source,
  coalesce(ls.max_level_reached, 0) as last_level_number,
  count(*) as churned_players
from last_seen as ls
left join {{ ref('player_attribution') }} as ua using (game_id, player_id)
left join {{ ref('player_country') }} as pc using (game_id, player_id)
where ls.last_active_date <= date_sub(current_date(), interval 3 day)
group by 1, 2, 3, 4, 5, 6
