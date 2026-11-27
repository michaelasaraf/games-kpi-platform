using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Firebase.Analytics;
using Firebase.Crashlytics;
using GamesSdk;
using GamesSdk.Editor;
using UnityEngine;

public static class SdkTest
{
    static int failures;
    static double now;

    static void Check(bool ok, string what)
    {
        if (!ok) { failures++; Console.WriteLine("FAIL " + what); }
        else Console.WriteLine("ok   " + what);
    }

    sealed class FakeBackend : IAnalyticsBackend
    {
        public readonly List<KeyValuePair<string, IReadOnlyList<KeyValuePair<string, object>>>> Events = new List<KeyValuePair<string, IReadOnlyList<KeyValuePair<string, object>>>>();
        public readonly Dictionary<string, string> Props = new Dictionary<string, string>();
        public Action<bool> Ready;
        public string Name => "Fake";
        public void Start(GameSdkConfig config, Action<bool> ready) { Ready = ready; }
        public void Log(string eventName, IReadOnlyList<KeyValuePair<string, object>> parameters) { Events.Add(new KeyValuePair<string, IReadOnlyList<KeyValuePair<string, object>>>(eventName, parameters)); }
        public void SetUserProperty(string name, string value) { Props[name] = value; }
        public void SetUserId(string userId) { }
        public void SetConsent(bool analytics, bool ads) { }
        public object P(string ev, string key) => Events.Last(e => e.Key == ev).Value.FirstOrDefault(p => p.Key == key).Value;
        public int Count(string ev) => Events.Count(e => e.Key == ev);
    }

    sealed class FakeNetwork : IAdNetwork
    {
        public bool FailLoads;
        public int RewardedLoads;
        public bool Rewarded, Interstitial;
        public string Name => "Fake";
        public string Platform => "admob";
        public bool IsStandIn => false;
        public bool IsRewardedReady => Rewarded;
        public bool IsInterstitialReady => Interstitial;
        public bool PrivacyOptionsRequired => false;
        public string AdapterStatus => "Adapters: fake";
        public void Initialize(GameSdkConfig config, Action<bool> done) { done(true); }
        public void LoadRewarded(Action<bool> loaded) { RewardedLoads++; Rewarded = !FailLoads; loaded(!FailLoads); }
        public void LoadInterstitial(Action<bool> loaded) { Interstitial = !FailLoads; loaded(!FailLoads); }
        public void ShowRewarded(Action<AdRevenue> paid, Action<bool> done)
        {
            Rewarded = false;
            paid(new AdRevenue(AdFormat.Rewarded, true, 0.0125, "USD", "precise", "Unity Ads", "unit/rv", false));
            done(true);
        }
        public void ShowInterstitial(Action<AdRevenue> paid, Action done)
        {
            Interstitial = false;
            paid(new AdRevenue(AdFormat.Interstitial, false, 0, null, null, "Meta Audience Network", "unit/is", false));
            done();
        }
        public void ShowPrivacyOptions(Action done) { done?.Invoke(); }
        public void OpenAdInspector() { }
    }

    static GameSdkConfig Config()
    {
        var c = ScriptableObject.CreateInstance<GameSdkConfig>();
        c.gameId = "lost_treasures";
        return c;
    }

    static void Fresh()
    {
        GameSdk.ResetForTests();
        GameSdkModules.Analytics = null;
        GameSdkModules.Crash = null;
        GameSdkModules.Ads = null;
        PlayerPrefs.Clear();
        PlayTime.ResetForTests(0, 0);
        now = 1000;
    }

    public static int Main()
    {
        SdkClock.Now = () => now;
        SdkClock.Today = () => "2026-11-25";

        Names();
        AnalyticsQueue();
        Ads();
        Pacing();
        Retry();
        StandIn();
        FirebaseAndCrashlytics();
        AdMob();
        Manifest();

        Console.WriteLine(failures == 0 ? "All SDK checks passed." : failures + " SDK check(s) failed.");
        return failures == 0 ? 0 : 1;
    }

