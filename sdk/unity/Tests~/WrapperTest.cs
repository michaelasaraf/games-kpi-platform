using System;
using System.Linq;
using Firebase.Analytics;
using GamesKpi;
using UnityEngine;

public static class WrapperTest
{
    static int failures;

    static void Check(bool ok, string what)
    {
        if (!ok) { failures++; Console.WriteLine("FAIL " + what); }
    }

    static Parameter P(string ev, string name)
    {
        var e = FirebaseAnalytics.Logged.Last(x => x.Key == ev);
        return e.Value.FirstOrDefault(p => p.Name == name);
    }

    public static int Main()
    {
        Kpi.LevelStart("w1_l01", 1);
        Check(FirebaseAnalytics.Logged.Count == 0, "events before Init are dropped");

        Kpi.Init();
        Kpi.LevelStart("w1_l01", 1, attempt: 2);
        Kpi.LevelEnd("w1_l01", 1, success: true, durationSec: 42);
        Kpi.AdImpression("applovin_max", "rewarded", 0.0123, "USD", adSource: "unity_ads");
        Kpi.IapPurchase("coins_small", 0.99, "EUR", "GPA.123");
        Kpi.EarnCurrency("coins", 50, "level_reward", balanceAfter: 150);
        Kpi.TutorialBegin();

        Check(FirebaseAnalytics.Logged.Count == 6, "six events logged");
        Check((long)P("level_end", "success").Value == 1L, "bool sent as 1");
        Check(P("level_end", "stars") == null, "unset optional params are omitted");
        Check((double)P("ad_impression", "value").Value == 0.0123, "ad revenue value");
        Check((string)P("iap_purchase", "currency").Value == "EUR", "currency param");
        Check((long)P("tutorial_begin", "kpi_seq").Value == 6L, "sequence increments per event");
        Check(((string)P("tutorial_begin", "kpi_event_id").Value).Length == 32, "event id is 32 hex chars");
        Check((string)P("tutorial_begin", "kpi_sdk").Value == Kpi.SdkVersion, "sdk version param");
        Check(FirebaseAnalytics.Logged.All(e => e.Value.Length <= 25), "at most 25 params");

        Kpi.LevelStart(new string('x', 150), 3);
        Check(((string)P("level_start", "level_name").Value).Length == 100, "strings clipped to 100");

        var meta = Kpi.ParseReferrer("utm_source=apps.facebook.com&utm_campaign=fb4a&utm_content=%7B%22app%22%3A1%7D");
        Check(meta.MediaSource == "apps.facebook.com" && meta.IsOrganic == false && meta.Campaign == "fb4a", "Meta referrer");
        var gads = Kpi.ParseReferrer("gclid=Cj0KCQ&utm_source=google&utm_medium=cpc");
        Check(gads.MediaSource == "google_ads" && gads.IsOrganic == false, "Google Ads click id wins");
        var organic = Kpi.ParseReferrer("utm_source=google-play&utm_medium=organic");
        Check(organic.MediaSource == "google-play" && organic.IsOrganic == true, "Play organic");
        var empty = Kpi.ParseReferrer("");
        Check(empty.MediaSource == "unknown" && empty.IsOrganic == null, "empty referrer is unknown");

        Kpi.ReportInstallReferrer("utm_source=google-play&utm_medium=organic");
        Check((string)P("install_attribution", "attribution_provider").Value == "play_referrer", "referrer sent as play_referrer");
        Check((long)P("install_attribution", "is_organic").Value == 1L, "organic flag sent");
        int sent = FirebaseAnalytics.Logged.Count(e => e.Key == "install_attribution");
        Kpi.ReportInstallReferrer("utm_source=google-play&utm_medium=organic");
        Check(FirebaseAnalytics.Logged.Count(e => e.Key == "install_attribution") == sent, "referrer sent once per install");
        Check(FirebaseAnalytics.Logged.Count(e => e.Key == "meta_install_referrer") == 0, "no Meta referrer for organic installs");

        // An install from before the Meta referrer existed: install_attribution is done, the Meta part is not.
        var metaJson = "{\"app\":1234,\"t\":1762900000,\"source\":{\"data\":\"" + new string('a', 900) + "\",\"nonce\":\"" + new string('b', 24) + "\"}}";
        PlayerPrefs.SetString("games_kpi_meta_referrer_done", "");
        Kpi.ReportInstallReferrer("utm_source=apps.facebook.com&utm_campaign=fb4a&utm_content=" + Uri.EscapeDataString(metaJson));
        Check(FirebaseAnalytics.Logged.Count(e => e.Key == "install_attribution") == sent, "no second install_attribution");
        Check(FirebaseAnalytics.Logged.Count(e => e.Key == "meta_install_referrer") == 1, "Meta referrer sent");
        var metaEvent = FirebaseAnalytics.Logged.Last(e => e.Key == "meta_install_referrer").Value;
        long parts = (long)metaEvent.First(x => x.Name == "parts").Value;
        Check(parts == (metaJson.Length + 99) / 100, "Meta referrer split into 100-character parts");
        var joined = string.Concat(metaEvent.Where(x => x.Name.StartsWith("p0") || x.Name.StartsWith("p1")).OrderBy(x => x.Name).Select(x => (string)x.Value));
        Check(joined == metaJson, "Meta referrer parts join back to the whole value");
        Check((string)metaEvent.First(x => x.Name == "origin").Value == "play", "Meta referrer origin");
        Check(metaEvent.Length <= 25, "Meta referrer within 25 params");
        Kpi.ReportInstallReferrer("utm_source=apps.facebook.com&utm_content=" + Uri.EscapeDataString(metaJson));
        Check(FirebaseAnalytics.Logged.Count(e => e.Key == "meta_install_referrer") == 1, "Meta referrer sent once per install");
        Check(Kpi.MetaReferrerContent("utm_source=apps.facebook.com&utm_content=%7B%22app%22%3A1%7D") == null, "no Meta data without source and nonce");

        Kpi.LogCustom("mine_enter", new Parameter("mine", 2L));
        Check((long)P("mine_enter", "mine").Value == 2L, "custom event keeps its params");
        Check(P("mine_enter", "kpi_event_id") != null, "custom event gets the envelope");

        Kpi.SetConsent(analytics: false, ads: false);
        int before = FirebaseAnalytics.Logged.Count;
        Kpi.LevelStart("w1_l02", 2);
        Check(FirebaseAnalytics.Logged.Count == before, "nothing sent without analytics consent");
        Check(!FirebaseAnalytics.CollectionEnabled, "Firebase collection disabled without consent");
        Check(FirebaseAnalytics.Consent[ConsentType.AdStorage] == ConsentStatus.Denied, "ad consent passed to Firebase");

        FirebaseAnalytics.Consent = null;
        Kpi.InitWithExistingConsent();
        Check(FirebaseAnalytics.Consent == null, "InitWithExistingConsent leaves Firebase consent alone");
        Kpi.LevelStart("w1_l03", 3);
        Check(P("level_start", "level_name") != null && (string)P("level_start", "level_name").Value == "w1_l03", "sends again after InitWithExistingConsent");

        Console.WriteLine(failures == 0 ? "Unity wrapper: all checks passed" : $"Unity wrapper: {failures} checks failed");
        return failures == 0 ? 0 : 1;
    }
}
