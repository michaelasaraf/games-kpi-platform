<!-- Generated from catalog/events.yaml by tools/codegen. Do not edit by hand. -->
# Event catalog

Catalog version 1. Every game sends these events through the wrapper for its engine.
Each event also carries `kpi_event_id`, `kpi_seq` and `kpi_sdk`, added by the wrapper.

## Logged by Firebase automatically

| Event | Feeds |
| --- | --- |
| `first_open` | Installs, install cohorts |
| `session_start` | Sessions per DAU (via ga_session_id) |
| `user_engagement` | Playtime per DAU (engagement_time_msec) |
| `in_app_purchase` | IAP revenue when the game's iap_source is firebase_auto |
| `app_store_refund` | Refunds (iOS) |

## Attribution (UA source)

### `install_attribution`

Where the player came from (UA source). On Android the wrapper sends this by itself from the Google Play install referrer, once per install. Games with an attribution SDK (Tenjin, AppsFlyer, Adjust) also call it from that SDK's attribution callback; the dashboard prefers the SDK's answer, then the referrer, then Firebase's own install source.

Unity: `Kpi.InstallAttribution(...)` · Flutter: `KpiEvents.installAttribution(...)`

| Param | Type | Required | Unity / Dart argument | Description |
| --- | --- | --- | --- | --- |
| `attribution_provider` | string | yes | `attributionProvider` | Who decided the source: tenjin, appsflyer, adjust, or play_referrer (sent by the wrapper) |
| `media_source` | string | yes | `mediaSource` | Network as the provider names it, e.g. facebook, googleadwords_int, organic |
| `campaign` | string | no | `campaign` | Campaign name, if known |
| `adset` | string | no | `adset` | Ad set or ad group, if known |
| `is_organic` | bool | no | `isOrganic` | true when the provider says the install was organic |
| `referrer` | string | no | `referrer` | Raw install referrer (play_referrer only), cut to 100 characters |

## Progression

### `tutorial_begin`

The tutorial starts. Call once per player.

Unity: `Kpi.TutorialBegin(...)` · Flutter: `KpiEvents.tutorialBegin(...)`

### `tutorial_step`

The player finishes one tutorial step. Steps are numbered from 1.

Unity: `Kpi.TutorialStep(...)` · Flutter: `KpiEvents.tutorialStep(...)`

| Param | Type | Required | Unity / Dart argument | Description |
| --- | --- | --- | --- | --- |
| `step` | int | yes | `step` | Step number, starting at 1 |
| `step_name` | string | no | `stepName` | Short name, e.g. swipe_to_match |

### `tutorial_complete`

The last tutorial step is finished.

Unity: `Kpi.TutorialComplete(...)` · Flutter: `KpiEvents.tutorialComplete(...)`

### `level_start`

A level attempt starts (also on retry).

Unity: `Kpi.LevelStart(...)` · Flutter: `KpiEvents.levelStart(...)`

| Param | Type | Required | Unity / Dart argument | Description |
| --- | --- | --- | --- | --- |
| `level_name` | string | yes | `levelName` | Stable level id, e.g. w1_l07 |
| `level_number` | int | yes | `levelNumber` | Position in the level order, starting at 1 |
| `attempt` | int | no | `attempt` | Attempt number for this player on this level, starting at 1 |

### `level_end`

A level attempt ends, won or lost. Quitting mid-level counts as a fail.

Unity: `Kpi.LevelEnd(...)` · Flutter: `KpiEvents.levelEnd(...)`

| Param | Type | Required | Unity / Dart argument | Description |
| --- | --- | --- | --- | --- |
| `level_name` | string | yes | `levelName` | Same id as level_start |
| `level_number` | int | yes | `levelNumber` | Same as level_start |
| `success` | bool | yes | `success` | true = completed, false = failed or quit (sent as 1 or 0) |
| `duration_sec` | int | no | `durationSec` | Seconds spent in the attempt |
| `attempt` | int | no | `attempt` | Attempt number |
| `stars` | int | no | `stars` | Stars or score tier, if the game has them |
| `boosters_used` | int | no | `boostersUsed` | Boosters used in the attempt |

## Ads

### `ad_offer_shown`

The game offers a rewarded ad (button or popup becomes visible).

Unity: `Kpi.AdOfferShown(...)` · Flutter: `KpiEvents.adOfferShown(...)`

| Param | Type | Required | Unity / Dart argument | Description |
| --- | --- | --- | --- | --- |
| `placement` | string | yes | `placement` | Where the offer is, e.g. double_coins |

### `ad_offer_accepted`

The player taps to watch the offered rewarded ad.

Unity: `Kpi.AdOfferAccepted(...)` · Flutter: `KpiEvents.adOfferAccepted(...)`

| Param | Type | Required | Unity / Dart argument | Description |
| --- | --- | --- | --- | --- |
| `placement` | string | yes | `placement` | Same as ad_offer_shown |

