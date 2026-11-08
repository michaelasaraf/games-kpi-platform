{#-
  Store revenue per game, day, platform, country, type (iap | ad), ad format, ad source and product,
  from Google Play's sales reports and AdMob's mediation report (scripts/load_revenue.py). Only
  games whose config says iap_source: play_reports or ad_revenue_source: admob_api are included,
  matched by package_name.

  Play days are in the game's timezone. AdMob days are in the AdMob account's time zone (the API
  reports whole days only).
  These are account totals with no player id: kpi_daily adds them with ua_source 'unattributed'.
-#}
{%- set gs = games() %}
{%- set play_games = [] %}
{%- set admob_games = [] %}
{%- for g in gs %}
  {%- if g.get('iap_source') == 'play_reports' %}{% do play_games.append(g) %}{% endif %}
  {%- if g.get('ad_revenue_source') == 'admob_api' %}{% do admob_games.append(g) %}{% endif %}
{%- endfor %}

with play_games as (
  {%- for g in play_games %}
  select '{{ g.game_id }}' as game_id, '{{ g.package_name }}' as package_name,
    '{{ g.get("timezone", "UTC") }}' as tz, cast({{ g.get("store_fee", 0.15) }} as float64) as store_fee
  {% if not loop.last %}union all{% endif %}
  {%- else %}
  select cast(null as string) as game_id, cast(null as string) as package_name, 'UTC' as tz, 0.0 as store_fee
  from unnest([1]) where false
  {%- endfor %}
),

admob_games as (
  {%- for g in admob_games %}
  select '{{ g.game_id }}' as game_id, '{{ g.package_name }}' as package_name
  {% if not loop.last %}union all{% endif %}
  {%- else %}
  select cast(null as string) as game_id, cast(null as string) as package_name from unnest([1]) where false
  {%- endfor %}
),

play as (
  select
    g.game_id,
    date(s.charged_ts, g.tz) as revenue_date,
    'android' as platform,
    s.country_code,
    'iap' as revenue_type,
    cast(null as string) as ad_format,
    cast(null as string) as ad_source,
    s.sku_id as product_id,
    coalesce(s.item_price_usd, 0) as gross_usd,
    coalesce(s.item_price_usd, 0) * (1 - g.store_fee) as net_usd,
    if(coalesce(s.item_price_usd, 0) >= 0, 1, 0) as orders,
    if(s.item_price_usd < 0, 1, 0) as refunds,
    0 as impressions
  from {{ source('store', 'src_play_sales') }} as s
  join play_games as g using (package_name)
),

admob as (
  select
    g.game_id,
    s.report_date as revenue_date,
    coalesce(s.platform, 'unknown') as platform,
    s.country_code,
    'ad' as revenue_type,
    case s.ad_format when 'rewarded_interstitial' then 'rewarded' else s.ad_format end as ad_format,
    s.ad_source,
    cast(null as string) as product_id,
    s.earnings_usd as gross_usd,
    s.earnings_usd as net_usd,
    0 as orders,
    0 as refunds,
    s.impressions
  from {{ source('store', 'src_admob_daily') }} as s
  join admob_games as g using (package_name)
),

unioned as (
  select * from play
  union all
  select * from admob
)

select
  u.game_id,
  u.revenue_date,
  u.platform,
  coalesce(cc.country, u.country_code, 'unknown') as country,
  u.revenue_type,
  u.ad_format,
  u.ad_source,
  u.product_id,
  sum(u.gross_usd) as gross_usd,
  sum(u.net_usd) as net_usd,
  sum(u.orders) as orders,
  sum(u.refunds) as refunds,
  sum(u.impressions) as impressions
from unioned as u
left join {{ ref('country_codes') }} as cc on cc.country_code = u.country_code
where u.revenue_date >= {{ start_date_expr() }}
group by 1, 2, 3, 4, 5, 6, 7, 8
