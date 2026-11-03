-- Currency sources and sinks per game, date, platform and currency.
{{
  config(
    materialized='incremental',
    incremental_strategy='insert_overwrite',
    partition_by={'field': 'event_date', 'data_type': 'date', 'granularity': 'day'},
    cluster_by=['game_id', 'currency_name']
  )
}}
select
  game_id,
  event_date,
  coalesce(platform, 'unknown') as platform,
  currency_name,
  if(event_name = 'earn_virtual_currency', 'source', 'sink') as flow,
  coalesce(if(event_name = 'earn_virtual_currency', currency_source, currency_sink), 'unknown') as reason,
  count(*) as events,
  count(distinct player_id) as players,
  sum(value_param) as amount
from {{ ref('clean_events') }}
where event_name in ('earn_virtual_currency', 'spend_virtual_currency')
  and currency_name is not null
  and event_date >= {{ start_date_expr() }}
group by 1, 2, 3, 4, 5, 6
