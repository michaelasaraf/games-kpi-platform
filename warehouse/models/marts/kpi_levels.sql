-- Level funnel and difficulty per game, date, platform and level.
{{
  config(
    materialized='incremental',
    incremental_strategy='insert_overwrite',
    partition_by={'field': 'event_date', 'data_type': 'date', 'granularity': 'day'},
    cluster_by=['game_id']
  )
}}
select
  game_id,
  event_date,
  coalesce(platform, 'unknown') as platform,
  level_number,
  any_value(level_name) as level_name,
  countif(event_name = 'level_start') as starts,
  countif(event_name = 'level_end' and success = 1) as completes,
  countif(event_name = 'level_end' and coalesce(success, 0) = 0) as fails,
  count(distinct if(event_name = 'level_start', player_id, null)) as players_started,
  count(distinct if(event_name = 'level_end' and success = 1, player_id, null)) as players_completed,
  sum(if(event_name = 'level_end' and success = 1, duration_sec, null)) as complete_duration_sec,
  countif(event_name = 'level_end' and success = 1 and duration_sec is not null) as completes_with_duration,
  sum(if(event_name = 'level_end', boosters_used, null)) as boosters_used
from {{ ref('clean_events') }}
where event_name in ('level_start', 'level_end')
  and level_number is not null
  and event_date >= {{ start_date_expr() }}
group by 1, 2, 3, 4