    static void Names()
    {
        Check(SdkNames.Event("Level Start!") == "Level_Start_", "bad characters become underscores");
        Check(SdkNames.Event("firebase_thing") == "g_firebase_thing", "reserved prefix gets g_");
        Check(SdkNames.Event("1st_win") == "g_1st_win", "leading digit gets g_");
        Check(SdkNames.Event(new string('a', 50)).Length == 40, "event names cut to 40");
        Check(SdkNames.UserProperty(new string('a', 30)).Length == 24, "user property names cut to 24");
        Check(SdkNames.SnakeCase("CoinCart") == "coin_cart", "snake case");
    }

    static void AnalyticsQueue()
    {
        Fresh();
        var fake = new FakeBackend();
        GameSdkModules.Analytics = () => fake;

        GameSdk.Analytics.Log("before_init", "a", 1);
        GameSdk.Init(Config());
        GameSdk.Analytics.Log("before_ready", new Dictionary<string, object> { { "flag", true }, { "n", 3 }, { "f", 1.5f }, { "s", new string('x', 150) }, { "nothing", null }, { "e", AdFormat.Interstitial } });
        Check(fake.Events.Count == 0, "events wait until the backend is ready");
        fake.Ready(true);
        Check(fake.Events.Select(e => e.Key).SequenceEqual(new[] { "before_init", "before_ready" }), "queued events are sent in order once ready");
        Check((long)fake.P("before_ready", "flag") == 1L, "bool sent as 1");
        Check(fake.P("before_ready", "n") is long, "int sent as long");
        Check(fake.P("before_ready", "f") is double, "float sent as double");
        Check(((string)fake.P("before_ready", "s")).Length == 100, "text cut to 100");
        Check(fake.Events.Last().Value.All(p => p.Key != "nothing"), "null params left out");
        Check((string)fake.P("before_ready", "e") == "interstitial", "enum sent as snake case text");
        Check(fake.Props["sdk_game"] == "lost_treasures" && fake.Props["app_version"] == "1.0" && fake.Props["build"] == "dev", "default user properties");

        var many = new Dictionary<string, object>();
        for (var i = 0; i < 30; i++) many["p" + i] = i;
        GameSdk.Analytics.Log("many", many);
        Check(fake.Events.Last().Value.Count == SdkNames.GameParamsMax, "at most 22 game params (the wrapper adds 3)");

        var ran = false;
        GameSdk.Analytics.WhenReady(() => ran = true);
        Check(ran, "WhenReady runs at once when ready");
    }

