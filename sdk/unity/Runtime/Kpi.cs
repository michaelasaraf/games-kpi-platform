using System;
using System.Collections.Generic;
using Firebase.Analytics;
using UnityEngine;

namespace GamesKpi
{
    /// <summary>
    /// Games KPI wrapper over Firebase Analytics.
    /// Call <see cref="Init"/> once Firebase is ready, then use the typed event methods
    /// generated from catalog/events.yaml (Kpi.LevelStart, Kpi.LevelEnd, Kpi.AdImpression, ...).
    /// </summary>
    public static partial class Kpi
    {
        public const string SdkVersion = "unity-0.2.0";

        /// <summary>Params the wrapper adds to every event (kpi_event_id, kpi_seq, kpi_sdk). Firebase keeps at most 25 per event.</summary>
        public const int EnvelopeParamCount = 3;

        const string SeqKey = "games_kpi_seq";
        const int MaxStringLength = 100;

        static bool _initialized;
        static bool _collectionEnabled = true;
        static long _seq;

        /// <summary>Prints every event to the Unity console. Handy while integrating.</summary>
        public static bool DebugLog { get; set; }

        /// <summary>True after <see cref="Init"/> has run.</summary>
        public static bool IsInitialized => _initialized;

        /// <summary>
        /// Call once, after FirebaseApp.CheckAndFixDependenciesAsync() reports Available.
        /// Pass the player's consent answers if the game asks for consent; otherwise keep the defaults.
        /// </summary>
        public static void Init(bool analyticsConsent = true, bool adsConsent = true)
        {
            long.TryParse(PlayerPrefs.GetString(SeqKey, "0"), out _seq);
            _initialized = true;
            SetConsent(analyticsConsent, adsConsent);
            StartInstallReferrer();
        }

        /// <summary>
        /// Like <see cref="Init"/>, for games that manage Firebase consent and collection themselves (for example
        /// through Google's UMP): the wrapper changes neither and sends events whenever the game calls it.
        /// </summary>
        public static void InitWithExistingConsent()
        {
            long.TryParse(PlayerPrefs.GetString(SeqKey, "0"), out _seq);
            _initialized = true;
            _collectionEnabled = true;
            StartInstallReferrer();
        }

        /// <summary>
        /// Sends any event with the envelope params added. For games that already have their own analytics layer:
        /// route its Firebase calls through here so every event can be deduplicated and counted. Pass at most
        /// 25 - <see cref="EnvelopeParamCount"/> params. Prefer the typed methods for catalog events.
        /// </summary>
        public static void LogCustom(string eventName, params Parameter[] parameters)
        {
            Log(eventName, new List<Parameter>(parameters ?? new Parameter[0]));
        }

        /// <summary>
        /// Updates consent. With analytics consent off, no KPI events are sent and Firebase
        /// analytics collection is disabled.
        /// </summary>
        public static void SetConsent(bool analytics, bool ads)
        {
            var analyticsStatus = analytics ? ConsentStatus.Granted : ConsentStatus.Denied;
            var adsStatus = ads ? ConsentStatus.Granted : ConsentStatus.Denied;
            FirebaseAnalytics.SetConsent(new Dictionary<ConsentType, ConsentStatus>
            {
                { ConsentType.AnalyticsStorage, analyticsStatus },
                { ConsentType.AdStorage, adsStatus },
                { ConsentType.AdUserData, adsStatus },
                { ConsentType.AdPersonalization, adsStatus },
            });
            FirebaseAnalytics.SetAnalyticsCollectionEnabled(analytics);
            _collectionEnabled = analytics;
        }

        static void Log(string eventName, List<Parameter> parameters)
        {
            if (!_initialized)
            {
                Debug.LogWarning($"[GamesKpi] {eventName} dropped: call Kpi.Init() after Firebase is ready.");
                return;
            }
            if (!_collectionEnabled) return;

            _seq++;
            PlayerPrefs.SetString(SeqKey, _seq.ToString());

            parameters.Add(new Parameter("kpi_event_id", Guid.NewGuid().ToString("N")));
            parameters.Add(new Parameter("kpi_seq", _seq));
            parameters.Add(new Parameter("kpi_sdk", SdkVersion));

            try
            {
                FirebaseAnalytics.LogEvent(eventName, parameters.ToArray());
                if (DebugLog) Debug.Log($"[GamesKpi] {eventName} seq={_seq}");
            }
            catch (Exception e)
            {
                // Analytics must never crash the game.
                Debug.LogWarning($"[GamesKpi] failed to log {eventName}: {e.Message}");
            }
        }

        static string Clip(string value)
        {
            if (value == null) return string.Empty;
            return value.Length <= MaxStringLength ? value : value.Substring(0, MaxStringLength);
        }
    }
}
