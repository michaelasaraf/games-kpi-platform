-- Currency sources and sinks per game, date, platform, country, UA source and currency.
-- Incremental: a day keeps the UA source players had when it was last rebuilt.
{{
  config(
    materialized='incremental',
    incremental_strategy='insert_overwrite',
    partition_by={'field': 'event_date', 'data_type': 'date', 'granularity': 'day'},
    on_schema_change='append_new_columns',
    cluster_by=['game_id', 'currency_name']
  )
}}
select
  e.game_id,
  e.event_date,
  coalesce(e.platform, 'unknown') as platform,
  coalesce(pc.country, 'unknown') as country,
  coalesce(ua.ua_source, 'unknown') as ua_source,
  currency_name,
  if(event_name = 'earn_virtual_currency', 'source', 'sink') as flow,
  coalesce(if(event_name = 'earn_virtual_currency', currency_source, currency_sink), 'unknown') as reason,
  count(*) as events,
  count(distinct player_id) as players,
  sum(value_param) as amount
from {{ ref('clean_events') }} as e
left join {{ ref('player_attribution') }} as ua using (game_id, player_id)
left join {{ ref('player_country') }} as pc using (game_id, player_id)
where event_name in ('earn_virtual_currency', 'spend_virtual_currency')
  and currency_name is not null
  and e.event_date >= {{ start_date_expr() }}
group by 1, 2, 3, 4, 5, 6, 7, 8
