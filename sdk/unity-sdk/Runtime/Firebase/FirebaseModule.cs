using System;
using System.Collections.Generic;
using Firebase;
using Firebase.Analytics;
using Firebase.Extensions;
using GamesKpi;
using UnityEngine;
#if GAMES_SDK_CRASHLYTICS
using Firebase.Crashlytics;
#endif

namespace GamesSdk.FirebaseSupport
{
    /// <summary>
    /// Registers the Firebase backends. This assembly compiles only on Android and iOS, and only once
    /// com.google.firebase.analytics is installed (GAMES_SDK_FIREBASE); Crashlytics parts need
    /// com.google.firebase.crashlytics (GAMES_SDK_CRASHLYTICS). The Firebase project comes from
    /// Assets/google-services.json (Android) and Assets/GoogleService-Info.plist (iOS).
    /// </summary>
    internal static class FirebaseModule
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Register()
        {
            // The editor keeps the log backend: Firebase's desktop stand-in needs its own setup.
            if (Application.isEditor) return;

            GameSdkModules.Analytics = () => new FirebaseAnalyticsBackend();
#if GAMES_SDK_CRASHLYTICS
            GameSdkModules.Crash = () => new CrashlyticsBackend();
#endif
        }
    }

    /// <summary>
    /// Starts Firebase once for everything in the game that uses it (analytics, Crashlytics, and the game's own
    /// Remote Config, Auth, ...). Firebase first checks Google Play services on the phone, which must run only once;
    /// everyone waits here and hears on the main thread whether Firebase is up. Games that use more of Firebase
    /// call <see cref="WhenReady"/> too, instead of their own CheckAndFixDependenciesAsync.
    /// </summary>
    public static class FirebaseStartup
    {
        private static readonly List<Action<bool>> Waiting = new List<Action<bool>>();
        private static bool started;
        private static bool done;
        private static bool ready;

        /// <summary>Runs just before the default app is created: set App Check's provider factory here.</summary>
        public static Action BeforeDefaultApp { get; set; }

        public static bool IsReady => ready;

        public static void WhenReady(Action<bool> callback)
        {
            if (callback == null) return;

            if (done)
            {
                Call(callback);
                return;
            }

            Waiting.Add(callback);
            if (started) return;

            started = true;
            FirebaseApp.CheckAndFixDependenciesAsync().ContinueWithOnMainThread(task =>
            {
                var status = task.IsCompleted && !task.IsFaulted && !task.IsCanceled ? task.Result : DependencyStatus.UnavailableOther;
                if (status != DependencyStatus.Available)
                {
                    Debug.LogWarning($"[GameSdk] Firebase could not start ({status}).");
                }
                else
                {
                    try
                    {
                        BeforeDefaultApp?.Invoke();
                        // Creating the default app also starts Crashlytics.
                        ready = FirebaseApp.DefaultInstance != null;
                    }
                    catch (Exception e)
                    {
                        Debug.LogWarning($"[GameSdk] Firebase did not start: {e.Message}");
                    }
                }

                done = true;
                var callbacks = Waiting.ToArray();
                Waiting.Clear();
                foreach (var each in callbacks) Call(each);
            });
        }

        private static void Call(Action<bool> callback)
        {
            try
            {
                callback(ready);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[GameSdk] {e.Message}");
            }
        }
    }

    /// <summary>
    /// Firebase Analytics through the Games KPI wrapper: Kpi.LogCustom adds the envelope params (kpi_event_id, kpi_seq,
    /// kpi_sdk) and the wrapper reads the Play install referrer once per install (install_attribution and, for Meta
    /// installs, meta_install_referrer). Firebase consent stays as Google's UMP / the game set it.
    /// </summary>
    public sealed class FirebaseAnalyticsBackend : IAnalyticsBackend
    {
        public string Name => "Firebase";

        public void Start(GameSdkConfig config, Action<bool> ready)
        {
            FirebaseStartup.WhenReady(up =>
            {
                if (!up)
                {
                    ready(false);
                    return;
                }

                try
                {
                    FirebaseAnalytics.SetAnalyticsCollectionEnabled(true);
                    Kpi.InitWithExistingConsent();
                    ready(true);
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"[GameSdk] Firebase Analytics did not start: {e.Message}");
                    ready(false);
                }
            });
        }

        public void Log(string eventName, IReadOnlyList<KeyValuePair<string, object>> parameters)
        {
            var list = new Parameter[parameters.Count];
            for (var i = 0; i < parameters.Count; i++)
            {
                var pair = parameters[i];
                if (pair.Value is long) list[i] = new Parameter(pair.Key, (long)pair.Value);
                else if (pair.Value is double) list[i] = new Parameter(pair.Key, (double)pair.Value);
                else list[i] = new Parameter(pair.Key, pair.Value as string ?? string.Empty);
            }

            Kpi.LogCustom(eventName, list);
        }

        public void SetUserProperty(string name, string value) => FirebaseAnalytics.SetUserProperty(name, value);

        public void SetUserId(string userId) => FirebaseAnalytics.SetUserId(userId);

        public void SetConsent(bool analytics, bool ads) => Kpi.SetConsent(analytics, ads);
    }

#if GAMES_SDK_CRASHLYTICS
    /// <summary>
    /// Crashlytics. It reports native crashes, ANRs and uncaught C# exceptions on its own once the Firebase app
    /// exists; this adds breadcrumbs, keys, the user id and caught exceptions.
    /// </summary>
    public sealed class CrashlyticsBackend : ICrashBackend
    {
        public string Name => "Crashlytics";

        public void Start(GameSdkConfig config, Action<bool> ready)
        {
            FirebaseStartup.WhenReady(up =>
            {
                if (up)
                {
                    try
                    {
                        Crashlytics.ReportUncaughtExceptionsAsFatal = config.uncaughtExceptionsAsFatal;
                    }
                    catch (Exception e)
                    {
                        Debug.LogWarning($"[GameSdk] Crashlytics setting: {e.Message}");
                    }
                }

                ready(up);
            });
        }

        public void Log(string message) => Crashlytics.Log(message);

        public void SetKey(string key, string value) => Crashlytics.SetCustomKey(key, value);

        public void SetUserId(string userId) => Crashlytics.SetUserId(userId);

        public void RecordException(Exception exception) => Crashlytics.LogException(exception);
    }
#endif
}
