using System;
using System.Collections.Generic;
using System.Linq;
using GoogleMobileAds.Api;
using GoogleMobileAds.Common;
using GoogleMobileAds.Ump.Api;
using UnityEngine;

namespace GamesSdk.AdMob
{
    /// <summary>
    /// Rewarded videos and interstitials through Google AdMob. Mediation networks (Unity Ads, Meta Audience Network)
    /// plug into AdMob itself: their adapter packages (Tools > Games SDK > Install Dependencies) and the AdMob console's
    /// mediation groups. Nothing in code changes when one is added; their state shows in GameSdk.Ads.AdapterStatus.
    ///
    /// Before any ad loads it asks Google's consent tool (UMP) whether a consent form is needed (EEA and UK) and shows
    /// it; UMP writes the IAB TCF consent string that AdMob and the adapters read. Compiles only on Android and iOS once
    /// com.google.ads.mobile is installed (GAMES_SDK_ADMOB). Ported from Gem Mine's AdMobAdBackend (2026-11).
    /// </summary>
    public sealed class AdMobNetwork : IAdNetwork
    {
        private GameSdkConfig config;
        private RewardedAd rewarded;
        private InterstitialAd interstitial;
        private bool loadingRewarded;
        private bool loadingInterstitial;
        private string adapterStatus = "Adapters: not started.";

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Register()
        {
            if (Application.isEditor) return; // the editor keeps the stand-in ads

            GameSdkModules.Ads = () => new AdMobNetwork();
        }

        public string Name => "AdMob";

        public string Platform => "admob";

        public bool IsStandIn => false;

        public bool IsRewardedReady => rewarded != null && rewarded.CanShowAd();

        public bool IsInterstitialReady => interstitial != null && interstitial.CanShowAd();

        public string AdapterStatus => adapterStatus;

        public bool PrivacyOptionsRequired =>
            ConsentInformation.PrivacyOptionsRequirementStatus == PrivacyOptionsRequirementStatus.Required;

        /// <summary>
        /// Google's callbacks can arrive on a background thread; the game is only touched from Unity's main thread.
        /// </summary>
        private static void OnMain(Action action) => MobileAdsEventExecutor.ExecuteInUpdate(action);

        private bool UsingTestUnits => GameSdkConfig.IsTestUnit(config.RewardedUnitId);

        public void Initialize(GameSdkConfig sdkConfig, Action<bool> done)
        {
            config = sdkConfig;

            // Every callback below goes to the main thread through MobileAdsEventExecutor, whose object Google only makes
            // when MobileAds is first touched. Without this the consent answer waits in its queue forever (Gem Mine bug).
            MobileAdsEventExecutor.Initialize();
            if (config.testDeviceIds != null && config.testDeviceIds.Length > 0)
            {
                MobileAds.SetRequestConfiguration(new RequestConfiguration { TestDeviceIds = new List<string>(config.testDeviceIds) });
            }

            ConsentInformation.Update(new ConsentRequestParameters(), updateError => OnMain(() =>
            {
                if (updateError != null) Debug.LogWarning($"[GameSdk] Consent check failed: {updateError.Message}");

                ConsentForm.LoadAndShowConsentFormIfRequired(formError => OnMain(() =>
                {
                    if (formError != null) Debug.LogWarning($"[GameSdk] Consent form: {formError.Message}");

                    if (!ConsentInformation.CanRequestAds())
                    {
                        // Google's sample app has no consent message, so the check can fail with test ids. Test ads carry
                        // no personal data, so the ad flow can still be tried.
                        if (!UsingTestUnits)
                        {
                            Debug.LogWarning($"[GameSdk] Ads may not be requested yet (consent {ConsentInformation.ConsentStatus}).");
                            done(false);
                            return;
                        }

                        Debug.Log("[GameSdk] No consent answer with Google's test ids; starting test ads anyway.");
                    }

                    MobileAds.Initialize(status => OnMain(() =>
                    {
                        adapterStatus = Describe(status);
                        done(true);
                    }));
                }));
            }));
        }

        public void LoadRewarded(Action<bool> loaded)
        {
            if (loadingRewarded) return;
            if (IsRewardedReady)
            {
                loaded(true);
                return;
            }

            loadingRewarded = true;
            rewarded?.Destroy();
            rewarded = null;
            RewardedAd.Load(config.RewardedUnitId, new AdRequest(), (ad, error) => OnMain(() =>
            {
                loadingRewarded = false;
                if (error != null || ad == null)
                {
                    Debug.Log($"[GameSdk] Rewarded video not loaded: {error?.GetMessage()}");
                    loaded(false);
                    return;
                }

                rewarded = ad;
                loaded(true);
            }));
        }

        public void LoadInterstitial(Action<bool> loaded)
        {
            if (loadingInterstitial) return;
            if (IsInterstitialReady)
            {
                loaded(true);
                return;
            }

            loadingInterstitial = true;
            interstitial?.Destroy();
            interstitial = null;
            InterstitialAd.Load(config.InterstitialUnitId, new AdRequest(), (ad, error) => OnMain(() =>
            {
                loadingInterstitial = false;
                if (error != null || ad == null)
                {
                    Debug.Log($"[GameSdk] Interstitial not loaded: {error?.GetMessage()}");
                    loaded(false);
                    return;
                }

                interstitial = ad;
                loaded(true);
            }));
        }

