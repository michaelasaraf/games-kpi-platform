{#-
  One row per event for all games: the per-game Firebase exports unioned, game_id stamped,
  the params we use flattened into columns, and duplicates removed.

  Incremental runs rewrite only the last `lookback_days` days (Firebase keeps updating a
  day's export for up to 72 hours). Events whose game-local date is older than that are
  ignored until the next full refresh (`dbt build --full-refresh`).
-#}
{{
  config(
    materialized='incremental',
    incremental_strategy='insert_overwrite',
    partition_by={'field': 'event_date', 'data_type': 'date', 'granularity': 'day'},
    cluster_by=['game_id', 'event_name', 'player_id'],
    on_schema_change='append_new_columns'
  )
}}

with raw as (
  {%- for g in games() %}
  select
    '{{ g.game_id }}' as game_id,
    '{{ g.get("timezone", "UTC") }}' as tz,
    '{{ g.get("iap_source", "wrapper") }}' as iap_source,
    '{{ g.get("ad_revenue_source", "wrapper") }}' as ad_revenue_source,
    {{ g.get("store_fee", 0.15) }} as store_fee,
    starts_with(_TABLE_SUFFIX, 'intraday_') as from_intraday,
    -- Games that predate the catalog can map their own params (see level_number_param and
    -- tutorial_step_events in dbt_project.yml).
    {%- set lnp = g.get("level_number_param", "level_number") %}
    {%- set lep = g.get("level_event_pattern") %}
    coalesce({{ param_int('level_number') }}
      {%- if lnp != "level_number" %}, {{ param_int(lnp) }}{% endif %}
      {%- if lep %}, safe_cast(regexp_extract(event_name, r'{{ lep }}') as int64){% endif %}) as mapped_level_number,
    -- Games that put the level in the event name (level_7_reached): those events count as level_up.
    {% if lep %}regexp_contains(event_name, r'{{ lep }}'){% else %}false{% endif %} as is_game_level_up,
    {%- set tse = g.get("tutorial_step_events") %}
    {%- if tse %}
    (false
      {%- if tse.get("prefix") %} or starts_with(event_name, '{{ tse.prefix }}'){% endif %}
      {%- if tse.get("begin") %} or event_name = '{{ tse.begin }}'{% endif %}
      {%- for e in tse.get("events", []) + tse.get("extra", []) + tse.get("step_events", []) %} or event_name = '{{ e }}'{% endfor %}) as is_game_tutorial_step,
    -- Games whose step events carry no number: the begin event is step 0, and the step number is
    -- the position (from 1) of the step_name param in step_order, or of the event name in step_events.
    {%- set order = tse.get("step_order", []) %}
    {%- set step_events = tse.get("step_events", []) %}
    {% if tse.get("begin") %}if(event_name = '{{ tse.begin }}', 0, {% endif -%}
    {% if order %}case {{ param_str('step_name') }}
      {%- for n in order %} when '{{ n }}' then {{ loop.index }}{% endfor %} end
    {%- elif step_events %}case event_name
      {%- for n in step_events %} when '{{ n }}' then {{ loop.index }}{% endfor %} end
    {%- else %}cast(null as int64){% endif -%}
    {% if tse.get("begin") %}){% endif %} as mapped_tutorial_step,
    {%- else %}
    false as is_game_tutorial_step,
    cast(null as int64) as mapped_tutorial_step,
    {%- endif %}
    event_name,
    event_timestamp,
    event_server_timestamp_offset,
    event_params,
    event_value_in_usd,
    user_id,
    user_pseudo_id,
    user_first_touch_timestamp,
    platform,
    traffic_source.source as fb_source,
    traffic_source.medium as fb_medium,
    traffic_source.name as fb_campaign,
    app_info.version as app_version,
    geo.country as country
  from `{{ g.firebase_project }}.{{ g.analytics_dataset }}.events_*`
  where (_TABLE_SUFFIX between {{ start_suffix() }} and '99999999')
     or (_TABLE_SUFFIX between concat('intraday_', {{ start_suffix() }}) and 'intraday_99999999')
  {% if not loop.last %}union all{% endif %}
  {%- endfor %}
),

timed as (
  select
    *,
    -- Trust the device clock unless it is more than a day off from the server's.
    timestamp_micros(
      event_timestamp
      + if(abs(coalesce(event_server_timestamp_offset, 0)) > 86400000000, event_server_timestamp_offset, 0)
    ) as event_ts,
    {{ param_str('kpi_event_id') }} as kpi_event_id
  from raw
  where user_pseudo_id is not null
),

flattened as (
  select
    game_id,
    date(event_ts, tz) as event_date,
    event_ts,
    event_name,
    coalesce(
      kpi_event_id,
      to_hex(md5(concat(user_pseudo_id, '|', cast(event_timestamp as string), '|', event_name, '|', to_json_string(event_params))))
    ) as event_key,
    from_intraday,

    user_pseudo_id as player_id,
    user_id,
    timestamp_micros(user_first_touch_timestamp) as install_ts,
    -- First open time; if Firebase lacks it, fall back to the event's own day.
    coalesce(date(timestamp_micros(user_first_touch_timestamp), tz), date(event_ts, tz)) as install_date,
    lower(platform) as platform,
    app_version,
    country,
    -- Firebase's first-touch acquisition (filled in the daily tables only).
    nullif(fb_source, '') as fb_source,
    nullif(fb_medium, '') as fb_medium,
    nullif(fb_campaign, '') as fb_campaign,

    {{ param_int('ga_session_id') }} as session_id,
    {{ param_int('engagement_time_msec') }} as engagement_msec,
    {{ param_str('kpi_sdk') }} as kpi_sdk,
    {{ param_int('kpi_seq') }} as kpi_seq,

    -- attribution (install_attribution)
    {{ param_str('attribution_provider') }} as attribution_provider,
    {{ param_str('media_source') }} as attribution_media_source,
    {{ param_str('campaign') }} as attribution_campaign,
    -- firebase_campaign: Firebase's parse of the Play install referrer, logged right after first_open.
    -- Unlike traffic_source it is also in the intraday tables.
    {{ param_str('medium') }} as campaign_medium,
    {{ param_str('adset') }} as attribution_adset,
    {{ param_int('is_organic') }} as attribution_is_organic,

    -- progression
    (event_name = 'tutorial_step' or is_game_tutorial_step) as is_tutorial_step,
    coalesce({{ param_int('step') }}, mapped_tutorial_step) as tutorial_step,
    coalesce({{ param_str('step_name') }}, if(is_game_tutorial_step, event_name, null)) as tutorial_step_name,
    {{ param_str('level_name') }} as level_name,
    mapped_level_number as level_number,
    is_game_level_up,
    {{ param_int('success') }} as success,
    {{ param_int('duration_sec') }} as duration_sec,
    {{ param_int('attempt') }} as attempt,
    {{ param_int('stars') }} as stars,
    {{ param_int('boosters_used') }} as boosters_used,

    -- ads
    lower({{ param_str('ad_platform') }}) as ad_platform,
    {{ param_str('ad_source') }} as ad_source,
    lower({{ param_str('ad_format') }}) as ad_format,
    {{ param_str('placement') }} as placement,

    -- store and IAP
    {{ param_str('store_section') }} as store_section,
    {{ param_str('offer_id') }} as offer_id,
    coalesce({{ param_str('product_id') }}, {{ param_str('product_name') }}) as product_id,
    {{ param_str('transaction_id') }} as transaction_id,

    -- economy
    {{ param_str('virtual_currency_name') }} as currency_name,
    {{ param_num('value') }} as value_param,
    {{ param_str('source') }} as currency_source,
    {{ param_str('sink') }} as currency_sink,
    {{ param_str('item_name') }} as item_name,
    {{ param_str('item_id') }} as item_id,
    {{ param_int('balance_after') }} as balance_after,
    {{ param_str('reason') }} as blocker_reason,

    -- Revenue in USD, counted from exactly one source per game so nothing is double counted.
    case
      when event_name = 'ad_impression'
       and ((ad_revenue_source = 'wrapper' and kpi_event_id is not null)
         or (ad_revenue_source = 'firebase_auto' and kpi_event_id is null))
        then coalesce(event_value_in_usd, 0)
    end as ad_revenue_usd,
    case
      when (event_name = 'iap_purchase' and iap_source = 'wrapper')
        or (event_name = 'in_app_purchase' and iap_source = 'firebase_auto')
        then coalesce(event_value_in_usd, 0)
    end as iap_revenue_usd,
    case
      when event_name = 'app_store_refund' and iap_source = 'firebase_auto'
        then coalesce(event_value_in_usd, 0)
    end as refund_usd,
    store_fee
  from timed
)

select * except (from_intraday)
from flattened
where event_date >= {{ start_date_expr() }}
-- The daily table and the intraday table can briefly hold the same events: keep one copy.
qualify row_number() over (
  partition by game_id, event_key
  order by if(from_intraday, 1, 0), event_ts
) = 1
