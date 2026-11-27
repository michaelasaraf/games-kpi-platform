using System;
using UnityEngine;

namespace GamesSdk
{
    /// <summary>
    /// Everything that differs between games, in one asset: Assets/Resources/GameSdkConfig.asset
    /// (Tools > Games SDK > Create Config). The editor copies the AdMob app ids from here into Google's own
    /// settings, so this is the only place to change them.
    /// </summary>
    [CreateAssetMenu(menuName = "Games SDK/Config", fileName = ResourcesName)]
    public sealed class GameSdkConfig : ScriptableObject
    {
        public const string ResourcesName = "GameSdkConfig";

        // Google's sample ids. They always fill with test ads and never pay.
        public const string TestAndroidAppId = "ca-app-pub-3940256099942544~3347511713";
        public const string TestAndroidRewarded = "ca-app-pub-3940256099942544/5224354917";
        public const string TestAndroidInterstitial = "ca-app-pub-3940256099942544/1033173712";
        public const string TestIosAppId = "ca-app-pub-3940256099942544~1458002511";
        public const string TestIosRewarded = "ca-app-pub-3940256099942544/1712485313";
        public const string TestIosInterstitial = "ca-app-pub-3940256099942544/4411468910";

        [Header("Game")]
        [Tooltip("The game's id on the KPI dashboard (dbt vars.games), e.g. gem_mine. Sent as the user property sdk_game.")]
        public string gameId = "";

        [Header("AdMob (mediation networks are set up in the AdMob console)")]
        public bool adsEnabled = true;
        public string androidAppId = TestAndroidAppId;
        public string androidRewardedId = TestAndroidRewarded;
        public string androidInterstitialId = TestAndroidInterstitial;
        public string iosAppId = TestIosAppId;
        public string iosRewardedId = TestIosRewarded;
        public string iosInterstitialId = TestIosInterstitial;

        [Tooltip("Development builds load Google's test ad units, so nobody clicks real ads while testing.")]
        public bool testAdsInDevelopmentBuilds = true;

        [Tooltip("Advertising ids (from the device log) that always get test ads, also in release builds.")]
        public string[] testDeviceIds = new string[0];

        [Tooltip("Rules that keep interstitials from showing too often. The game can change them at runtime (remote config) through GameSdk.Ads.Pacing.")]
        public InterstitialPacing interstitialPacing = new InterstitialPacing();

        [Header("Analytics and Crashlytics")]
        public bool analyticsEnabled = true;

        [Tooltip("Development builds also print every event to the log with the [GameSdk] prefix.")]
        public bool logEventsInDevelopmentBuilds = true;

        [Tooltip("Each analytics event is also a Crashlytics breadcrumb, so a crash report shows the last things the player did.")]
        public bool eventsAsCrashBreadcrumbs = true;

        [Tooltip("Crashlytics reports uncaught C# exceptions as crashes instead of non-fatal issues.")]
        public bool uncaughtExceptionsAsFatal;

        public bool OnIos => Application.platform == RuntimePlatform.IPhonePlayer;

        public bool UsesTestAds => testAdsInDevelopmentBuilds && Debug.isDebugBuild;

        public string AppId => OnIos ? Pick(iosAppId, TestIosAppId) : Pick(androidAppId, TestAndroidAppId);

        public string RewardedUnitId => UsesTestAds
            ? (OnIos ? TestIosRewarded : TestAndroidRewarded)
            : OnIos ? Pick(iosRewardedId, TestIosRewarded) : Pick(androidRewardedId, TestAndroidRewarded);

        public string InterstitialUnitId => UsesTestAds
            ? (OnIos ? TestIosInterstitial : TestAndroidInterstitial)
            : OnIos ? Pick(iosInterstitialId, TestIosInterstitial) : Pick(androidInterstitialId, TestAndroidInterstitial);

        /// <summary>True while this platform still has one of Google's sample ad units (fine in testing, never in a store build).</summary>
        public bool HasTestUnits
        {
            get
            {
                var rewarded = OnIos ? iosRewardedId : androidRewardedId;
                var interstitial = OnIos ? iosInterstitialId : androidInterstitialId;
                return IsTestUnit(rewarded) || IsTestUnit(interstitial);
            }
        }

        public static bool IsTestUnit(string id) => string.IsNullOrEmpty(id) || id.StartsWith("ca-app-pub-3940256099942544", StringComparison.Ordinal);

        private static string Pick(string value, string fallback) => string.IsNullOrEmpty(value) ? fallback : value.Trim();
    }

    /// <summary>
    /// When an interstitial may show. Defaults are Gem Mine's tuned values (2026-11): new players see no
    /// interstitial in their first 10 minutes, every session starts with 2 calm minutes, then at most one per
    /// 150 seconds and 20 a day. A value of 0 turns that rule off.
    /// </summary>
    [Serializable]
    public sealed class InterstitialPacing
    {
        [Tooltip("Seconds between two interstitials.")]
        public float minSecondsBetween = 150f;

        [Tooltip("Seconds after a rewarded video before an interstitial may show.")]
        public float minSecondsAfterRewarded = 60f;

        [Tooltip("Interstitials per day (the player's local day).")]
        public int maxPerDay = 20;

        [Tooltip("Total play time a new player needs before the first interstitial.")]
        public float minLifetimePlaySeconds = 600f;

        [Tooltip("Play time at the start of every session without interstitials.")]
        public float sessionGraceSeconds = 120f;

        public InterstitialPacing Clone() => (InterstitialPacing)MemberwiseClone();
    }
}
