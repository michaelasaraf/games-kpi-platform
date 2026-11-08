{#-
  One row per game and player: the player's UA source.

  Sources, best first:
    1. an attribution SDK (Tenjin, AppsFlyer, Adjust...) reported through Kpi.InstallAttribution
    2. the Google Play install referrer, sent by the wrapper on Android (provider play_referrer),
       or Firebase's own firebase_campaign event, which carries the same referrer
    3. Firebase's own first-touch traffic_source (sees Google Ads when the Ads account is linked)
  The earliest report of the best kind wins, so later re-engagement does not move a player.
  Players with none of these are left out; the marts count them as 'unknown'.
-#}
{{ config(materialized='table', cluster_by=['game_id', 'player_id']) }}

with reports as (
  select
    game_id,
    player_id,
    event_ts,
    lower(attribution_provider) as provider,
    attribution_media_source as raw_source,
    cast(null as string) as raw_medium,
    attribution_campaign as campaign,
    attribution_is_organic as is_organic,
    if(lower(attribution_provider) = 'play_referrer', 2, 1) as priority
  from {{ ref('clean_events') }}
  where event_name = 'install_attribution'
    and attribution_media_source is not null

  union all

  select
    game_id,
    player_id,
    event_ts,
    'firebase_campaign' as provider,
    currency_source as raw_source,  -- the event's `source` param
    campaign_medium as raw_medium,
    attribution_campaign as campaign,
    cast(null as int64) as is_organic,
    2 as priority
  from {{ ref('clean_events') }}
  where event_name = 'firebase_campaign'
    and currency_source is not null
    and lower(currency_source) not in ('(not set)', '(direct)')

  union all

  -- traffic_source is the same on every event of a player, so one row per player is enough.
  select
    game_id,
    player_id,
    min(event_ts) as event_ts,
    'firebase' as provider,
    any_value(fb_source) as raw_source,
    any_value(fb_medium) as raw_medium,
    any_value(fb_campaign) as campaign,
    cast(null as int64) as is_organic,
    3 as priority
  from {{ ref('clean_events') }}
  where fb_source is not null
  group by game_id, player_id
)

select
  game_id,
  player_id,
  {{ ua_source('raw_source', 'raw_medium', 'is_organic') }} as ua_source,
  provider as attribution_provider,
  raw_source,
  campaign as ua_campaign
from reports
qualify row_number() over (partition by game_id, player_id order by priority, event_ts) = 1
