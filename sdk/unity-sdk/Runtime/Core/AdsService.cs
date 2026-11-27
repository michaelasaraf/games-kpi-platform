using System;
using System.Collections.Generic;
using UnityEngine;

namespace GamesSdk
{
    /// <summary>
    /// Rewarded videos and interstitials (<see cref="GameSdk.Ads"/>), through AdMob and its mediation networks.
    /// It keeps one of each loaded (retrying with back-off), applies the interstitial pacing rules, and turns every
    /// shown ad into the KPI catalog's events, so every game reports ads the same way:
    /// <list type="bullet">
    /// <item><c>ad_offer_shown</c> when the game shows a "watch a video" button (<see cref="OfferShown"/>),</item>
    /// <item><c>ad_offer_accepted</c> when the player takes it (<see cref="ShowRewarded"/>),</item>
    /// <item><c>ad_impression</c> per shown ad with ad_platform, ad_format, value, currency, precision, ad_source,
    /// ad_unit_name and placement (the dashboard's per-player ad revenue: player_ad_revenue_source = wrapper).</item>
    /// </list>
    /// Placement names are the game's own words (CoinCart, panel_close); keep them stable, the dashboard groups by them.
    /// </summary>
    public sealed class AdsService
    {
        private const string DayKey = "games_sdk_is_day";
        private const string CountKey = "games_sdk_is_count";
        private const double MaxRetrySeconds = 64;

        private GameSdkConfig config;
        private IAdNetwork network;
        private bool started;
        private bool initialized;
        private bool initializing;
        private int rewardedFailures;
        private int interstitialFailures;
        private bool rewardedRetryPending;
        private bool interstitialRetryPending;
        private double lastInterstitialAt = double.NegativeInfinity;
        private double lastRewardedAt = double.NegativeInfinity;

        /// <summary>Runs for every shown ad with what it earned (also the stand-in's, with IsStandIn set). For Meta, Adjust, etc.</summary>
        public event Action<AdRevenue> Paid;

        /// <summary>A full-screen ad is about to cover the game: pause audio and timers.</summary>
        public event Action<AdFormat> ShowStarted;

        /// <summary>The full-screen ad is gone.</summary>
        public event Action<AdFormat> ShowEnded;

        /// <summary>Runs once when the network is up (or could not start: false).</summary>
        public event Action<bool> Initialized;

        /// <summary>
        /// Extra params for every ad_impression, ad_offer_shown and ad_offer_accepted, e.g. the current level:
        /// <c>GameSdk.Ads.ExtraParams = () => new Dictionary&lt;string, object&gt; { { "level_number", level } };</c>
        /// </summary>
        public Func<IDictionary<string, object>> ExtraParams { get; set; }

        /// <summary>The interstitial rules in force. Starts as GameSdkConfig's; replace it to apply remote config.</summary>
        public InterstitialPacing Pacing { get; set; } = new InterstitialPacing();

        public string NetworkName => network?.Name ?? "none";

        public bool IsStandIn => network == null || network.IsStandIn;

        public bool IsInitialized => initialized;

        public bool IsShowing { get; private set; }

        public bool IsRewardedReady => initialized && !IsShowing && network.IsRewardedReady;

        public bool IsInterstitialReady => initialized && !IsShowing && network.IsInterstitialReady;

        public string AdapterStatus => network?.AdapterStatus ?? string.Empty;

        /// <summary>True where the player must be able to reopen the ad consent choices (EEA, UK): show a Privacy button in settings.</summary>
        public bool PrivacyOptionsRequired
        {
            get
            {
                try
                {
                    return initialized && network.PrivacyOptionsRequired;
                }
                catch (Exception)
                {
                    return false;
                }
            }
        }

        public void ShowPrivacyOptions(Action done = null)
        {
            if (network == null)
            {
                done?.Invoke();
                return;
            }

            network.ShowPrivacyOptions(done);
        }

        /// <summary>
        /// Opens Google's Ad Inspector to check mediation (Unity Ads, Meta) on a phone registered as a test device
        /// (GameSdkConfig.testDeviceIds). Hook it to a debug button; it does nothing for players.
        /// </summary>
        public void OpenAdInspector()
        {
            if (initialized) network.OpenAdInspector();
        }

