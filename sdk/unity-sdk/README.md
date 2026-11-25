# Games SDK (Unity)

One package every game installs instead of wiring up ads, analytics and crash reporting itself:

- **Ads:** Google AdMob with mediation (Unity Ads and Meta Audience Network adapters), Google's consent form (UMP), rewarded videos and interstitials with load retries and interstitial pacing.
- **Analytics:** Firebase Analytics through the Games KPI wrapper (`com.gameskpi.analytics`), so every event carries the KPI envelope and the install referrer is sent once per install.
- **Crashes:** Firebase Crashlytics, with every event as a breadcrumb and every user property as a key.
- **KPI events for free:** every shown ad becomes `ad_impression` with its revenue and placement; rewarded offers become `ad_offer_shown` / `ad_offer_accepted`. These are the names the KPI dashboard reads.

```csharp
using GamesSdk;

GameSdk.Init();                                            // once, at start
GameSdk.Analytics.Log("level_start", "level_number", 3);
GameSdk.Ads.OfferShown("CoinCart");                        // a "watch a video" button appears
GameSdk.Ads.ShowRewarded("CoinCart", earned => { if (earned) GiveCoins(); });
GameSdk.Ads.ShowInterstitial("level_end");                 // shows only if the pacing rules allow
GameSdk.Crash.SetKey("level", "3");
```

Install (Packages/manifest.json), then **Tools > Games SDK > Install Dependencies** and **Create Config**:

```json
"com.gameskpi.sdk": "https://github.com/michaelasaraf/games-kpi-platform.git?path=sdk/unity-sdk#games-sdk-v0.1.0",
"com.gameskpi.analytics": "https://github.com/michaelasaraf/games-kpi-platform.git?path=sdk/unity#games-sdk-v0.1.0"
```

The full design and the step-by-step integration guide are in [docs/games-sdk.md](../../docs/games-sdk.md).

Tests: `Tests~/run.sh` compiles the package against API stand-ins with Mono and runs its checks. It does not replace a Unity build.