        public void ShowRewarded(Action<AdRevenue> paid, Action<bool> done)
        {
            var ad = rewarded;
            rewarded = null;
            if (ad == null || !ad.CanShowAd())
            {
                done(false);
                return;
            }

            var earned = false;
            var finished = false;
            var revenue = new RevenueReport(AdFormat.Rewarded, config.RewardedUnitId, ad.GetResponseInfo, paid);
            ad.OnAdImpressionRecorded += () => OnMain(revenue.Impression);
            ad.OnAdPaid += value => OnMain(() => revenue.Report(value));

            Action finish = () =>
            {
                if (finished) return;

                finished = true;
                revenue.Close();
                ad.Destroy();
                done(earned);
            };

            ad.OnAdFullScreenContentClosed += () => OnMain(finish);
            ad.OnAdFullScreenContentFailed += error => OnMain(() =>
            {
                Debug.Log($"[GameSdk] Rewarded video failed to show: {error?.GetMessage()}");
                finish();
            });
            // The reward callback only sets a flag; the close callback (on the main thread) reads it.
            ad.Show(_ => earned = true);
        }

        public void ShowInterstitial(Action<AdRevenue> paid, Action done)
        {
            var ad = interstitial;
            interstitial = null;
            if (ad == null || !ad.CanShowAd())
            {
                done();
                return;
            }

            var finished = false;
            var revenue = new RevenueReport(AdFormat.Interstitial, config.InterstitialUnitId, ad.GetResponseInfo, paid);
            ad.OnAdImpressionRecorded += () => OnMain(revenue.Impression);
            ad.OnAdPaid += value => OnMain(() => revenue.Report(value));

            Action finish = () =>
            {
                if (finished) return;

                finished = true;
                revenue.Close();
                ad.Destroy();
                done();
            };

            ad.OnAdFullScreenContentClosed += () => OnMain(finish);
            ad.OnAdFullScreenContentFailed += error => OnMain(() =>
            {
                Debug.Log($"[GameSdk] Interstitial failed to show: {error?.GetMessage()}");
                finish();
            });
            ad.Show();
        }

        public void ShowPrivacyOptions(Action done)
        {
            ConsentForm.ShowPrivacyOptionsForm(error => OnMain(() =>
            {
                if (error != null) Debug.LogWarning($"[GameSdk] Privacy options: {error.Message}");
                done?.Invoke();
            }));
        }

        public void OpenAdInspector()
        {
            MobileAds.OpenAdInspector(error =>
            {
                if (error != null) Debug.LogWarning($"[GameSdk] Ad Inspector: {error.GetMessage()}");
            });
        }

        private static string Describe(InitializationStatus status)
        {
            try
            {
                var map = status?.getAdapterStatusMap();
                if (map == null || map.Count == 0) return "Adapters: none reported.";

                return "Adapters: " + string.Join(", ", map.Select(pair =>
                    $"{Short(pair.Key)} {(pair.Value.InitializationState == AdapterState.Ready ? "ready" : "not ready: " + pair.Value.Description)}"));
            }
            catch (Exception e)
            {
                return "Adapters: " + e.Message;
            }
        }

        /// <summary>"com.google.ads.mediation.unity.UnityMediationAdapter" becomes "UnityMediationAdapter".</summary>
        private static string Short(string adapterClass)
        {
            if (string.IsNullOrEmpty(adapterClass)) return "?";

            var dot = adapterClass.LastIndexOf('.');
            return dot >= 0 ? adapterClass.Substring(dot + 1) : adapterClass;
        }

        /// <summary>
        /// Reports one shown ad exactly once: with its revenue when AdMob's paid event arrives (impression-level ad
        /// revenue must be on in the AdMob account), or without a value when the ad closes after an impression and no
        /// paid event came.
        /// </summary>
        private sealed class RevenueReport
        {
            private readonly AdFormat format;
            private readonly string unitId;
            private readonly Func<ResponseInfo> responseInfo;
            private readonly Action<AdRevenue> paid;
            private bool impression;
            private bool reported;

            public RevenueReport(AdFormat format, string unitId, Func<ResponseInfo> responseInfo, Action<AdRevenue> paid)
            {
                this.format = format;
                this.unitId = unitId;
                this.responseInfo = responseInfo;
                this.paid = paid;
            }

            public void Impression() => impression = true;

            public void Report(AdValue value)
            {
                if (reported || value == null) return;

                reported = true;
                var currency = string.IsNullOrEmpty(value.CurrencyCode) ? "USD" : value.CurrencyCode;
                Send(new AdRevenue(format, true, value.Value / 1000000d, currency, Precision(value.Precision), Source(), unitId, false));
            }

            public void Close()
            {
                if (reported || !impression) return;

                reported = true;
                Send(new AdRevenue(format, false, 0d, null, null, Source(), unitId, false));
            }

            private void Send(AdRevenue revenue)
            {
                try
                {
                    paid?.Invoke(revenue);
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"[GameSdk] Revenue report failed: {e.Message}");
                }
            }

            private string Source()
            {
                try
                {
                    var name = responseInfo?.Invoke()?.GetLoadedAdapterResponseInfo()?.AdSourceName;
                    return string.IsNullOrEmpty(name) ? "AdMob" : name;
                }
                catch (Exception)
                {
                    return "AdMob";
                }
            }

            private static string Precision(AdValue.PrecisionType precision)
            {
                switch (precision)
                {
                    case AdValue.PrecisionType.Precise: return "precise";
                    case AdValue.PrecisionType.Estimated: return "estimated";
                    case AdValue.PrecisionType.PublisherProvided: return "publisher_provided";
                    default: return "unknown";
                }
            }
        }
    }
}