    static void Ads()
    {
        Fresh();
        var fake = new FakeBackend();
        var net = new FakeNetwork();
        GameSdkModules.Analytics = () => fake;
        GameSdkModules.Ads = () => net;
        GameSdk.Init(Config());
        fake.Ready(true);

        Check(GameSdk.Ads.IsInitialized && GameSdk.Ads.IsRewardedReady && GameSdk.Ads.IsInterstitialReady, "ads preload after init");
        GameSdk.Ads.ExtraParams = () => new Dictionary<string, object> { { "level_number", 4 }, { "placement", "ignored" } };
        var paid = new List<AdRevenue>();
        var started = 0;
        var ended = 0;
        GameSdk.Ads.Paid += r => paid.Add(r);
        GameSdk.Ads.ShowStarted += f => started++;
        GameSdk.Ads.ShowEnded += f => ended++;

        GameSdk.Ads.OfferShown("CoinCart");
        Check((string)fake.P("ad_offer_shown", "placement") == "CoinCart" && (long)fake.P("ad_offer_shown", "ad_ready") == 1L, "ad_offer_shown with placement");

        bool? earned = null;
        GameSdk.Ads.ShowRewarded("CoinCart", e => earned = e);
        Check(earned == true, "rewarded pays the reward");
        Check(fake.Count("ad_offer_accepted") == 1, "ad_offer_accepted logged");
        Check(started == 1 && ended == 1 && !GameSdk.Ads.IsShowing, "show started/ended events");
        Check((string)fake.P("ad_impression", "ad_platform") == "admob", "ad_impression ad_platform");
        Check((string)fake.P("ad_impression", "ad_format") == "rewarded", "ad_impression ad_format");
        Check((double)fake.P("ad_impression", "value") == 0.0125, "ad_impression value");
        Check((string)fake.P("ad_impression", "currency") == "USD", "ad_impression currency");
        Check((string)fake.P("ad_impression", "precision") == "precise", "ad_impression precision");
        Check((string)fake.P("ad_impression", "ad_source") == "Unity Ads", "ad_impression ad_source");
        Check((string)fake.P("ad_impression", "ad_unit_name") == "unit/rv", "ad_impression ad_unit_name");
        Check((string)fake.P("ad_impression", "placement") == "CoinCart", "placement is the game's, not ExtraParams'");
        Check((long)fake.P("ad_impression", "level_number") == 4L, "ExtraParams added");
        Check(paid.Count == 1 && paid[0].Placement == "CoinCart", "Paid event carries the placement");
        Check(GameSdk.Ads.IsRewardedReady, "next rewarded loads after the show");

        net.Rewarded = false;
        net.FailLoads = true;
        earned = null;
        GameSdk.Ads.ShowRewarded("EggHurry", e => earned = e);
        Check(earned == false, "no video loaded answers false at once");
        Check((long)fake.P("ad_offer_accepted", "ad_ready") == 0L, "ad_offer_accepted says the video was not ready");
    }

    static void Pacing()
    {
        Fresh();
        var fake = new FakeBackend();
        var net = new FakeNetwork();
        GameSdkModules.Analytics = () => fake;
        GameSdkModules.Ads = () => net;
        GameSdk.Init(Config());
        fake.Ready(true);

        Check(GameSdk.Ads.InterstitialBlocker() == "new_player", "no interstitial in a new player's first 10 minutes");
        PlayTime.ResetForTests(700, 30);
        Check(GameSdk.Ads.InterstitialBlocker() == "session_start", "no interstitial in the session's first 2 minutes");
        PlayTime.ResetForTests(700, 200);
        Check(GameSdk.Ads.InterstitialBlocker() == null, "interstitial allowed after the grace periods");
        var done = false;
        Check(GameSdk.Ads.ShowInterstitial("level_end", () => done = true) && done, "interstitial shows");
        Check((string)fake.P("ad_impression", "ad_format") == "interstitial" && (double)fake.P("ad_impression", "value") == 0d && (string)fake.P("ad_impression", "precision") == "unknown", "unpriced impression still counts, value 0");
        done = false;
        Check(!GameSdk.Ads.ShowInterstitial("level_end", () => done = true) && done, "blocked interstitial still calls done");
        Check(GameSdk.Ads.InterstitialBlocker() == "cooldown", "150 s cooldown");
        now += 151;
        Check(GameSdk.Ads.InterstitialBlocker() == null, "allowed after the cooldown");
        GameSdk.Ads.ShowRewarded("CoinCart", e => { });
        now += 151;
        Check(GameSdk.Ads.InterstitialBlocker() == null, "rewarded cooldown (60 s) already over");
        GameSdk.Ads.ShowRewarded("CoinCart", e => { });
        Check(GameSdk.Ads.InterstitialBlocker() == "after_rewarded", "no interstitial right after a rewarded video");

        var pacing = new InterstitialPacing { maxPerDay = 2, minSecondsBetween = 0, minSecondsAfterRewarded = 0, minLifetimePlaySeconds = 0, sessionGraceSeconds = 0 };
        Check(InterstitialGate.Blocker(pacing, 0, 0, 0, 2, 0, 0) == "daily_cap", "daily cap");
        GameSdk.Ads.Pacing = pacing;
        now += 1;
        GameSdk.Ads.ShowInterstitial("a");
        Check(GameSdk.Ads.InterstitialBlocker() == "daily_cap", "the day's count is saved (1 earlier + 1 now = cap 2)");
        Check(AdsService.RetryDelay(1) == 2 && AdsService.RetryDelay(3) == 8 && AdsService.RetryDelay(20) == 64, "retry back-off 2..64 s");
    }

