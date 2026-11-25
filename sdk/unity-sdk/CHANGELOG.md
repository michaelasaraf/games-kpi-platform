# Changelog

## 0.1.0 (2026-11-25)

First version, built from Gem Mine's ads, Firebase and Crashlytics code.

- `GameSdk.Init`, `GameSdk.Analytics`, `GameSdk.Ads`, `GameSdk.Crash`, configured by `Resources/GameSdkConfig`.
- AdMob 11.6.0 with UMP consent, rewarded and interstitial ads, load retries (2 to 64 s), interstitial pacing, adapter status.
- Mediation adapters pinned: Unity Ads 3.22.0, Meta Audience Network 3.20.1 (OpenUPM versions).
- Firebase Analytics and Crashlytics 14.1.0 through the Games KPI wrapper 0.2.0.
- Automatic `ad_impression`, `ad_offer_shown`, `ad_offer_accepted`.
- Editor: Create Config, Install Dependencies, Check Setup, AdMob app id sync, pre-build checks.
