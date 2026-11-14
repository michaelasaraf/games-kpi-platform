{#- Helpers for reading the Firebase Analytics BigQuery export. -#}

{#- A param as STRING, whatever type Firebase stored it as. -#}
{% macro param_str(key) -%}
(select coalesce(p.value.string_value, cast(p.value.int_value as string), cast(p.value.double_value as string), cast(p.value.float_value as string))
 from unnest(event_params) as p where p.key = '{{ key }}' limit 1)
{%- endmacro %}

{#- A param as INT64. Doubles are rounded; strings are parsed when they hold a number. -#}
{% macro param_int(key) -%}
(select coalesce(p.value.int_value, cast(round(p.value.double_value) as int64), cast(round(p.value.float_value) as int64), safe_cast(p.value.string_value as int64))
 from unnest(event_params) as p where p.key = '{{ key }}' limit 1)
{%- endmacro %}

{#- A param as FLOAT64. -#}
{% macro param_num(key) -%}
(select coalesce(p.value.double_value, p.value.float_value, cast(p.value.int_value as float64), safe_cast(p.value.string_value as float64))
 from unnest(event_params) as p where p.key = '{{ key }}' limit 1)
{%- endmacro %}

{#- Earliest export table suffix (YYYYMMDD) this run reads. Incremental runs read the
    last `lookback_days` days; a full refresh reads from var('start_date'). -#}
{% macro start_suffix() -%}
{%- if is_incremental() -%}
format_date('%Y%m%d', date_sub(current_date(), interval {{ var('lookback_days') }} day))
{%- else -%}
'{{ var('start_date') }}'
{%- endif -%}
{%- endmacro %}

{#- First event_date (DATE) this run writes. -#}
{% macro start_date_expr() -%}
{%- if is_incremental() -%}
date_sub(current_date(), interval {{ var('lookback_days') }} day)
{%- else -%}
parse_date('%Y%m%d', '{{ var('start_date') }}')
{%- endif -%}
{%- endmacro %}

{#- Validates the games list in dbt_project.yml so a typo fails loudly at compile time. -#}
{% macro games() -%}
{%- set games = var('games') -%}
{%- if not games -%}
  {{ exceptions.raise_compiler_error("var 'games' is empty: add at least one game to dbt_project.yml") }}
{%- endif -%}
{%- set seen = [] -%}
{%- for g in games -%}
  {%- for key in ['game_id', 'name'] -%}
    {%- if not g.get(key) -%}
      {{ exceptions.raise_compiler_error("game " ~ loop.index ~ " is missing '" ~ key ~ "'") }}
    {%- endif -%}
  {%- endfor -%}
  {%- if not modules.re.match('^[a-z][a-z0-9_]*$', g.game_id) -%}
    {{ exceptions.raise_compiler_error("game_id '" ~ g.game_id ~ "' must be lowercase letters, digits and _") }}
  {%- endif -%}
  {%- if g.game_id in seen -%}
    {{ exceptions.raise_compiler_error("duplicate game_id '" ~ g.game_id ~ "'") }}
  {%- endif -%}
  {%- do seen.append(g.game_id) -%}
  {%- if g.get('iap_source', 'wrapper') not in ['wrapper', 'firebase_auto', 'play_reports'] -%}
    {{ exceptions.raise_compiler_error("game '" ~ g.game_id ~ "': iap_source must be wrapper, firebase_auto or play_reports") }}
  {%- endif -%}
  {%- if g.get('ad_revenue_source', 'wrapper') not in ['wrapper', 'firebase_auto', 'admob_api'] -%}
    {{ exceptions.raise_compiler_error("game '" ~ g.game_id ~ "': ad_revenue_source must be wrapper, firebase_auto or admob_api") }}
  {%- endif -%}
  {%- if g.get('player_ad_revenue_source', 'wrapper') not in ['wrapper', 'firebase_auto'] -%}
    {{ exceptions.raise_compiler_error("game '" ~ g.game_id ~ "': player_ad_revenue_source must be wrapper or firebase_auto") }}
  {%- endif -%}
  {%- if (g.get('iap_source') == 'play_reports' or g.get('ad_revenue_source') == 'admob_api') and not g.get('package_name') -%}
    {{ exceptions.raise_compiler_error("game '" ~ g.game_id ~ "': play_reports and admob_api need package_name") }}
  {%- endif -%}
{%- endfor -%}
{{ return(games) }}
{%- endmacro %}
