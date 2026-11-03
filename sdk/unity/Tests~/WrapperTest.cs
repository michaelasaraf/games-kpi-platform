using System;
using System.Linq;
using Firebase.Analytics;
using GamesKpi;

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

        Kpi.SetConsent(analytics: false, ads: false);
        int before = FirebaseAnalytics.Logged.Count;
        Kpi.LevelStart("w1_l02", 2);
        Check(FirebaseAnalytics.Logged.Count == before, "nothing sent without analytics consent");
        Check(!FirebaseAnalytics.CollectionEnabled, "Firebase collection disabled without consent");
        Check(FirebaseAnalytics.Consent[ConsentType.AdStorage] == ConsentStatus.Denied, "ad consent passed to Firebase");

        Console.WriteLine(failures == 0 ? "Unity wrapper: all checks passed" : $"Unity wrapper: {failures} checks failed");
        return failures == 0 ? 0 : 1;
    }
}
