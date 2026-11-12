{#-
  One row per Meta ad: names, status and creative (thumbnail, title, body) for the dashboard's ad rows.
  thumbnail_url is a signed Meta link that expires; the hourly load renews it.
-#}
select
  ad_id,
  any_value(ad_name) as ad_name,
  any_value(adset_id) as adset_id,
  any_value(campaign_id) as campaign_id,
  any_value(effective_status) as status,
  min(created_time) as created_time,
  any_value(creative_id) as creative_id,
  any_value(creative_name) as creative_name,
  any_value(thumbnail_url) as thumbnail_url,
  any_value(title) as title,
  any_value(body) as body,
  any_value(object_type) as object_type
from {{ source('ua', 'src_meta_ads') }}
where ad_id is not null
group by ad_id
