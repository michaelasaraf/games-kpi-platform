using System;
using System.Collections.Generic;
using Firebase.Analytics;
using UnityEngine;

namespace GamesKpi
{
    /// <summary>
    /// UA source from the Google Play install referrer (Android only). After <see cref="Kpi.Init"/>,
    /// the wrapper reads the referrer once per install and sends it as install_attribution with
    /// provider play_referrer. It sees Google Ads and Meta click-through installs; iOS installs and
    /// Meta view-through installs need an attribution SDK (call Kpi.InstallAttribution from it).
    /// For Meta installs it also sends Meta's encrypted campaign data (utm_content) whole, as the
    /// meta_install_referrer event in 100-character parts, so the KPI build can decrypt the campaign,
    /// ad set and ad that brought the player. Firebase drops that value from its own campaign event
    /// (it is far over 100 characters). Installs from before this version send it on their next launch,
    /// while Google Play still has their referrer (about 90 days).
    /// </summary>
    public static partial class Kpi
    {
        const string ReferrerDoneKey = "games_kpi_referrer_done";
        const string MetaReferrerDoneKey = "games_kpi_meta_referrer_done";
        /// <summary>Up to 20 parts of 100 characters: Meta's data is about 950, and Firebase allows 25 params.</summary>
        const int MetaReferrerMaxParts = 20;

        /// <summary>Set to false before Init to stop the wrapper reading the Play install referrer.</summary>
        public static bool AutoInstallReferrer { get; set; } = true;

        internal struct ReferrerInfo
        {
            public string MediaSource;
            public string Campaign;
            public bool? IsOrganic;
        }

        /// <summary>Reads utm_source, utm_medium, utm_campaign and the Google Ads click ids from a referrer string.</summary>
        internal static ReferrerInfo ParseReferrer(string referrer)
        {
            var q = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var part in (referrer ?? string.Empty).Split('&'))
            {
                if (part.Length == 0) continue;
                var eq = part.IndexOf('=');
                var key = eq < 0 ? part : part.Substring(0, eq);
                var raw = eq < 0 ? string.Empty : part.Substring(eq + 1).Replace('+', ' ');
                string value;
                try { value = Uri.UnescapeDataString(raw); } catch (Exception) { value = raw; }
                if (!q.ContainsKey(key)) q[key] = value;
            }

            var source = NonEmpty(q, "utm_source");
            var medium = NonEmpty(q, "utm_medium");
            var googleClick = NonEmpty(q, "gclid") != null || NonEmpty(q, "gbraid") != null || NonEmpty(q, "wbraid") != null;

            var info = new ReferrerInfo { Campaign = NonEmpty(q, "utm_campaign") };
            if (googleClick)
            {
                info.MediaSource = "google_ads";
                info.IsOrganic = false;
            }
            else if (source == null)
            {
                info.MediaSource = "unknown";
            }
            else
            {
                info.MediaSource = source;
                var organic = string.Equals(medium, "organic", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(source, "google-play", StringComparison.OrdinalIgnoreCase);
                info.IsOrganic = organic;
            }
            return info;
        }

        /// <summary>Meta's encrypted campaign data (the decoded utm_content JSON), or null when the referrer has none.</summary>
        internal static string MetaReferrerContent(string referrer)
        {
            foreach (var part in (referrer ?? string.Empty).Split('&'))
            {
                if (!part.StartsWith("utm_content=", StringComparison.OrdinalIgnoreCase)) continue;
                var raw = part.Substring("utm_content=".Length).Replace('+', ' ');
                string value;
                try { value = Uri.UnescapeDataString(raw); } catch (Exception) { value = raw; }
                return value.Contains("\"source\"") && value.Contains("\"nonce\"") ? value : null;
            }
            return null;
        }

        /// <summary>Sends Meta's encrypted campaign data in 100-character params p00, p01, ...</summary>
        internal static void SendMetaReferrer(string content, string origin)
        {
            var parts = Math.Min(MetaReferrerMaxParts, (content.Length + MaxStringLength - 1) / MaxStringLength);
            var p = new List<Parameter>(parts + 5);
            p.Add(new Parameter("origin", origin));
            p.Add(new Parameter("parts", (long)parts));
            for (var i = 0; i < parts; i++)
            {
                var start = i * MaxStringLength;
                p.Add(new Parameter($"p{i:00}", content.Substring(start, Math.Min(MaxStringLength, content.Length - start))));
            }
            Log("meta_install_referrer", p);
        }

