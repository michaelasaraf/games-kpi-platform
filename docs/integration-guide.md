# Integration guide for game teams

This is what a game needs so its KPIs show up on the shared dashboard. It takes about 3 to 5 dev days
for a game that already uses Firebase Analytics, most of it placing event calls in gameplay code.

You do not change how Firebase is set up. The `Kpi` wrapper sends our shared events through the
Firebase Analytics SDK the game already has, and adds three params to each event (`kpi_event_id`,
`kpi_seq`, `kpi_sdk`) that the platform uses to remove duplicates and spot lost events.

The full list of events and params is in the [event catalog](event-catalog.md).

## Checklist

1. [Add the wrapper package](#1-add-the-wrapper-package).
2. [Call `Init` after Firebase is ready](#2-initialise).
3. [Send progression events](#3-progression): tutorial and levels.
4. [Forward ad revenue](#4-ad-revenue) from your mediation SDK.
5. [Send purchases](#5-purchases).
6. [Send economy events](#6-economy): currency earned and spent, items, blockers.
7. [UA source](#7-ua-source): automatic on Android; forward Tenjin's attribution if the game has Tenjin.
8. [Check it in DebugView and on the dashboard](#8-check-your-work).
8. Tell the platform owner which [revenue sources](#revenue-sources-tell-us-once) the game uses.

Do not send any event before the player's consent is known if the game asks for consent; see [consent](#consent).

## 1. Add the wrapper package

**Unity** (2021.3 or later, with the Firebase Analytics Unity SDK installed). In
`Packages/manifest.json`:

```json
"com.gameskpi.analytics": "https://github.com/michaelasaraf/games-kpi-platform.git?path=sdk/unity#v0.1.0"
```

**Flutter** (with `firebase_core` and `firebase_analytics` already in the app). In `pubspec.yaml`:

```yaml
dependencies:
  games_kpi:
    git:
      url: https://github.com/michaelasaraf/games-kpi-platform.git
      path: sdk/flutter
      ref: v0.1.0
```

Pin a tag, never a branch, so a catalog change does not reach the game without a release.

## 2. Initialise

**Unity**

```csharp
using Firebase;
using GamesKpi;

FirebaseApp.CheckAndFixDependenciesAsync().ContinueWithOnMainThread(task =>
{
    if (task.Result != DependencyStatus.Available) return;
    Kpi.DebugLog = Debug.isDebugBuild;   // prints every event to the console
    Kpi.Init();                          // or Kpi.Init(analyticsConsent, adsConsent)
});
```

**Flutter**

```dart
import 'package:games_kpi/games_kpi.dart';

await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
Kpi.debugLog = kDebugMode;
await Kpi.init();   // or Kpi.init(analyticsConsent: ..., adsConsent: ...)
```

Events called before `Init` are dropped with a warning, so initialise before the first scene that logs.

### Games that already have their own analytics layer

If the game already sends its own Firebase events through one class (Unity), keep that class and change two lines in it:

- Call `Kpi.InitWithExistingConsent()` once Firebase is ready, instead of `Kpi.Init()`. It leaves Firebase consent and
  collection as the game set them (for example through UMP).
- Replace `FirebaseAnalytics.LogEvent(name, parameters)` with `Kpi.LogCustom(name, parameters)`. Every event then
  carries the envelope params. Keep at most `25 - Kpi.EnvelopeParamCount` params per event.

Catalog events sent this way must use the catalog's param names (for example `level_number` on `level_start`).

### Consent

If the game shows a consent dialog, pass the answers to `Init`, and call
`Kpi.SetConsent(analytics, ads)` (Flutter: `Kpi.setConsent(analytics: ..., ads: ...)`) whenever they change.
With analytics consent off, the wrapper sends nothing and turns Firebase collection off.

## 3. Progression

| When | Unity | Flutter |
|---|---|---|
| Tutorial starts | `Kpi.TutorialBegin()` | `KpiEvents.tutorialBegin()` |
| Each tutorial step done | `Kpi.TutorialStep(3, "swipe_to_match")` | `KpiEvents.tutorialStep(step: 3, stepName: 'swipe_to_match')` |
| Tutorial finished | `Kpi.TutorialComplete()` | `KpiEvents.tutorialComplete()` |
| Level attempt starts (also retries) | `Kpi.LevelStart("w1_l07", 7, attempt: 2)` | `KpiEvents.levelStart(levelName: 'w1_l07', levelNumber: 7, attempt: 2)` |
| Level attempt ends | `Kpi.LevelEnd("w1_l07", 7, success: false, durationSec: 94)` | `KpiEvents.levelEnd(levelName: 'w1_l07', levelNumber: 7, success: false, durationSec: 94)` |

Rules that keep the funnel right:

- Every `level_start` gets exactly one `level_end`. Quitting, closing the app mid-level or losing all
  get `success: false`. If the app is killed you will lose the end event; that is fine, the dashboard allows for it.
- `level_name` is a stable id that never changes between versions. `level_number` is its position in the
  level order and is what the progression chart sorts by.
- Number tutorial steps from 1 and keep the numbers stable.

## 4. Ad revenue

Forward the mediation SDK's paid-impression callback to `AdImpression`. Revenue is in the currency the SDK
reports (USD for MAX and LevelPlay).

**AppLovin MAX, Unity.** Register once per ad format (Rewarded, Interstitial, Banner, AppOpen):

```csharp
MaxSdkCallbacks.Rewarded.OnAdRevenuePaidEvent += (adUnitId, info) =>
    Kpi.AdImpression("applovin_max", "rewarded", info.Revenue, "USD",
        adSource: info.NetworkName, adUnitName: adUnitId, placement: info.Placement);
```

**AppLovin MAX, Flutter:**

```dart
AppLovinMAX.setRewardedAdListener(RewardedAdListener(
  // ...your other callbacks
  onAdRevenuePaidCallback: (ad) => KpiEvents.adImpression(
      adPlatform: 'applovin_max', adFormat: 'rewarded', value_: ad.revenue, currency: 'USD',
      adSource: ad.networkName, adUnitName: ad.adUnitId, placement: ad.placement),
));
```

**LevelPlay (ironSource), Unity:**

```csharp
LevelPlay.OnImpressionDataReady += data =>
    Kpi.AdImpression("levelplay", data.AdFormat, data.Revenue ?? 0, "USD",
        adSource: data.AdNetwork, adUnitName: data.MediationAdUnitName, placement: data.Placement);
```

On older ironSource SDKs the event is `IronSourceEvents.onImpressionDataReadyEvent` with lower-case fields
(`revenue`, `adNetwork`, `adUnit`, `placement`). Flutter games on LevelPlay do the same from the plugin's
impression data listener.

**AdMob directly (no mediation SDK).** First check the [revenue sources](#revenue-sources-tell-us-once):
if the AdMob app is linked to Firebase, Firebase already logs `ad_impression` with revenue and you skip this.
Otherwise:

```csharp
// Unity, Google Mobile Ads: value is in micros
rewardedAd.OnAdPaid += v =>
    Kpi.AdImpression("admob", "rewarded", v.Value / 1_000_000.0, v.CurrencyCode, adUnitName: adUnitId);
```

```dart
// Flutter, google_mobile_ads
ad.onPaidEvent = (ad, valueMicros, precision, currencyCode) => KpiEvents.adImpression(
    adPlatform: 'admob', adFormat: 'rewarded', value_: valueMicros / 1e6, currency: currencyCode,
    adUnitName: ad.adUnitId);
```

Also send `AdOfferShown(placement)` when a rewarded ad offer becomes visible and `AdOfferAccepted(placement)`
when the player taps it. The dashboard uses them for the rewarded ad opt-in rate.

## 5. Purchases

Send `IapPurchase` once per successful purchase, after the store confirms it, with the price in the
player's local currency. Firebase converts it to USD.

**Unity IAP:**

```csharp
public PurchaseProcessingResult ProcessPurchase(PurchaseEventArgs args)
{
    var p = args.purchasedProduct;
    Kpi.IapPurchase(p.definition.id, (double)p.metadata.localizedPrice, p.metadata.isoCurrencyCode,
        p.transactionID, store: Application.platform == RuntimePlatform.IPhonePlayer ? "app_store" : "google_play");
    // ...grant the item
    return PurchaseProcessingResult.Complete;
}
```

**Flutter `in_app_purchase`:** when a `PurchaseDetails` arrives with status `purchased`, look up its
`ProductDetails` and send:

```dart
KpiEvents.iapPurchase(
  productId: purchase.productID, value_: product.rawPrice, currency: product.currencyCode,
  transactionId: purchase.purchaseID ?? '', store: Platform.isIOS ? 'app_store' : 'google_play');
```

Do not send it for restored purchases. Also send `StoreView` when the store opens and `OfferShown(offerId)`
when a paid offer pops up; they show how often players reach the store.

## 6. Economy

| When | Unity | Flutter |
|---|---|---|
| Player gains currency | `Kpi.EarnCurrency("coins", 50, "level_reward", balanceAfter: 820)` | `KpiEvents.earnCurrency(virtualCurrencyName: 'coins', value_: 50, source: 'level_reward', balanceAfter: 820)` |
| Player spends currency | `Kpi.SpendCurrency("coins", 200, "booster", itemName: "hammer")` | `KpiEvents.spendCurrency(virtualCurrencyName: 'coins', value_: 200, sink: 'booster', itemName: 'hammer')` |
| Booster or item used | `Kpi.ItemUsed("hammer", levelName: "w1_l07")` | `KpiEvents.itemUsed(itemId: 'hammer', levelName: 'w1_l07')` |
| Player is blocked | `Kpi.BlockerHit("no_lives")` | `KpiEvents.blockerHit(reason: 'no_lives')` |

Keep `source`, `sink` and currency names to a short fixed list per game (for example `level_reward`,
`daily_bonus`, `rewarded_ad`, `purchase`); the economy page groups by them.

## 7. UA source

The dashboard can filter and compare players by where they came from (Organic, Meta, Google Ads and so on).
Each player's source is taken from the first of these that exists:

1. **An attribution SDK (Tenjin).** Most accurate, and the only one that sees iOS and Meta view-through installs.
2. **The Google Play install referrer.** The wrapper reads it by itself on Android, once per install, and sends
   `install_attribution` with provider `play_referrer`. It sees Google Ads clicks and Meta click-through installs.
   Nothing to do here, apart from the ProGuard note below.
3. **Firebase's own install source.** Sees Google Ads when the Ads account is linked to Firebase.

Players with none of these show as Unknown (most iOS installs in games without Tenjin).

**Games with Tenjin:** forward Tenjin's attribution once it is known. Tenjin's attribution info has to be
turned on for your Tenjin account, and method names can differ between Tenjin SDK versions, so check them
against the version you use.

```csharp
// Unity, after Tenjin's Connect()
Tenjin.getInstance("<TENJIN_SDK_KEY>").GetAttributionInfo(info =>
{
    info.TryGetValue("ad_network", out var network);
    info.TryGetValue("campaign_name", out var campaign);
    Kpi.InstallAttribution("tenjin", string.IsNullOrEmpty(network) ? "organic" : network,
        campaign: campaign, isOrganic: string.IsNullOrEmpty(network) || network == "organic");
});
```

```dart
// Flutter, tenjin_plugin
final info = await TenjinSDK.instance.getAttributionInfo();
final network = info?['ad_network'];
await KpiEvents.installAttribution(
  attributionProvider: 'tenjin',
  mediaSource: (network == null || network.isEmpty) ? 'organic' : network,
  campaign: info?['campaign_name'],
  isOrganic: network == null || network.isEmpty || network == 'organic');
```

Calling it on every launch is fine; the dashboard keeps the first report.

**Unity games with minify (ProGuard or R8) on:** add this line to `Assets/Plugins/Android/proguard-user.txt`,
so the referrer library is not stripped:

```
-keep class com.android.installreferrer.** { *; }
```

To turn the referrer off, set `Kpi.AutoInstallReferrer = false` before `Kpi.Init()` (Flutter:
`Kpi.init(autoInstallReferrer: false)`).

## 8. Check your work

1. Run a debug build with `Kpi.DebugLog` on and play through the tutorial, a won and a lost level,
   a rewarded ad and a test purchase. Every call prints one line.
2. Open Firebase **DebugView**. On Android run
   `adb shell setprop debug.firebase.analytics.app <your.package.name>` first; on iOS add the
   `-FIRDebugEnabled` launch argument. Each event should appear with its params and `kpi_sdk`.
3. Install from a Play Store test track (not a sideloaded APK, which has no referrer) and check that
   `install_attribution` arrives in DebugView with `attribution_provider` = `play_referrer`.
4. Ship to internal testing. Within a few hours, the game's **Integration** tab on the dashboard lists every
   event group as "Receiving", or says which events are missing or which params look wrong.

## Revenue sources: tell us once

So revenue is never counted twice, the platform owner records two settings for each game:

| Setting | Use `wrapper` when | Use `firebase_auto` when |
|---|---|---|
| Ad revenue | You call `AdImpression` (MAX, LevelPlay, or AdMob not linked to Firebase) | AdMob is linked to Firebase and you do not call `AdImpression` |
| IAP revenue | You call `IapPurchase` (recommended) | You rely on Firebase's automatic `in_app_purchase` |

A third option for each, `play_reports` for IAP and `admob_api` for ads, takes the totals straight from Google Play and AdMob,
with nothing to send from the game (see setup, section 7). Those totals cannot be split by player.

Send `IapPurchase` even with `firebase_auto`. The dashboard then does not count it as revenue, but it still feeds the purchase checks on the Integration tab.

## Rules for all events

- Never rename an event or param, and never reuse a name for something else. Ask for a catalog change
  instead; new events and optional params can be added any time.
- Strings over 100 characters are cut by the wrapper. Keep ids short and stable, without player data
  (no names, emails or device ids).
- Do not call Firebase `LogEvent` yourself for anything in the catalog. Game-specific extra events
  are fine, but the dashboard will not use them.