        internal void Start(GameSdkConfig sdkConfig, IAdNetwork chosen)
        {
            if (started) return;

            started = true;
            config = sdkConfig;
            network = chosen;
            Pacing = config.interstitialPacing != null ? config.interstitialPacing.Clone() : new InterstitialPacing();
            if (!config.adsEnabled)
            {
                SdkLog.Info("Ads are off in GameSdkConfig.");
                Initialized?.Invoke(false);
                return;
            }

            InitializeNetwork();
        }

        /// <summary>
        /// Tries the ad network again after it could not start (consent not answered yet, no network at launch).
        /// Does nothing while it is starting or once it runs.
        /// </summary>
        public void RetryInitialize()
        {
            if (!started || initialized || initializing || network == null || !config.adsEnabled) return;

            InitializeNetwork();
        }

        public bool IsInitializing => initializing;

        private void InitializeNetwork()
        {
            initializing = true;
            network.Initialize(config, ok =>
            {
                initializing = false;
                initialized = ok;
                SdkLog.Info(ok ? $"Ads ready ({network.Name}). {network.AdapterStatus}" : $"Ads could not start ({network.Name}).");
                if (ok)
                {
                    LoadRewarded();
                    LoadInterstitial();
                }

                Initialized?.Invoke(ok);
            });
        }

        /// <summary>Call when a "watch a video" offer appears on screen. Logs ad_offer_shown.</summary>
        public void OfferShown(string placement)
        {
            GameSdk.Analytics.Log("ad_offer_shown", WithExtras(new Dictionary<string, object>
            {
                { "placement", Placement(placement) },
                { "ad_format", "rewarded" },
                { "ad_ready", IsRewardedReady },
            }));
        }

        /// <summary>
        /// Shows a rewarded video for <paramref name="placement"/>. <paramref name="done"/> runs once with true when the
        /// player earned the reward. When none is loaded it answers false at once (show "no video right now").
        /// </summary>
        public void ShowRewarded(string placement, Action<bool> done)
        {
            var where = Placement(placement);
            GameSdk.Analytics.Log("ad_offer_accepted", WithExtras(new Dictionary<string, object>
            {
                { "placement", where },
                { "ad_format", "rewarded" },
                { "ad_ready", IsRewardedReady },
            }));

            if (!IsRewardedReady)
            {
                LoadRewarded();
                Call(done, false);
                return;
            }

            Begin(AdFormat.Rewarded);
            network.ShowRewarded(revenue => OnPaid(revenue, where), earned =>
            {
                lastRewardedAt = SdkClock.Now();
                End(AdFormat.Rewarded);
                LoadRewarded();
                Call(done, earned);
            });
        }

        /// <summary>
        /// Why an interstitial may not show now (pacing, not loaded, already showing), or null when it may.
        /// </summary>
        public string InterstitialBlocker()
        {
            if (!initialized) return "not_initialized";
            if (IsShowing) return "showing";

            var pacing = InterstitialGate.Blocker(Pacing, SdkClock.Now(), lastInterstitialAt, lastRewardedAt, ShownToday(), PlayTime.Lifetime, PlayTime.Session);
            if (pacing != null) return pacing;

            return network.IsInterstitialReady ? null : "not_loaded";
        }

        public bool CanShowInterstitial => InterstitialBlocker() == null;

        /// <summary>
        /// Shows an interstitial at a calm moment if the pacing rules allow one. Returns whether it shows;
        /// <paramref name="done"/> always runs, at once when nothing shows.
        /// </summary>
        public bool ShowInterstitial(string placement, Action done = null)
        {
            var blocker = InterstitialBlocker();
            if (blocker != null)
            {
                if (blocker == "not_loaded") LoadInterstitial();
                done?.Invoke();
                return false;
            }

            var where = Placement(placement);
            lastInterstitialAt = SdkClock.Now();
            CountShownToday();
            Begin(AdFormat.Interstitial);
            network.ShowInterstitial(revenue => OnPaid(revenue, where), () =>
            {
                lastInterstitialAt = SdkClock.Now();
                End(AdFormat.Interstitial);
                LoadInterstitial();
                done?.Invoke();
            });
            return true;
        }

