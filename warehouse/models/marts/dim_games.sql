-- The games registry from dbt_project.yml, so the dashboard reads the same list.
{%- set gs = games() %}
{% for g in gs %}
select
  '{{ g.game_id }}' as game_id,
  '{{ g.name | replace("'", "\\'") }}' as name,
  '{{ g.get("engine", "unity") }}' as engine,
  '{{ g.get("timezone", "UTC") }}' as timezone,
  '{{ g.get("iap_source", "wrapper") }}' as iap_source,
  '{{ g.get("ad_revenue_source", "wrapper") }}' as ad_revenue_source,
  cast({{ g.get("store_fee", 0.15) }} as float64) as store_fee,
  cast({{ g.get("d1_target", 0.40) }} as float64) as d1_target,
  cast({{ g.get("d7_target", 0.15) }} as float64) as d7_target
{% if not loop.last %}union all{% endif %}
{%- endfor %}
