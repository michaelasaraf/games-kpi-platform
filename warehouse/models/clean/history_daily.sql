{#-
  Daily player totals for the days before a game's BigQuery export started (the export holds no
  events from before it was linked), per game, date, platform and country.

  source 'ga4'   The game's GA4 (Firebase Analytics) property via scripts/load_history.py: DAU,
                 7- and 28-day active users, new players, sessions and engagement time. Used up to
                 and including the export's first day, which only holds part of that day.
  source 'play'  Google Play's daily user installs (Android only), as new players, on days before
                 the export where GA4 has nothing (for example before the service account has
                 access to the property).

  These are totals with no player id: kpi_daily and kpi_active_users show them with ua_source
  'unknown', and retention, levels, tutorial and economy stay export-only.
-#}
{%- set gs = games() %}
{%- set ga4_games = [] %}
{%- for g in gs %}
  {%- set m = modules.re.match('^analytics_(\\d+)$', g.get('analytics_dataset', '') or '') %}
  {%- set prop = g.get('ga4_property_id') or (m.group(1) if m else none) %}
  {%- if prop %}{% do ga4_games.append({'game_id': g.game_id, 'property_id': prop | string}) %}{% endif %}
{%- endfor %}
{%- set play_games = gs | selectattr('package_name') | list %}

with ga4_games as (
  {%- for g in ga4_games %}
  select '{{ g.game_id }}' as game_id, '{{ g.property_id }}' as property_id
  {% if not loop.last %}union all{% endif %}
  {%- else %}
  select cast(null as string) as game_id, cast(null as string) as property_id from unnest([1]) where false
  {%- endfor %}
),

play_games as (
  {%- for g in play_games %}
  select '{{ g.game_id }}' as game_id, '{{ g.package_name }}' as package_name
  {% if not loop.last %}union all{% endif %}
  {%- else %}
  select cast(null as string) as game_id, cast(null as string) as package_name from unnest([1]) where false
  {%- endfor %}
),

export_start as (
  select game_id, min(event_date) as first_export_date
  from {{ ref('player_day') }}
  group by game_id
),

ga4 as (
  select
    g.game_id,
    s.report_date as event_date,
    coalesce(nullif(s.platform, ''), 'unknown') as platform,
    coalesce(s.country, 'unknown') as country,
    sum(s.active_users) as dau,
    sum(s.active_7d_users) as wau,
    sum(s.active_28d_users) as mau,
    sum(s.new_users) as new_players,
    sum(s.sessions) as sessions,
    sum(s.engagement_sec) as playtime_sec
  from {{ source('store', 'src_ga4_daily') }} as s
  join ga4_games as g on g.property_id = s.property_id
  left join export_start as e on e.game_id = g.game_id
  where (e.first_export_date is null or s.report_date <= e.first_export_date)
    and s.report_date >= {{ start_date_expr() }}
  group by 1, 2, 3, 4
),

ga4_days as (
  select distinct game_id, event_date from ga4
),

play as (
  select
    g.game_id,
    s.install_date as event_date,
    'android' as platform,
    coalesce(cc.country, s.country_code, 'unknown') as country,
    0 as dau,
    cast(null as int64) as wau,
    cast(null as int64) as mau,
    sum(s.daily_user_installs) as new_players,
    0 as sessions,
    0.0 as playtime_sec
  from {{ source('store', 'src_play_installs') }} as s
  join play_games as g on g.package_name = s.package_name
  left join export_start as e on e.game_id = g.game_id
  left join ga4_days as d on d.game_id = g.game_id and d.event_date = s.install_date
  left join {{ ref('country_codes') }} as cc on cc.country_code = s.country_code
  where d.game_id is null
    and (e.first_export_date is null or s.install_date < e.first_export_date)
    and s.install_date >= {{ start_date_expr() }}
  group by 1, 2, 3, 4
)

select 'ga4' as source, * from ga4
union all
select 'play' as source, * from play