    static void Retry()
    {
        Fresh();
        var fake = new FakeBackend();
        var net = new FakeNetwork { FailLoads = true };
        GameSdkModules.Analytics = () => fake;
        GameSdkModules.Ads = () => net;
        GameSdk.Init(Config());
        Check(net.RewardedLoads == 1, "first load at init");
        now += 1.9;
        SdkClock.Tick();
        Check(net.RewardedLoads == 1, "no retry before 2 s");
        now += 0.2;
        SdkClock.Tick();
        Check(net.RewardedLoads == 2, "retry after 2 s");
        net.FailLoads = false;
        now += 4.1;
        SdkClock.Tick();
        Check(net.RewardedLoads == 3 && GameSdk.Ads.IsRewardedReady, "second retry after 4 s loads");
    }

    static void StandIn()
    {
        Fresh();
        var fake = new FakeBackend();
        GameSdkModules.Analytics = () => fake;
        GameSdk.Init(Config());
        fake.Ready(true);
        Check(GameSdk.Ads.IsStandIn && GameSdk.Ads.IsRewardedReady, "stand-in ads without an ad network");
        bool? earned = null;
        GameSdk.Ads.ShowRewarded("CoinCart", e => earned = e);
        Check(earned == null && GameSdk.Ads.IsShowing, "stand-in video plays for a moment");
        now += 1;
        SdkClock.Tick();
        Check(earned == true, "stand-in pays the reward");
        Check(fake.Count("ad_impression") == 0, "stand-in impressions stay out of analytics on a phone");
    }

    static void FirebaseAndCrashlytics()
    {
        Fresh();
        FirebaseAnalytics.Logged.Clear();
        typeof(GamesSdk.FirebaseSupport.FirebaseStartup).Assembly.GetType("GamesSdk.FirebaseSupport.FirebaseModule")
            .GetMethod("Register", BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, null);
        Check(GameSdkModules.Analytics != null && GameSdkModules.Crash != null, "Firebase module registers analytics and Crashlytics");
        var config = Config();
        config.uncaughtExceptionsAsFatal = true;
        GameSdk.Init(config);
        Check(GameSdk.Analytics.IsReady && GameSdk.Crash.IsReady, "Firebase starts analytics and Crashlytics");
        GameSdk.Analytics.Log("level_start", "level_number", 2);
        var ev = FirebaseAnalytics.Logged.Last();
        Check(ev.Key == "level_start", "event reaches Firebase");
        Check(ev.Value.Any(p => p.Name == "level_number" && (long)p.Value == 2L), "param reaches Firebase as long");
        Check(ev.Value.Any(p => p.Name == "kpi_event_id") && ev.Value.Any(p => p.Name == "kpi_seq") && ev.Value.Any(p => p.Name == "kpi_sdk"), "KPI envelope added by the wrapper");
        Check(FirebaseAnalytics.UserProperties["sdk_game"] == "lost_treasures", "user property reaches Firebase");
        Check(Crashlytics.Logs.Contains("level_start"), "event is a Crashlytics breadcrumb");
        Check(Crashlytics.Keys["sdk_game"] == "lost_treasures", "user property is a Crashlytics key");
        Check(Crashlytics.ReportUncaughtExceptionsAsFatal, "uncaught-exceptions-as-fatal applied");
        GameSdk.Crash.RecordException(new InvalidOperationException("boom"));
        Check(Crashlytics.Exceptions.Count == 1, "caught exception reported");
        GameSdk.Analytics.SetUserId("p42");
        Check(FirebaseAnalytics.UserId == "p42" && Crashlytics.UserId == "p42", "user id on both");
    }

