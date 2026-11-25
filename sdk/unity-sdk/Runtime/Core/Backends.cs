using System;
using System.Collections.Generic;

namespace GamesSdk
{
    /// <summary>
    /// Where analytics events go. The Firebase module (Runtime/Firebase, compiled on Android and iOS once Firebase
    /// Analytics is installed) sends them through the Games KPI wrapper; everywhere else they go to the log.
    /// Names and params arrive already cleaned to Firebase's rules.
    /// </summary>
    public interface IAnalyticsBackend
    {
        string Name { get; }

        /// <summary>Starts the backend and calls <paramref name="ready"/> once (true = events can be sent).</summary>
        void Start(GameSdkConfig config, Action<bool> ready);

        void Log(string eventName, IReadOnlyList<KeyValuePair<string, object>> parameters);

        void SetUserProperty(string name, string value);

        void SetUserId(string userId);

        void SetConsent(bool analytics, bool ads);
    }

    /// <summary>Crash reporting: Crashlytics when installed, otherwise nothing.</summary>
    public interface ICrashBackend
    {
        string Name { get; }

        void Start(GameSdkConfig config, Action<bool> ready);

        void Log(string message);

        void SetKey(string key, string value);

        void SetUserId(string userId);

        void RecordException(Exception exception);
    }

    /// <summary>
    /// The ad network: AdMob (with its mediation adapters) when installed, otherwise the stand-in that shows no real
    /// ad. Every callback comes back on Unity's main thread.
    /// </summary>
    public interface IAdNetwork
    {
        string Name { get; }

        /// <summary>Value of the ad_platform param, e.g. admob.</summary>
        string Platform { get; }

        /// <summary>Shows no real ad and earns nothing (editor, web, or a phone build without the ads package).</summary>
        bool IsStandIn { get; }

        void Initialize(GameSdkConfig config, Action<bool> done);

        bool IsRewardedReady { get; }

        bool IsInterstitialReady { get; }

        /// <summary>Loads one rewarded video; <paramref name="loaded"/> says whether it is ready.</summary>
        void LoadRewarded(Action<bool> loaded);

        void LoadInterstitial(Action<bool> loaded);

        /// <summary>
        /// Shows the loaded rewarded video. <paramref name="paid"/> runs once per shown ad with what it earned;
        /// <paramref name="done"/> runs once when it closes or fails, with whether the reward was earned.
        /// </summary>
        void ShowRewarded(Action<AdRevenue> paid, Action<bool> done);

        void ShowInterstitial(Action<AdRevenue> paid, Action done);

        /// <summary>True where the law asks for a way to change the ad consent later (EEA, UK).</summary>
        bool PrivacyOptionsRequired { get; }

        void ShowPrivacyOptions(Action done);

        /// <summary>Google's Ad Inspector: which mediation networks are set up and why one does not fill (test devices only).</summary>
        void OpenAdInspector();

        /// <summary>One line per mediation adapter and its state, for debugging mediation.</summary>
        string AdapterStatus { get; }
    }

    public enum AdFormat
    {
        Rewarded,
        Interstitial,
    }

    /// <summary>What one shown ad earned, as the network reported it.</summary>
    public readonly struct AdRevenue
    {
        public readonly AdFormat Format;

        /// <summary>False when the network sent no paid event for this impression (the value is then 0).</summary>
        public readonly bool HasValue;

        /// <summary>In <see cref="Currency"/> units (AdMob reports micros; the network divides).</summary>
        public readonly double Value;

        public readonly string Currency;

        /// <summary>precise, estimated, publisher_provided or unknown.</summary>
        public readonly string Precision;

        /// <summary>The ad source that filled it: AdMob, or a mediation network such as Unity Ads or Meta Audience Network.</summary>
        public readonly string AdSource;

        public readonly string AdUnitId;

        /// <summary>The game's placement name, filled in by <see cref="AdsService"/>.</summary>
        public readonly string Placement;

        public readonly bool IsStandIn;

        public AdRevenue(AdFormat format, bool hasValue, double value, string currency, string precision, string adSource, string adUnitId, bool isStandIn, string placement = null)
        {
            Format = format;
            HasValue = hasValue;
            Value = value;
            Currency = currency;
            Precision = precision;
            AdSource = adSource;
            AdUnitId = adUnitId;
            IsStandIn = isStandIn;
            Placement = placement;
        }

        public AdRevenue WithPlacement(string placement) =>
            new AdRevenue(Format, HasValue, Value, Currency, Precision, AdSource, AdUnitId, IsStandIn, placement);

        public string FormatName => Format == AdFormat.Rewarded ? "rewarded" : "interstitial";
    }

    /// <summary>
    /// The optional modules register themselves here before the first scene loads, so the core never references
    /// Firebase or Google Mobile Ads and compiles in every project.
    /// </summary>
    public static class GameSdkModules
    {
        public static Func<IAnalyticsBackend> Analytics { get; set; }

        public static Func<ICrashBackend> Crash { get; set; }

        public static Func<IAdNetwork> Ads { get; set; }

        internal static T Create<T>(Func<T> factory, Func<T> fallback, string what) where T : class
        {
            try
            {
                var made = factory?.Invoke();
                if (made != null) return made;
            }
            catch (Exception e)
            {
                SdkLog.Warn($"{what} could not start, using the stand-in: {e.Message}");
            }

            return fallback();
        }
    }

    internal static class SdkLog
    {
        public static void Info(string message) => UnityEngine.Debug.Log("[GameSdk] " + message);

        public static void Warn(string message) => UnityEngine.Debug.LogWarning("[GameSdk] " + message);
    }
}
