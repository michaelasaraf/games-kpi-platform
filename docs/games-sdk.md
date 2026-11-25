# Games SDK: design and integration guide

One Unity package that every game installs for ads, analytics and crash reporting, instead of each game wiring
up AdMob, mediation, Firebase, Crashlytics and the KPI wrapper on its own. It is built from Gem Mine's code
(Flintbeard's Gem Mine, live on Google Play since 2026-11), which already solved most of the hard parts.

First game to integrate: **Lost Treasures**. Package: `sdk/unity-sdk` (`com.gameskpi.sdk`), version 0.1.0.

## 1. What it covers

| Area | What the SDK does | What stays in the game |
|---|---|---|
| Ads | AdMob 11.6.0, Google's consent form (UMP) before any ad loads, one rewarded and one interstitial always loaded (retries 2 to 64 s), interstitial pacing, revenue per shown ad, Ad Inspector, privacy options button support | When to offer a video and what it pays; which moments may show an interstitial |
| Mediation | Pins the Unity Ads (3.22.0) and Meta Audience Network (3.20.1) adapters; logs each adapter's state at start | Mediation groups in the AdMob console |
| Analytics | Firebase Analytics 14.1.0 through the Games KPI wrapper: KPI envelope on every event, install referrer once per install, names cleaned to Firebase's rules, a queue until Firebase is up | Which game events to send |
| Crashlytics | Firebase Crashlytics 14.1.0: events as breadcrumbs, user properties as keys, caught exceptions, user id | Extra keys that help debugging |
| KPI events | `ad_impression`, `ad_offer_shown`, `ad_offer_accepted` sent automatically with the dashboard's param names | Progression, economy and IAP events (catalog names) |

Not in 0.1.0: banners, app open ads, in-app purchases, Remote Config, Meta SDK app events, iOS ATT prompt,
Flutter. Each can be added later without changing the API above (see section 9).

## 2. Design decisions

**Where it lives: in this repository, `sdk/unity-sdk`, next to the KPI wrapper (`sdk/unity`).** The SDK sends
events the dashboard's models read, so the event names, the catalog, the models and the SDK change together in
one pull request. The repository is public, so Unity installs it by git URL with no credentials. A later move to
its own repository only changes the URL in each game's manifest.

**Versioning: one git tag pins both packages.** A game's manifest points at `#games-sdk-v0.1.0` for the SDK and the
wrapper alike, so a game never mixes versions. A release is: change, bump `package.json` and the CHANGELOG, merge,
tag `games-sdk-vX.Y.Z` on main. Games update by changing the tag in their manifest.

**The Google packages are not dependencies of the UPM package.** Unity packages can't depend on git, file or
OpenUPM packages, and Firebase only ships as `.tgz` files. So the SDK pins their versions in one place
(`GamesSdkVersions` in `Editor/GamesSdkSetup.cs`) and **Tools > Games SDK > Install Dependencies** writes them into
the game's manifest. Every game gets the same tested set.

**The core never references Firebase or Google Mobile Ads.** Three runtime assemblies:

```
GamesSdk (Runtime/Core)            always compiles: GameSdk, config, queues, pacing, stand-in ads, log backend
GamesSdk.Firebase (Runtime/Firebase) Android+iOS, only when com.google.firebase.analytics is installed
                                     (Crashlytics parts when com.google.firebase.crashlytics is installed)
GamesSdk.AdMob (Runtime/AdMob)       Android+iOS, only when com.google.ads.mobile is installed
GamesSdk.Editor (Editor)             menus, manifest edits, AdMob app id sync, pre-build checks
```

The optional modules register themselves before the first scene loads (`GameSdkModules`). In the editor, the
web build or a project without the packages, the SDK uses stand-ins: events go to the log and a rewarded video
"plays" for half a second and pays. So game code never needs `#if`, and the editor never needs Firebase's desktop setup.

**Nothing is lost or thrown.** Calls before `Init` or before Firebase is ready are queued; a failing backend logs a
warning and the game goes on. The raw SDKs stay available for anything the SDK does not cover.

**Same events as Gem Mine and the catalog.** Ad revenue goes out as the catalog's `ad_impression` with exactly
the params Gem Mine sends today (ad_platform, ad_format, value, currency, precision, placement, ad_source) plus
ad_unit_name. Offers use the catalog's `ad_offer_shown` / `ad_offer_accepted`, which the dashboard already counts.

## 3. API

```csharp
using GamesSdk;

// Start (once, when the first screen is up: Google's consent form shows there in the EEA/UK on first launch)
GameSdk.Init();                                   // reads Assets/Resources/GameSdkConfig.asset

// Analytics: catalog names where one fits (docs/event-catalog.md)
GameSdk.Analytics.Log("level_start", "level_number", 3);
GameSdk.Analytics.Log("spend_virtual_currency", new Dictionary<string, object> {
    { "virtual_currency_name", "gems" }, { "value", 50 }, { "sink", "pickaxe_upgrade" }, { "balance_after", 120 } });
GameSdk.Analytics.SetUserProperty("chapter", "2");
GameSdk.Analytics.SetUserId(playerId);            // your own id, never personal data; also set on Crashlytics
GameSdk.Analytics.WhenReady(() => Kpi.LevelEnd("cave_2", 2, success: true));  // typed wrapper methods

// Rewarded video
GameSdk.Ads.OfferShown("TreasureChest");          // the "watch a video" button is on screen
GameSdk.Ads.ShowRewarded("TreasureChest", earned => { if (earned) GiveReward(); else ShowNoVideo(); });
bool ready = GameSdk.Ads.IsRewardedReady;         // grey out the button when false

// Interstitial at a calm moment; shows only if pacing allows, done always runs
GameSdk.Ads.ShowInterstitial("level_end", () => LoadNextLevel());
string why = GameSdk.Ads.InterstitialBlocker();   // null, or new_player / session_start / daily_cap / cooldown / after_rewarded / not_loaded

// Pause the game while a full-screen ad covers it
GameSdk.Ads.ShowStarted += format => AudioListener.pause = true;
GameSdk.Ads.ShowEnded += format => AudioListener.pause = false;

// Extra params on every ad event, e.g. the level
GameSdk.Ads.ExtraParams = () => new Dictionary<string, object> { { "level_number", currentLevel } };

// Pacing from remote config
GameSdk.Ads.Pacing = new InterstitialPacing { minSecondsBetween = 120, maxPerDay = 25 };

// Settings screen: a Privacy button, required where the law asks for it
privacyButton.SetActive(GameSdk.Ads.PrivacyOptionsRequired);
GameSdk.Ads.ShowPrivacyOptions();

// Revenue for other tools (Meta app events, Adjust...)
GameSdk.Ads.Paid += revenue => MyMeta.LogAdImpression(revenue.Value, revenue.Currency);

// Crashlytics
GameSdk.Crash.SetKey("level", "3");
GameSdk.Crash.Log("opened shop");
GameSdk.Crash.RecordException(e);

// Debugging
Debug.Log(GameSdk.Describe());                    // one status line
GameSdk.Ads.OpenAdInspector();                    // Google's mediation inspector (test devices only)
```

### Config (`Assets/Resources/GameSdkConfig.asset`)

| Field | Meaning |
|---|---|
| gameId | The game's id on the KPI dashboard (e.g. `lost_treasures`); sent as user property `sdk_game` |
| adsEnabled | Off = no ads at all |
| androidAppId / androidRewardedId / androidInterstitialId (and iOS) | From the AdMob console; Google's test ids until filled |
| testAdsInDevelopmentBuilds | Development builds load Google's test units (default on) |
| testDeviceIds | Phones that always get test ads and can open Ad Inspector |
| interstitialPacing | Gem Mine's tuned defaults: 10 min of lifetime play before the first, 2 min grace each session, 150 s apart, 60 s after a rewarded video, 20 a day |
| analyticsEnabled, logEventsInDevelopmentBuilds, eventsAsCrashBreadcrumbs, uncaughtExceptionsAsFatal | As named |

### Events sent automatically

| Event | When | Params |
|---|---|---|
| `ad_impression` | Each shown ad (AdMob's OnAdPaid; with value 0 if no paid event came) | ad_platform=admob, ad_format (rewarded/interstitial), value, currency, precision, ad_source (AdMob, Unity Ads, Meta Audience Network...), ad_unit_name, placement, + ExtraParams |
| `ad_offer_shown` | `OfferShown(placement)` | placement, ad_format=rewarded, ad_ready |
| `ad_offer_accepted` | `ShowRewarded(placement, ...)` | placement, ad_format=rewarded, ad_ready |
| user properties | At start | app_version, build (dev/release), sdk_game |
| `install_attribution`, `meta_install_referrer` | Once per install (wrapper, Android) | see event-catalog.md |

## 4. Integrating a game (Lost Treasures)

### 4.1 Accounts and consoles (once per game)

1. **Firebase:** a project for the game (or an Android app inside an existing one) with the game's package id.
   Download `google-services.json` (and `GoogleService-Info.plist` for iOS) into `Assets/`. Turn on Crashlytics in
   the console. **Link BigQuery with the streaming export now**: the export does not backfill, and the KPI
   dashboard reads only the export.
2. **AdMob:** an app for the game, one rewarded and one interstitial ad unit. Turn on impression-level ad revenue
   (Settings), so `ad_impression` carries value. Link the AdMob app to the Firebase project.
3. **Mediation:** in AdMob, mediation groups for both formats with Unity Ads and Meta Audience Network (each needs
   its own account, game/app and placement ids there). Add both networks' lines to the developer site's
   `app-ads.txt`. Check each adapter's consent notes in Google's mediation guides (UMP writes the IAB TCF string,
   which AdMob reads; Meta Audience Network has its own rules for EEA traffic).

### 4.2 Install

Add the two packages to `Packages/manifest.json` (or Package Manager > + > Add package from git URL):

```json
"com.gameskpi.sdk": "https://github.com/michaelasaraf/games-kpi-platform.git?path=sdk/unity-sdk#games-sdk-v0.1.0",
"com.gameskpi.analytics": "https://github.com/michaelasaraf/games-kpi-platform.git?path=sdk/unity#games-sdk-v0.1.0"
```

Then in Unity:

1. **Tools > Games SDK > Install Dependencies**: adds OpenUPM, Google Mobile Ads 11.6.0 and the two adapters,
   downloads Firebase App, Analytics and Crashlytics 14.1.0 into `GooglePackages/` and adds them. Commit
   `GooglePackages/` or let each machine download it again.
2. When Google's resolver asks, enable Android auto-resolution. Player Settings > Publishing Settings: tick
   Custom Main Gradle Template, Custom Gradle Properties Template (the resolver writes the Android libraries there),
   then Assets > External Dependency Manager > Android Resolver > Force Resolve.
3. **Tools > Games SDK > Create Config**, fill in the game id and the AdMob ids. The app ids are copied into Google's
   settings automatically.
4. **Tools > Games SDK > Check Setup** until it reports nothing.

### 4.3 Code

```csharp
public sealed class Boot : MonoBehaviour
{
    private void Start()
    {
        GameSdk.Init();
        GameSdk.Ads.ShowStarted += _ => AudioListener.pause = true;
        GameSdk.Ads.ShowEnded += _ => AudioListener.pause = false;
        GameSdk.Ads.ExtraParams = () => new Dictionary<string, object> { { "level_number", Progress.Level } };
    }
}
```

Then replace the game's direct AdMob / Firebase calls with `GameSdk.Ads.*`, `GameSdk.Analytics.Log` and
`GameSdk.Crash.*`. Send the events the dashboard reads under the catalog's names: `tutorial_begin`,
`tutorial_step` (step from 1, step_name), `tutorial_complete`, `level_start` / `level_end` (level_number,
success), `earn_virtual_currency` / `spend_virtual_currency` (virtual_currency_name, value, source/sink,
balance_after). Purchase revenue comes from Google Play's reports, so purchases need no revenue param.

Because Lost Treasures is the realistic version of Gem Miner, its placement names can follow Gem Mine's style
(PascalCase rewarded placements like `CoinCart`, snake_case interstitial moments like `panel_close`).

### 4.4 Test on a phone (development build)

1. `adb logcat -s Unity` shows `[GameSdk] Games SDK 0.1.0: analytics Firebase, crash Crashlytics, ads AdMob` and
   `Ads ready (AdMob). Adapters: ...` with each adapter's state.
2. Rewarded and interstitial ads show Google's test ads; each logs an `event ad_impression ...` line.
3. Firebase DebugView: `adb shell setprop debug.firebase.analytics.app <package id>`, then events show in the
   console within seconds, each with kpi_event_id, kpi_seq, kpi_sdk.
4. Crashlytics: throw a test exception from a debug button; it shows in the console after the next launch.
5. Mediation: add the phone's advertising id to testDeviceIds, call `GameSdk.Ads.OpenAdInspector()` from a debug
   button, and check that Unity Ads and Meta fill.

### 4.5 Before the store release

The pre-build check stops a **release** build that still has Google's test AdMob ids, or that has Firebase without
its config file. It warns about everything else Check Setup lists.

### 4.6 Dashboard

Add the game to `warehouse/dbt_project.yml` (`vars.games`) once its BigQuery export exists: `game_id:
lost_treasures`, `engine: unity`, `firebase_project`, `analytics_dataset`, `package_name`, `iap_source:
play_reports`, `ad_revenue_source: admob_api` (daily totals from the AdMob report, every mediation source). For
ad revenue per player, cohort and Meta campaign from the SDK's `ad_impression`, set `player_ad_revenue_source:
wrapper`; that setting comes with PR #19, which is still open.

## 5. Projects that already use Unity's EDM

Firebase and AdMob from OpenUPM depend on Google's External Dependency Manager (`com.google.external-dependency-manager`).
A project that already has Unity's fork (`com.unity.external-dependency-manager`) would end up with two, fighting over
the Gradle files. Gem Mine solved it with a placeholder: its `Packages/com.google.external-dependency-manager` is an
empty embedded package, so Unity's fork stays the only one. Install Dependencies warns when it sees this case. A new
project without Unity's fork needs nothing.

## 6. Moving Gem Mine onto the SDK later

Gem Mine's code maps one to one, so moving it is mostly deleting code: `AdMobAdBackend` → `GamesSdk.AdMob.AdMobNetwork`,
`FirebaseStartup` → `GamesSdk.FirebaseSupport.FirebaseStartup` (with `BeforeDefaultApp` for its App Check),
`FirebaseAnalyticsBackend` → `FirebaseAnalyticsBackend`, `AnalyticsNames` → `SdkNames`, `InterstitialGate`'s
cooldown/cap → `InterstitialPacing`, `AnalyticsService.OnAdRevenuePaid` → automatic `ad_impression`. Its
`MonetizationDirector` (when to show) stays in the game. Not planned until Michael asks.

## 7. What is verified

- `sdk/unity-sdk/Tests~/run.sh` compiles the core, the Firebase/Crashlytics and AdMob modules and the KPI
  wrapper with Mono against stand-ins of the Unity, Firebase and Google Mobile Ads APIs, type-checks the editor code,
  checks every file has a `.meta`, and runs 87 checks: the event queue, name cleaning, the exact `ad_impression`
  params, offer events, pacing rules, load retries, stand-in ads, Firebase/Crashlytics wiring, AdMob's consent gate,
  micros conversion and adapter status, and the manifest edits. CI runs it.
- **Not verified:** a compile inside Unity against the real Google and Firebase SDKs, and a run on a phone. The
  stand-ins mirror the real APIs as used by Gem Mine's working code, but only the first Unity build of Lost Treasures
  proves it. Expect possibly a small fix there.

## 8. Releasing a new version

1. Change the code, bump `sdk/unity-sdk/package.json` and `CHANGELOG.md` (and `GamesSdkVersions.SdkTag`).
2. `sh sdk/unity-sdk/Tests~/run.sh`.
3. Merge, then tag main: `git tag games-sdk-v0.1.1 && git push origin games-sdk-v0.1.1`.
4. In each game, change the tag in both manifest lines.

## 9. Next steps (not built)

- A Flutter package with the same events (Trade Empire and Business Empire), on top of `sdk/flutter`.
- Banners and app open ads, if a game needs them.
- Remote Config for pacing (the API is ready: assign `GameSdk.Ads.Pacing`).
- Meta SDK app events and the iOS ATT prompt, moved from Gem Mine's `AttributionService`.