### `ad_impression`

An ad was shown and earned revenue. Forward the mediation SDK's paid/revenue callback here (AppLovin MAX OnAdRevenuePaid, LevelPlay ImpressionDataReady, AdMob OnPaidEvent). Skip it for AdMob if Firebase already logs ad_impression automatically, or revenue is counted twice.

Unity: `Kpi.AdImpression(...)` · Flutter: `KpiEvents.adImpression(...)`

| Param | Type | Required | Unity / Dart argument | Description |
| --- | --- | --- | --- | --- |
| `ad_platform` | string | yes | `adPlatform` | Mediation: applovin_max, levelplay, admob |
| `ad_format` | string | yes | `adFormat` | rewarded, interstitial, banner, app_open |
| `value` | double | yes | `value` | Revenue of this impression |
| `currency` | string | yes | `currency` | ISO currency, usually USD |
| `ad_source` | string | no | `adSource` | Network that served the ad |
| `ad_unit_name` | string | no | `adUnitName` | Ad unit id or name |
| `placement` | string | no | `placement` | Game placement name |

## Store and in-app purchases

### `store_view`

The store screen opens.

Unity: `Kpi.StoreView(...)` · Flutter: `KpiEvents.storeView(...)`

| Param | Type | Required | Unity / Dart argument | Description |
| --- | --- | --- | --- | --- |
| `store_section` | string | no | `storeSection` | Tab or section, e.g. coins, offers |

### `offer_shown`

A paid offer is shown (popup, banner or store card).

Unity: `Kpi.OfferShown(...)` · Flutter: `KpiEvents.offerShown(...)`

| Param | Type | Required | Unity / Dart argument | Description |
| --- | --- | --- | --- | --- |
| `offer_id` | string | yes | `offerId` | Offer or product id |
| `placement` | string | no | `placement` | Where it was shown |

### `iap_purchase`

A purchase succeeded. Always send it. The dashboard counts it as revenue when the game's iap_source is wrapper; with firebase_auto it uses Firebase's own in_app_purchase event instead, so revenue is never counted twice.

Unity: `Kpi.IapPurchase(...)` · Flutter: `KpiEvents.iapPurchase(...)`

| Param | Type | Required | Unity / Dart argument | Description |
| --- | --- | --- | --- | --- |
| `product_id` | string | yes | `productId` | Store product id |
| `value` | double | yes | `value` | Price paid, in the local currency (Firebase converts it to USD) |
| `currency` | string | yes | `currency` | ISO currency of the price, e.g. EUR |
| `transaction_id` | string | yes | `transactionId` | Store transaction / order id |
| `store` | string | no | `store` | google_play or app_store |

## Economy

### `earn_virtual_currency`

The player gains soft or hard currency.

Unity: `Kpi.EarnCurrency(...)` · Flutter: `KpiEvents.earnCurrency(...)`

| Param | Type | Required | Unity / Dart argument | Description |
| --- | --- | --- | --- | --- |
| `virtual_currency_name` | string | yes | `virtualCurrencyName` | coins, gems, lives... |
| `value` | int | yes | `value` | Amount gained |
| `source` | string | yes | `source` | Why: level_reward, daily_bonus, rewarded_ad, purchase... |
| `balance_after` | int | no | `balanceAfter` | Balance after the change |
| `level_name` | string | no | `levelName` | Level where it happened, if any |

### `spend_virtual_currency`

The player spends currency.

Unity: `Kpi.SpendCurrency(...)` · Flutter: `KpiEvents.spendCurrency(...)`

| Param | Type | Required | Unity / Dart argument | Description |
| --- | --- | --- | --- | --- |
| `virtual_currency_name` | string | yes | `virtualCurrencyName` | coins, gems, lives... |
| `value` | int | yes | `value` | Amount spent |
| `sink` | string | yes | `sink` | On what: booster, continue, unlock, cosmetic... |
| `item_name` | string | no | `itemName` | Item bought, if any |
| `balance_after` | int | no | `balanceAfter` | Balance after the change |
| `level_name` | string | no | `levelName` | Level where it happened, if any |

### `item_used`

A booster or consumable item is used.

Unity: `Kpi.ItemUsed(...)` · Flutter: `KpiEvents.itemUsed(...)`

| Param | Type | Required | Unity / Dart argument | Description |
| --- | --- | --- | --- | --- |
| `item_id` | string | yes | `itemId` | Item id |
| `level_name` | string | no | `levelName` | Level where it was used |

### `blocker_hit`

The player cannot continue without paying, watching an ad or waiting.

Unity: `Kpi.BlockerHit(...)` · Flutter: `KpiEvents.blockerHit(...)`

| Param | Type | Required | Unity / Dart argument | Description |
| --- | --- | --- | --- | --- |
| `reason` | string | yes | `reason` | no_lives, not_enough_coins, locked_content... |
| `level_name` | string | no | `levelName` | Level where it happened |