    static void AdMob()
    {
        Fresh();
        var fake = new FakeBackend();
        GameSdkModules.Analytics = () => fake;
        typeof(GamesSdk.AdMob.AdMobNetwork).GetMethod("Register", BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, null);
        GoogleMobileAds.Api.MobileAds.Status.Map["com.google.ads.mediation.unity.UnityMediationAdapter"] = new GoogleMobileAds.Api.AdapterStatus { InitializationState = GoogleMobileAds.Api.AdapterState.Ready };
        GoogleMobileAds.Api.MobileAds.Status.Map["com.google.ads.mediation.facebook.FacebookMediationAdapter"] = new GoogleMobileAds.Api.AdapterStatus { InitializationState = GoogleMobileAds.Api.AdapterState.NotReady, Description = "timeout" };
        GameSdk.Init(Config());
        fake.Ready(true);
        Check(GameSdk.Ads.NetworkName == "AdMob" && GameSdk.Ads.IsInitialized, "AdMob starts after the consent check");
        Check(GameSdk.Ads.AdapterStatus.Contains("UnityMediationAdapter ready") && GameSdk.Ads.AdapterStatus.Contains("FacebookMediationAdapter not ready: timeout"), "adapter status listed");
        Check(GameSdk.Ads.IsRewardedReady && GameSdk.Ads.IsInterstitialReady, "AdMob preloads both formats");
        GameSdk.Ads.OpenAdInspector();
        Check(GoogleMobileAds.Api.MobileAds.InspectorOpened == 1, "Ad Inspector opens");
        bool? earned = null;
        GameSdk.Ads.ShowRewarded("RoyalGeode", e => earned = e);
        Check(earned == true, "AdMob rewarded pays");
        Check((double)fake.P("ad_impression", "value") == 0.0125, "AdMob micros divided to currency units");
        Check((string)fake.P("ad_impression", "ad_source") == "Unity Ads", "AdMob ad source from the response info");
        Check((string)fake.P("ad_impression", "ad_unit_name") == GameSdkConfig.TestAndroidRewarded, "dev build uses Google's test unit");
        Check(fake.Count("ad_impression") == 1, "one impression per ad");

        GoogleMobileAds.Api.FullScreenAd.NextValue = null;
        PlayTime.ResetForTests(1000, 1000);
        GameSdk.Ads.Pacing = new InterstitialPacing { minSecondsAfterRewarded = 0 };
        Check(GameSdk.Ads.ShowInterstitial("panel_close"), "AdMob interstitial shows");
        Check((string)fake.P("ad_impression", "ad_format") == "interstitial" && (double)fake.P("ad_impression", "value") == 0d, "impression without a paid event still counts");

        GameSdk.ResetForTests();
        Debug.isDebugBuild = false;
        GoogleMobileAds.Ump.Api.ConsentInformation.CanRequest = false;
        var c = Config();
        c.androidRewardedId = "ca-app-pub-1111/2222";
        GameSdk.Init(c);
        Check(GameSdk.Ads.NetworkName == "AdMob" && !GameSdk.Ads.IsInitialized, "real ads wait for consent");
        GoogleMobileAds.Ump.Api.ConsentInformation.CanRequest = true;
        var heard = false;
        GameSdk.Ads.Initialized += ok => heard = ok;
        GameSdk.Ads.RetryInitialize();
        Check(heard && GameSdk.Ads.IsInitialized, "RetryInitialize starts the ads once consent is there");
        Debug.isDebugBuild = true;
    }

