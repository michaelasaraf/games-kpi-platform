using System;
using System.Collections.Generic;
using System.Text;
using UnityEngine;

namespace GamesSdk
{
    /// <summary>
    /// Game analytics (<see cref="GameSdk.Analytics"/>). On phones with Firebase installed every event goes out
    /// through the Games KPI wrapper (Kpi.LogCustom), which adds kpi_event_id, kpi_seq and kpi_sdk so the KPI
    /// dashboard can deduplicate and count it, and reads the install referrer once per install. Events sent before
    /// Firebase is up wait in a queue. Names and values are cleaned to Firebase's rules first.
    ///
    /// Use the KPI catalog's event and param names (docs/event-catalog.md) where one fits, so the dashboard reads
    /// them without per-game mapping: level_start/level_end with level_number, tutorial_step with step,
    /// spend_virtual_currency with sink, and so on.
    /// </summary>
    public sealed class AnalyticsService
    {
        private const int QueueMax = 300;

        private readonly ReadyQueue queue = new ReadyQueue("Analytics", QueueMax);
        private IAnalyticsBackend backend;
        private bool echo;
        private bool breadcrumbs;

        /// <summary>Backend name for logs and debug screens (Firebase, Log).</summary>
        public string BackendName => backend?.Name ?? "none";

        /// <summary>True once events reach the backend (Firebase is up).</summary>
        public bool IsReady => queue.IsReady;

        /// <summary>The last events sent, newest last, for a debug screen.</summary>
        public IReadOnlyList<string> Recent => recent;

        private readonly List<string> recent = new List<string>();

        internal void Start(GameSdkConfig config, IAnalyticsBackend chosen)
        {
            backend = chosen;
            echo = config.logEventsInDevelopmentBuilds && Debug.isDebugBuild && !(chosen is LogAnalyticsBackend);
            breadcrumbs = config.eventsAsCrashBreadcrumbs;
            if (!config.analyticsEnabled)
            {
                queue.Open(false);
                SdkLog.Info("Analytics is off in GameSdkConfig.");
                return;
            }

            backend.Start(config, ok =>
            {
                if (!ok) SdkLog.Warn($"Analytics ({backend.Name}) could not start; events are dropped this session.");
                queue.Open(ok);
            });

            SetUserProperty("app_version", Application.version);
            SetUserProperty("build", Debug.isDebugBuild ? "dev" : "release");
            if (!string.IsNullOrEmpty(config.gameId)) SetUserProperty("sdk_game", config.gameId);
        }

        public void Log(string eventName) => Log(eventName, (IDictionary<string, object>)null);

        public void Log(string eventName, string key, object value) =>
            Log(eventName, new Dictionary<string, object> { { key, value } });

        public void Log(string eventName, string key1, object value1, string key2, object value2) =>
            Log(eventName, new Dictionary<string, object> { { key1, value1 }, { key2, value2 } });

        /// <summary>
        /// Sends one event. Values may be bool (sent as 1/0), any whole number, float/double, or text (cut to 100
        /// characters). At most 22 params; null values are left out.
        /// </summary>
        public void Log(string eventName, IDictionary<string, object> parameters)
        {
            var name = SdkNames.Event(eventName);
            if (name == null) return;

            var clean = Clean(parameters);
            Remember(name, clean);
            if (echo) SdkLog.Info(Describe(name, clean));
            if (breadcrumbs) GameSdk.Crash.Log(name);

            queue.Run(() => backend.Log(name, clean));
        }

        public void SetUserProperty(string name, string value)
        {
            var cleanName = SdkNames.UserProperty(name);
            if (cleanName == null) return;

            var cleanValue = SdkNames.UserPropertyValue(value);
            GameSdk.Crash.SetKey(cleanName, cleanValue);
            queue.Run(() => backend.SetUserProperty(cleanName, cleanValue));
        }

        /// <summary>Your own player id (never personal data). Also set on Crashlytics.</summary>
        public void SetUserId(string userId)
        {
            GameSdk.Crash.SetUserId(userId);
            queue.Run(() => backend.SetUserId(userId));
        }

        /// <summary>Firebase consent mode, for games that ask the player themselves. Games relying on Google's UMP form can skip it.</summary>
        public void SetConsent(bool analytics, bool ads) => queue.Run(() => backend.SetConsent(analytics, ads));

        /// <summary>
        /// Runs <paramref name="action"/> once analytics is up: for calling the wrapper's typed catalog methods
        /// directly, e.g. <c>GameSdk.Analytics.WhenReady(() => Kpi.LevelEnd("mine_2", 2, success: true));</c>.
        /// </summary>
        public void WhenReady(Action action) => queue.Run(action);

