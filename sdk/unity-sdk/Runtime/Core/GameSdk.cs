using System;
using UnityEngine;

namespace GamesSdk
{
    /// <summary>
    /// The one entry point a game uses for ads, analytics and crash reporting.
    /// <code>
    /// GameSdk.Init();                                        // once, at start (reads Resources/GameSdkConfig)
    /// GameSdk.Analytics.Log("level_start", "level_number", 3);
    /// GameSdk.Ads.OfferShown("CoinCart");                    // a "watch a video" button appears
    /// GameSdk.Ads.ShowRewarded("CoinCart", earned => { if (earned) GiveCoins(); });
    /// GameSdk.Ads.ShowInterstitial("level_end");             // shows only if the pacing rules allow
    /// GameSdk.Crash.SetKey("level", "3");
    /// </code>
    /// Calls made before <see cref="Init"/> or before Firebase is up are queued, never lost or thrown. The raw SDKs
    /// (Firebase, GoogleMobileAds, the Kpi wrapper) stay available for anything this does not cover.
    /// </summary>
    public static class GameSdk
    {
        public const string Version = "0.1.0";

        public static AnalyticsService Analytics { get; } = new AnalyticsService();

        public static AdsService Ads { get; } = new AdsService();

        public static CrashService Crash { get; } = new CrashService();

        public static GameSdkConfig Config { get; private set; }

        public static bool IsInitialized { get; private set; }

        /// <summary>
        /// Starts Crashlytics, analytics and ads. Pass the config, or leave it out to load Resources/GameSdkConfig.
        /// Ads start right away: Google's consent form (EEA/UK) shows on the first launch there, so call this once
        /// the first screen is up, not behind a loading screen that hides it.
        /// </summary>
        public static void Init(GameSdkConfig config = null)
        {
            if (IsInitialized) return;

            if (config == null) config = Resources.Load<GameSdkConfig>(GameSdkConfig.ResourcesName);
            if (config == null)
            {
                SdkLog.Warn("No Resources/GameSdkConfig asset (Tools > Games SDK > Create Config); using test ads and defaults.");
                config = ScriptableObject.CreateInstance<GameSdkConfig>();
            }

            Config = config;
            IsInitialized = true;
            GameSdkRunner.Ensure();

            Crash.Start(config, GameSdkModules.Create<ICrashBackend>(GameSdkModules.Crash, () => null, "Crash reporting"));
            Analytics.Start(config, GameSdkModules.Create<IAnalyticsBackend>(GameSdkModules.Analytics, () => new LogAnalyticsBackend(), "Analytics"));
            Ads.Start(config, GameSdkModules.Create<IAdNetwork>(GameSdkModules.Ads, () => new StandInAdNetwork(), "Ads"));

            SdkLog.Info($"Games SDK {Version}: analytics {Analytics.BackendName}, crash {Crash.BackendName}, ads {Ads.NetworkName}" +
                        (string.IsNullOrEmpty(config.gameId) ? string.Empty : $", game {config.gameId}"));
        }

        /// <summary>One line for a debug screen.</summary>
        public static string Describe() =>
            $"Games SDK {Version} | analytics {Analytics.BackendName} ready={Analytics.IsReady} | crash {Crash.BackendName} | " +
            $"ads {Ads.NetworkName} ready={Ads.IsInitialized} rv={Ads.IsRewardedReady} is={Ads.IsInterstitialReady} ({Ads.InterstitialBlocker() ?? "can show"})";

        internal static void ResetForTests()
        {
            IsInitialized = false;
            Config = null;
            Analytics.ResetForTests();
            Ads.ResetForTests();
            Crash.ResetForTests();
            SdkClock.Clear();
        }
    }
}
