{#-
  One row per game and player that a Meta ad brought: the campaign, ad set and ad from Meta's
  encrypted Play install referrer (scripts/load_meta_referrers.py). The first decrypted referrer wins.

  The referrer uses Meta's older names: ad_id / adgroup_id = the ad, campaign_id = the ad set,
  campaign_group_id = the campaign. The ad is looked up in src_meta_ads (every ad of the ad accounts),
  which gives its ad set and campaign as the Marketing API names them; ads the list does not know
  fall back to the referrer's own ids. matched = the ad was found, so its spend can be joined.
-#}
{{ config(materialized='table', cluster_by=['game_id', 'player_id']) }}

with referrers as (
  select *
  from {{ source('ua', 'src_meta_install_referrers') }}
  where decrypted
  qualify row_number() over (partition by game_id, player_id order by event_ts) = 1
),

ads as (
  select ad_id, any_value(adset_id) as adset_id, any_value(campaign_id) as campaign_id
  from {{ source('ua', 'src_meta_ads') }}
  group by ad_id
)

select
  r.game_id,
  r.player_id,
  r.event_ts as referrer_ts,
  r.origin,
  r.meta_app_id,
  r.account_id,
  coalesce(a1.campaign_id, a2.campaign_id, r.campaign_group_id) as campaign_id,
  coalesce(a1.adset_id, a2.adset_id, r.campaign_id) as adset_id,
  coalesce(a1.ad_id, a2.ad_id, r.ad_id, r.adgroup_id) as ad_id,
  coalesce(a1.ad_id, a2.ad_id) is not null as matched,
  r.campaign_group_name as referrer_campaign_name,
  r.campaign_name as referrer_adset_name,
  r.adgroup_name as referrer_ad_name,
  r.publisher_platform
from referrers as r
left join ads as a1 on a1.ad_id = r.ad_id
left join ads as a2 on a2.ad_id = r.adgroup_id and a1.ad_id is null
