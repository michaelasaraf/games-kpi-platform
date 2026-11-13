{#- Player-level monetisation flags on a player_day row (alias `pd`). -#}

{#- The player paid that day. Counts the purchase events the player logged (wrapper iap_purchase,
    Firebase in_app_purchase or the game's payer_events), not revenue, so it also works for games
    whose revenue comes from the Google Play reports. A player-day with more purchase events than
    var('payer_max_daily_purchases') is a tester or a cheat (fake purchases), not a payer.
    On rows built before player_purchase_events existed it falls back to purchases. -#}
{% macro is_payer(pd) -%}
(coalesce({{ pd }}.player_purchase_events, 0) between 1 and {{ var('payer_max_daily_purchases', 5) }}
  or (coalesce({{ pd }}.player_purchase_events, 0) = 0 and {{ pd }}.purchases > 0))
{%- endmacro %}

{#- The player watched at least one rewarded ad to the reward that day. -#}
{% macro is_rewarded_viewer(pd) -%}
(coalesce({{ pd }}.rewarded_views, 0) > 0 or {{ pd }}.rewarded_impressions > 0)
{%- endmacro %}