    static void Manifest()
    {
        const string bare = "{\n  \"dependencies\": {\n    \"com.unity.ugui\": \"2.0.0\"\n  }\n}\n";
        var m = ManifestText.EnsureRegistry(bare, "package.openupm.com", "https://package.openupm.com", "com.google.ads.mobile", "com.google.external-dependency-manager");
        m = ManifestText.AddDependency(m, "com.google.ads.mobile", "11.6.0");
        m = ManifestText.AddDependency(m, "com.google.ads.mobile", "9.0.0");
        Check(ManifestText.Dependency(m, "com.google.ads.mobile") == "11.6.0", "dependency added once, existing one kept");
        Check(ManifestText.Dependency(m, "com.unity.ugui") == "2.0.0", "other dependencies untouched");
        Check(m.Contains("\"scopedRegistries\"") && m.Contains("\"com.google.external-dependency-manager\""), "OpenUPM registry added with scopes");
        Check(Json.Valid(m), "manifest stays valid JSON (new registry)");

        const string gem = "{\n  \"scopedRegistries\": [\n    {\n      \"name\": \"package.openupm.com\",\n      \"url\": \"https://package.openupm.com\",\n      \"scopes\": [\n        \"com.google.ads.mobile\"\n      ]\n    }\n  ],\n  \"dependencies\": {}\n}\n";
        var g = ManifestText.EnsureRegistry(gem, "package.openupm.com", "https://package.openupm.com", "com.google.ads.mobile", "com.google.external-dependency-manager");
        Check(g.Contains("\"com.google.external-dependency-manager\"") && g.Split(new[] { "com.google.ads.mobile\"" }, StringSplitOptions.None).Length == 2, "missing scope added, present scope not doubled");
        g = ManifestText.AddDependency(g, "com.gameskpi.analytics", "https://github.com/x/y.git?path=sdk/unity#t");
        Check(Json.Valid(g), "manifest stays valid JSON (existing registry, empty dependencies)");
        Check(ManifestText.Dependency(g, "com.gameskpi.analytics").EndsWith("#t"), "git URL dependency added");

        const string noScopes = "{\n  \"scopedRegistries\": [\n    {\n      \"name\": \"package.openupm.com\",\n      \"url\": \"https://package.openupm.com\"\n    }\n  ],\n  \"dependencies\": {}\n}\n";
        var n = ManifestText.EnsureRegistry(noScopes, "package.openupm.com", "https://package.openupm.com", "com.google.ads.mobile");
        Check(Json.Valid(n) && n.Contains("\"scopes\""), "scopes array added to a registry without one");
    }

    /// <summary>Tiny JSON syntax check (objects, arrays, strings, numbers, literals).</summary>
    static class Json
    {
        public static bool Valid(string s)
        {
            var i = 0;
            try { Value(s, ref i); Ws(s, ref i); return i == s.Length; } catch (Exception) { Console.WriteLine(s); return false; }
        }

        static void Ws(string s, ref int i) { while (i < s.Length && char.IsWhiteSpace(s[i])) i++; }

        static void Value(string s, ref int i)
        {
            Ws(s, ref i);
            var c = s[i];
            if (c == '{')
            {
                i++; Ws(s, ref i);
                if (s[i] == '}') { i++; return; }
                while (true)
                {
                    Ws(s, ref i); Str(s, ref i); Ws(s, ref i);
                    if (s[i++] != ':') throw new FormatException();
                    Value(s, ref i); Ws(s, ref i);
                    if (s[i] == ',') { i++; continue; }
                    if (s[i++] == '}') return;
                    throw new FormatException();
                }
            }
            if (c == '[')
            {
                i++; Ws(s, ref i);
                if (s[i] == ']') { i++; return; }
                while (true)
                {
                    Value(s, ref i); Ws(s, ref i);
                    if (s[i] == ',') { i++; continue; }
                    if (s[i++] == ']') return;
                    throw new FormatException();
                }
            }
            if (c == '"') { Str(s, ref i); return; }
            while (i < s.Length && "-0123456789.eEtruefalsn+".IndexOf(s[i]) >= 0) i++;
        }

        static void Str(string s, ref int i)
        {
            if (s[i++] != '"') throw new FormatException();
            while (s[i] != '"') { if (s[i] == '\\') i++; i++; }
            i++;
        }
    }
}
