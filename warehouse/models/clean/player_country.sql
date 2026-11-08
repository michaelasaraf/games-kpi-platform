{#-
  One row per game and player: the player's country, from the first day they were seen.
  A player keeps one country so distinct counts (WAU, MAU, funnel players) can be summed
  across countries without counting a traveller twice. Players with no country are left out;
  the marts count them as 'unknown'.
-#}
{{ config(materialized='table', cluster_by=['game_id', 'player_id']) }}

select
  game_id,
  player_id,
  array_agg(country order by event_date limit 1)[safe_offset(0)] as country
from {{ ref('player_day') }}
where country is not null
group by game_id, player_id