        private void Begin(AdFormat format)
        {
            IsShowing = true;
            Raise(ShowStarted, format);
        }

        private void End(AdFormat format)
        {
            IsShowing = false;
            Raise(ShowEnded, format);
        }

        private void OnPaid(AdRevenue revenue, string placement)
        {
            var report = revenue.WithPlacement(placement);

            // The stand-in's ads are not real impressions: keep them out of Firebase, but show them in the editor log.
            if (!report.IsStandIn || Application.isEditor)
            {
                var parameters = new Dictionary<string, object>
                {
                    { "ad_platform", network.Platform },
                    { "ad_format", report.FormatName },
                    { "value", report.HasValue ? report.Value : 0d },
                    { "currency", report.HasValue && !string.IsNullOrEmpty(report.Currency) ? report.Currency : "USD" },
                    { "precision", report.HasValue && !string.IsNullOrEmpty(report.Precision) ? report.Precision : "unknown" },
                    { "placement", placement },
                };
                if (!string.IsNullOrEmpty(report.AdSource)) parameters["ad_source"] = report.AdSource;
                if (!string.IsNullOrEmpty(report.AdUnitId)) parameters["ad_unit_name"] = report.AdUnitId;
                GameSdk.Analytics.Log("ad_impression", WithExtras(parameters));
            }

            if (Paid == null) return;

            try
            {
                Paid(report);
            }
            catch (Exception e)
            {
                SdkLog.Warn($"Paid listener failed: {e.Message}");
            }
        }

        private void LoadRewarded()
        {
            if (!initialized || rewardedRetryPending || network.IsRewardedReady) return;

            network.LoadRewarded(ok =>
            {
                if (ok)
                {
                    rewardedFailures = 0;
                    return;
                }

                rewardedFailures++;
                rewardedRetryPending = true;
                SdkClock.After(RetryDelay(rewardedFailures), () =>
                {
                    rewardedRetryPending = false;
                    LoadRewarded();
                });
            });
        }

        private void LoadInterstitial()
        {
            if (!initialized || interstitialRetryPending || network.IsInterstitialReady) return;

            network.LoadInterstitial(ok =>
            {
                if (ok)
                {
                    interstitialFailures = 0;
                    return;
                }

                interstitialFailures++;
                interstitialRetryPending = true;
                SdkClock.After(RetryDelay(interstitialFailures), () =>
                {
                    interstitialRetryPending = false;
                    LoadInterstitial();
                });
            });
        }

        /// <summary>2, 4, 8 ... 64 seconds, as Google recommends for no-fill.</summary>
        internal static double RetryDelay(int failures) => Math.Min(MaxRetrySeconds, Math.Pow(2, Math.Max(1, Math.Min(failures, 6))));

        private int ShownToday()
        {
            return PlayerPrefs.GetString(DayKey, string.Empty) == SdkClock.Today() ? PlayerPrefs.GetInt(CountKey, 0) : 0;
        }

        private void CountShownToday()
        {
            var count = ShownToday() + 1;
            PlayerPrefs.SetString(DayKey, SdkClock.Today());
            PlayerPrefs.SetInt(CountKey, count);
        }

        private IDictionary<string, object> WithExtras(Dictionary<string, object> parameters)
        {
            if (ExtraParams == null) return parameters;

            try
            {
                var extra = ExtraParams();
                if (extra == null) return parameters;

                foreach (var pair in extra)
                {
                    if (!parameters.ContainsKey(pair.Key)) parameters[pair.Key] = pair.Value;
                }
            }
            catch (Exception e)
            {
                SdkLog.Warn($"ExtraParams failed: {e.Message}");
            }

            return parameters;
        }

        private static string Placement(string placement) => string.IsNullOrEmpty(placement) ? "unknown" : placement;