        static bool Done(string key) => PlayerPrefs.GetString(key, "") == "1";

        static string NonEmpty(Dictionary<string, string> q, string key)
        {
            string v;
            return q.TryGetValue(key, out v) && v.Length > 0 ? v : null;
        }

        /// <summary>Sends the referrer once per install. Runs on the main thread.</summary>
        internal static void ReportInstallReferrer(string referrer)
        {
            if (Done(ReferrerDoneKey) && Done(MetaReferrerDoneKey)) return;
            if (!_collectionEnabled) return; // try again on a later launch, once consent allows it
            if (!Done(ReferrerDoneKey))
            {
                if (!string.IsNullOrEmpty(referrer))
                {
                    var info = ParseReferrer(referrer);
                    InstallAttribution("play_referrer", info.MediaSource, campaign: info.Campaign, isOrganic: info.IsOrganic, referrer: referrer);
                }
                PlayerPrefs.SetString(ReferrerDoneKey, "1");
            }
            if (!Done(MetaReferrerDoneKey))
            {
                var meta = MetaReferrerContent(referrer);
                if (meta != null) SendMetaReferrer(meta, "play");
                PlayerPrefs.SetString(MetaReferrerDoneKey, "1");
            }
        }

        static void StartInstallReferrer()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            if (!AutoInstallReferrer || (Done(ReferrerDoneKey) && Done(MetaReferrerDoneKey))) return;
            try
            {
                KpiMainThread.Ensure();
                using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
                using (var activity = player.GetStatic<AndroidJavaObject>("currentActivity"))
                using (var builderClass = new AndroidJavaClass("com.android.installreferrer.api.InstallReferrerClient"))
                using (var builder = builderClass.CallStatic<AndroidJavaObject>("newBuilder", activity))
                {
                    var client = builder.Call<AndroidJavaObject>("build");
                    client.Call("startConnection", new ReferrerListener(client));
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[GamesKpi] install referrer unavailable: {e.Message}");
            }
#endif
        }

#if UNITY_ANDROID && !UNITY_EDITOR
        sealed class ReferrerListener : AndroidJavaProxy
        {
            readonly AndroidJavaObject _client;

            public ReferrerListener(AndroidJavaObject client)
                : base("com.android.installreferrer.api.InstallReferrerStateListener")
            {
                _client = client;
            }

            // Called on a background thread by the Play Store service.
            void onInstallReferrerSetupFinished(int responseCode)
            {
                string referrer = null;
                try
                {
                    const int Ok = 0;
                    if (responseCode == Ok)
                    {
                        using (var details = _client.Call<AndroidJavaObject>("getInstallReferrer"))
                        {
                            referrer = details.Call<string>("getInstallReferrer");
                        }
                    }
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"[GamesKpi] install referrer failed: {e.Message}");
                }
                finally
                {
                    try { _client.Call("endConnection"); } catch (Exception) { }
                }
                // FEATURE_NOT_SUPPORTED (2) or SERVICE_UNAVAILABLE (1): nothing to report this launch.
                if (responseCode == 0) KpiMainThread.Post(() => ReportInstallReferrer(referrer ?? string.Empty));
            }

            void onInstallReferrerServiceDisconnected() { }
        }
#endif
    }

    /// <summary>Runs callbacks from Android threads on Unity's main thread.</summary>
    internal sealed class KpiMainThread : MonoBehaviour
    {
        static readonly Queue<Action> Pending = new Queue<Action>();
        static KpiMainThread _instance;

        internal static void Ensure()
        {
            if (_instance != null) return;
            var go = new GameObject("GamesKpi");
            DontDestroyOnLoad(go);
            go.hideFlags = HideFlags.HideAndDontSave;
            _instance = go.AddComponent<KpiMainThread>();
        }

        internal static void Post(Action action)
        {
            lock (Pending) Pending.Enqueue(action);
        }

        void Update()
        {
            while (true)
            {
                Action next;
                lock (Pending)
                {
                    if (Pending.Count == 0) return;
                    next = Pending.Dequeue();
                }
                try { next(); } catch (Exception e) { Debug.LogWarning($"[GamesKpi] {e.Message}"); }
            }
        }
    }
}