        internal void ResetForTests()
        {
            queue.Reset();
            recent.Clear();
            backend = null;
        }

        private static List<KeyValuePair<string, object>> Clean(IDictionary<string, object> parameters)
        {
            var list = new List<KeyValuePair<string, object>>(parameters?.Count ?? 0);
            if (parameters == null) return list;

            foreach (var pair in parameters)
            {
                if (list.Count >= SdkNames.GameParamsMax)
                {
                    SdkLog.Warn($"More than {SdkNames.GameParamsMax} params; {pair.Key} and the rest are left out.");
                    break;
                }

                var key = SdkNames.Param(pair.Key);
                if (key == null || pair.Value == null) continue;

                list.Add(new KeyValuePair<string, object>(key, CleanValue(pair.Value)));
            }

            return list;
        }

        /// <summary>Firebase takes long, double and string.</summary>
        internal static object CleanValue(object value)
        {
            if (value is bool) return (bool)value ? 1L : 0L;
            if (value is int) return (long)(int)value;
            if (value is long) return value;
            if (value is short) return (long)(short)value;
            if (value is byte) return (long)(byte)value;
            if (value is uint) return (long)(uint)value;
            if (value is float) return (double)(float)value;
            if (value is double) return value;
            if (value is decimal) return (double)(decimal)value;
            if (value is Enum) return SdkNames.ParamValue(SdkNames.SnakeCase(value.ToString()));
            return SdkNames.ParamValue(Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture));
        }

        private void Remember(string name, List<KeyValuePair<string, object>> parameters)
        {
            recent.Add(Describe(name, parameters));
            if (recent.Count > 30) recent.RemoveAt(0);
        }

        private static string Describe(string name, List<KeyValuePair<string, object>> parameters)
        {
            var text = new StringBuilder("event ").Append(name);
            foreach (var pair in parameters) text.Append(' ').Append(pair.Key).Append('=').Append(pair.Value);
            return text.ToString();
        }
    }

    /// <summary>Editor, web and phones without Firebase: events only go to the log.</summary>
    public sealed class LogAnalyticsBackend : IAnalyticsBackend
    {
        private bool print;

        public string Name => "Log";

        public void Start(GameSdkConfig config, Action<bool> ready)
        {
            print = config.logEventsInDevelopmentBuilds;
            ready(true);
        }

        public void Log(string eventName, IReadOnlyList<KeyValuePair<string, object>> parameters)
        {
            if (!print) return;

            var text = new StringBuilder("event ").Append(eventName);
            foreach (var pair in parameters) text.Append(' ').Append(pair.Key).Append('=').Append(pair.Value);
            SdkLog.Info(text.ToString());
        }

        public void SetUserProperty(string name, string value)
        {
            if (print) SdkLog.Info($"user property {name}={value}");
        }

        public void SetUserId(string userId)
        {
        }

        public void SetConsent(bool analytics, bool ads)
        {
        }
    }

    /// <summary>
    /// Crash reporting (<see cref="GameSdk.Crash"/>). With Crashlytics installed, crashes and uncaught exceptions
    /// are reported on their own; this adds breadcrumbs, keys and caught exceptions to those reports.
    /// </summary>
    public sealed class CrashService
    {
        private readonly ReadyQueue queue = new ReadyQueue("Crashlytics", 100);
        private ICrashBackend backend;

        public string BackendName => backend?.Name ?? "none";

        public bool IsReady => queue.IsReady;

        internal void Start(GameSdkConfig config, ICrashBackend chosen)
        {
            backend = chosen;
            if (backend == null)
            {
                queue.Open(false);
                return;
            }

            backend.Start(config, ok =>
            {
                if (!ok) SdkLog.Warn($"Crash reporting ({backend.Name}) could not start.");
                queue.Open(ok);
            });
        }

        /// <summary>A breadcrumb shown with the next crash report.</summary>
        public void Log(string message) => queue.Run(() => backend.Log(message));

        /// <summary>A key shown with every later crash report (the current level, the build flavour...).</summary>
        public void SetKey(string key, string value) => queue.Run(() => backend.SetKey(key, value ?? string.Empty));

        public void SetUserId(string userId) => queue.Run(() => backend.SetUserId(userId ?? string.Empty));

        /// <summary>Reports a caught exception as a non-fatal issue.</summary>
        public void RecordException(Exception exception)
        {
            if (exception == null) return;

            queue.Run(() => backend.RecordException(exception));
        }

        internal void ResetForTests()
        {
            queue.Reset();
            backend = null;
        }
    }
}
