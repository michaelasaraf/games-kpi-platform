{#- Maps the source names that attribution providers and Firebase use onto one short list,
    so the dashboard filter reads "meta" whether Tenjin said facebook, AppsFlyer said
    Facebook Ads or the Play referrer said apps.facebook.com. Unknown names are kept,
    lowercased, with _int suffixes and punctuation removed. -#}
{% macro ua_source(source, medium, is_organic) -%}
{%- set s = "lower(trim(" ~ source ~ "))" -%}
{%- set m = "lower(coalesce(" ~ medium ~ ", ''))" -%}
case
  when {{ is_organic }} = 1 then 'organic'
  when {{ source }} is null or trim({{ source }}) = '' then 'unknown'
  when {{ s }} in ('(not set)', '(direct)', 'unknown', 'none', 'null') then 'unknown'
  when {{ m }} = 'organic' or {{ s }} in ('organic', 'google-play', 'google_play', 'play_store', 'app_store', 'apple') then 'organic'
  when regexp_contains({{ s }}, r'facebook|instagram|^meta|^fb|audience.?network|messenger') then 'meta'
  when regexp_contains({{ s }}, r'googleadwords|google.?ads|adwords|^google$|^google_ads$') then 'google_ads'
  when regexp_contains({{ s }}, r'tiktok|bytedance|pangle') then 'tiktok'
  when regexp_contains({{ s }}, r'apple.?search|searchads|^asa$') then 'apple_search_ads'
  when regexp_contains({{ s }}, r'unity') then 'unity_ads'
  when regexp_contains({{ s }}, r'applovin') then 'applovin'
  when regexp_contains({{ s }}, r'ironsource|levelplay') then 'ironsource'
  when regexp_contains({{ s }}, r'mintegral') then 'mintegral'
  when regexp_contains({{ s }}, r'moloco') then 'moloco'
  when regexp_contains({{ s }}, r'liftoff|vungle') then 'liftoff'
  when regexp_contains({{ s }}, r'snapchat') then 'snapchat'
  else trim(regexp_replace(regexp_replace({{ s }}, r'_int$', ''), r'[^a-z0-9]+', '_'), '_')
end
{%- endmacro %}