        private static void Call(Action<bool> done, bool value)
        {
            try
            {
                done?.Invoke(value);
            }
            catch (Exception e)
            {
                SdkLog.Warn($"Ad callback failed: {e.Message}");
            }
        }

        private static void Raise(Action<AdFormat> listeners, AdFormat format)
        {
            try
            {
                listeners?.Invoke(format);
            }
            catch (Exception e)
            {
                SdkLog.Warn($"Ad listener failed: {e.Message}");
            }
        }

        internal void ResetForTests()
        {
            started = false;
            initialized = false;
            initializing = false;
            IsShowing = false;
            network = null;
            rewardedFailures = interstitialFailures = 0;
            rewardedRetryPending = interstitialRetryPending = false;
            lastInterstitialAt = lastRewardedAt = double.NegativeInfinity;
            Paid = null;
            ShowStarted = null;
            ShowEnded = null;
            Initialized = null;
            ExtraParams = null;
        }
    }

    /// <summary>The interstitial pacing rules as plain logic, so they can be tested.</summary>
    public static class InterstitialGate
    {
        /// <summary>The first rule that blocks an interstitial now, or null.</summary>
        public static string Blocker(InterstitialPacing pacing, double now, double lastInterstitialAt, double lastRewardedAt, int shownToday, double lifetimePlaySeconds, double sessionPlaySeconds)
        {
            if (pacing == null) return null;
            if (pacing.minLifetimePlaySeconds > 0 && lifetimePlaySeconds < pacing.minLifetimePlaySeconds) return "new_player";
            if (pacing.sessionGraceSeconds > 0 && sessionPlaySeconds < pacing.sessionGraceSeconds) return "session_start";
            if (pacing.maxPerDay > 0 && shownToday >= pacing.maxPerDay) return "daily_cap";
            if (pacing.minSecondsBetween > 0 && now - lastInterstitialAt < pacing.minSecondsBetween) return "cooldown";
            if (pacing.minSecondsAfterRewarded > 0 && now - lastRewardedAt < pacing.minSecondsAfterRewarded) return "after_rewarded";
            return null;
        }
    }

    /// <summary>
    /// Editor, web, and phone builds without Google Mobile Ads: a rewarded video "plays" for a moment and always pays the
    /// reward, so every ad flow can be tried without a network. Earns nothing.
    /// </summary>
    public sealed class StandInAdNetwork : IAdNetwork
    {
        private const double ShowSeconds = 0.5;

        private bool rewardedLoaded;
        private bool interstitialLoaded;

        public string Name => "Stand-in";

        public string Platform => "stand_in";

        public bool IsStandIn => true;

        public bool IsRewardedReady => rewardedLoaded;

        public bool IsInterstitialReady => interstitialLoaded;

        public bool PrivacyOptionsRequired => false;

        public string AdapterStatus => "No ad network: stand-in ads only.";

        public void Initialize(GameSdkConfig config, Action<bool> done) => done(true);

        public void LoadRewarded(Action<bool> loaded)
        {
            rewardedLoaded = true;
            loaded(true);
        }

        public void LoadInterstitial(Action<bool> loaded)
        {
            interstitialLoaded = true;
            loaded(true);
        }

        public void ShowRewarded(Action<AdRevenue> paid, Action<bool> done)
        {
            rewardedLoaded = false;
            SdkLog.Info("Stand-in rewarded video (no real ad).");
            SdkClock.After(ShowSeconds, () =>
            {
                paid(new AdRevenue(AdFormat.Rewarded, false, 0d, "USD", "unknown", "stand_in", null, true));
                done(true);
            });
        }

        public void ShowInterstitial(Action<AdRevenue> paid, Action done)
        {
            interstitialLoaded = false;
            SdkLog.Info("Stand-in interstitial (no real ad).");
            SdkClock.After(ShowSeconds, () =>
            {
                paid(new AdRevenue(AdFormat.Interstitial, false, 0d, "USD", "unknown", "stand_in", null, true));
                done();
            });
        }

        public void ShowPrivacyOptions(Action done) => done?.Invoke();

        public void OpenAdInspector() => SdkLog.Info("Stand-in ads have no Ad Inspector.");
    }
}
