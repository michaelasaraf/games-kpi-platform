{#-
  UA spend per game, day, platform, country, channel and campaign, from Meta Ads
  (scripts/load_ua_costs.py). The base for CPI and ROAS: spend here, installs and revenue from
  kpi_daily / kpi_cohort.

  An ad set belongs to a game when the app it promotes (its store link) is the game's package_name
  or one of its extra_package_names, or its Meta app id is in the game's meta_app_ids. Ad sets that
  promote no app (traffic or awareness campaigns) are matched by the game's meta_campaign_regex
  on the campaign name. Spend that matches no game is left out.

  Days follow the ad account's time zone. network_installs are the installs Meta reports for its
  own attribution setting (usually 7-day click, 1-day view), not the installs our attribution gives Meta.
-#}
{%- set gs = games() %}

with ids as (
  {%- set ns = namespace(first=true) %}
  {%- for g in gs %}
  {%- for p in ([g.package_name] if g.get('package_name') else []) + g.get('extra_package_names', []) %}
  {% if not ns.first %}union all{% endif %}
  select '{{ g.game_id }}' as game_id, 'store' as kind, '{{ p }}' as id
  {%- set ns.first = false %}
  {%- endfor %}
  {%- for a in g.get('meta_app_ids', []) %}
  {% if not ns.first %}union all{% endif %}
  select '{{ g.game_id }}' as game_id, 'meta_app' as kind, '{{ a }}' as id
  {%- set ns.first = false %}
  {%- endfor %}
  {%- endfor %}
  {%- if ns.first %}
  select cast(null as string) as game_id, cast(null as string) as kind, cast(null as string) as id
  from unnest([1]) where false
  {%- endif %}
),

meta as (
  select
    coalesce(
      s_store.game_id,
      s_app.game_id
      {%- for g in gs if g.get('meta_campaign_regex') %},
      if(regexp_contains(s.campaign_name, r'{{ g.meta_campaign_regex }}'), '{{ g.game_id }}', null)
      {%- endfor %}
    ) as game_id,
    s.report_date as spend_date,
    coalesce(s.platform, 'unknown') as platform,
    s.country_code,
    'meta' as channel,
    s.campaign_id,
    s.campaign_name,
    s.loaded_at,
    coalesce(s.spend_usd, 0) as spend_usd,
    s.impressions,
    s.clicks,
    s.installs
  from {{ source('ua', 'src_meta_ads_daily') }} as s
  left join ids as s_store on s_store.kind = 'store' and s_store.id = s.app_store_id
  left join ids as s_app on s_app.kind = 'meta_app' and s_app.id = s.meta_app_id
)

select
  m.game_id,
  m.spend_date,
  m.platform,
  coalesce(cc.country, m.country_code, 'unknown') as country,
  m.channel,
  m.campaign_id,
  array_agg(m.campaign_name order by m.spend_date desc, m.loaded_at desc limit 1)[offset(0)] as campaign_name,
  sum(m.spend_usd) as spend_usd,
  sum(m.impressions) as impressions,
  sum(m.clicks) as clicks,
  sum(m.installs) as network_installs
from meta as m
left join {{ ref('country_codes') }} as cc on cc.country_code = m.country_code
where m.game_id is not null
  and m.spend_date >= {{ start_date_expr() }}
group by 1, 2, 3, 4, 5, 6
