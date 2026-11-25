using System;
using System.Collections.Generic;
using UnityEngine;

namespace GamesSdk
{
    /// <summary>Calls made before a backend is up wait here, and run in order once it is. Dropped if it fails.</summary>
    internal sealed class ReadyQueue
    {
        private readonly List<Action> waiting = new List<Action>();
        private readonly int max;
        private readonly string what;

        public ReadyQueue(string what, int max)
        {
            this.what = what;
            this.max = max;
        }

        public bool IsReady { get; private set; }

        public bool IsFailed { get; private set; }

        public int Count => waiting.Count;

        public void Run(Action action)
        {
            if (action == null) return;

            if (IsReady) Safe(action);
            else if (!IsFailed && waiting.Count < max) waiting.Add(action);
        }

        public void Open(bool ok)
        {
            if (IsReady || IsFailed) return;

            IsReady = ok;
            IsFailed = !ok;
            var queued = waiting.ToArray();
            waiting.Clear();
            if (!ok) return;

            foreach (var action in queued) Safe(action);
        }

        public void Reset()
        {
            waiting.Clear();
            IsReady = false;
            IsFailed = false;
        }

        private void Safe(Action action)
        {
            try
            {
                action();
            }
            catch (Exception e)
            {
                // The SDK must never break the game.
                SdkLog.Warn($"{what}: {e.Message}");
            }
        }
    }

    /// <summary>Delayed calls (ad load retries, stand-in ads) on the main thread, driven by <see cref="GameSdkRunner"/>.</summary>
    internal static class SdkClock
    {
        private struct Due
        {
            public double At;
            public Action Action;
        }

        private static readonly List<Due> Pending = new List<Due>();

        /// <summary>Seconds since start, unaffected by Time.timeScale. Tests replace it.</summary>
        public static Func<double> Now = () => Time.realtimeSinceStartupAsDouble;

        /// <summary>The player's local day, for daily caps. Tests replace it.</summary>
        public static Func<string> Today = () => DateTime.Now.ToString("yyyy-MM-dd");

        public static void After(double seconds, Action action)
        {
            if (action == null) return;

            Pending.Add(new Due { At = Now() + Math.Max(0d, seconds), Action = action });
        }

        public static void Tick()
        {
            if (Pending.Count == 0) return;

            var now = Now();
            for (var i = 0; i < Pending.Count; i++)
            {
                if (Pending[i].At > now) continue;

                var action = Pending[i].Action;
                Pending.RemoveAt(i);
                i--;
                try
                {
                    action();
                }
                catch (Exception e)
                {
                    SdkLog.Warn(e.Message);
                }
            }
        }

        public static void Clear() => Pending.Clear();
    }

    /// <summary>
    /// Play time for interstitial pacing: lifetime (saved) and this session's. A session starts at launch and again
    /// after 30 minutes in the background, like Firebase's own session.
    /// </summary>
    internal static class PlayTime
    {
        private const string LifetimeKey = "games_sdk_play_seconds";
        private const double NewSessionAfter = 30 * 60;

        private static double lifetime = -1;
        private static double session;
        private static double pausedAt = -1;
        private static double unsaved;

        public static double Lifetime
        {
            get
            {
                if (lifetime < 0)
                {
                    double.TryParse(PlayerPrefs.GetString(LifetimeKey, "0"), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out lifetime);
                }

                return lifetime;
            }
        }

        public static double Session => session;

        public static void Add(double seconds)
        {
            if (seconds <= 0 || seconds > 5) return; // a hitch or a debugger pause is not play time

            var _ = Lifetime;
            lifetime += seconds;
            session += seconds;
            unsaved += seconds;
            if (unsaved >= 10) Save();
        }

        public static void Paused(double now)
        {
            pausedAt = now;
            Save();
        }

        public static void Resumed(double now)
        {
            if (pausedAt >= 0 && now - pausedAt >= NewSessionAfter) session = 0;
            pausedAt = -1;
        }

        public static void Save()
        {
            if (lifetime < 0) return;

            unsaved = 0;
            PlayerPrefs.SetString(LifetimeKey, lifetime.ToString("R", System.Globalization.CultureInfo.InvariantCulture));
        }

        internal static void ResetForTests(double lifetimeSeconds, double sessionSeconds)
        {
            lifetime = lifetimeSeconds;
            session = sessionSeconds;
            pausedAt = -1;
            unsaved = 0;
        }
    }

    /// <summary>Hidden object that drives the SDK's clock and play time. Made by <see cref="GameSdk.Init"/>.</summary>
    [AddComponentMenu("")]
    public sealed class GameSdkRunner : MonoBehaviour
    {
        internal static GameSdkRunner Instance;

        internal static void Ensure()
        {
            if (Instance != null) return;

            var go = new GameObject("GameSdk");
            go.hideFlags = HideFlags.HideInHierarchy;
            DontDestroyOnLoad(go);
            Instance = go.AddComponent<GameSdkRunner>();
        }

        private void Update()
        {
            PlayTime.Add(Time.unscaledDeltaTime);
            SdkClock.Tick();
        }

        private void OnApplicationPause(bool paused)
        {
            if (paused) PlayTime.Paused(SdkClock.Now());
            else PlayTime.Resumed(SdkClock.Now());
        }

        private void OnApplicationQuit() => PlayTime.Save();
    }
}
