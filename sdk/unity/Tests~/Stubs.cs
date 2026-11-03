// Minimal stand-ins for the Firebase and Unity APIs the wrapper uses, so the wrapper can be
// compiled and exercised outside Unity (see run.sh). Signatures mirror the real SDKs.
using System;
using System.Collections.Generic;

namespace Firebase.Analytics
{
    public class Parameter
    {
        public readonly string Name;
        public readonly object Value;
        public Parameter(string parameterName, string parameterValue) { Name = parameterName; Value = parameterValue; }
        public Parameter(string parameterName, long parameterValue) { Name = parameterName; Value = parameterValue; }
        public Parameter(string parameterName, double parameterValue) { Name = parameterName; Value = parameterValue; }
    }

    public enum ConsentType { AdStorage, AnalyticsStorage, AdUserData, AdPersonalization }
    public enum ConsentStatus { Granted, Denied }

    public static class FirebaseAnalytics
    {
        public static readonly List<KeyValuePair<string, Parameter[]>> Logged = new List<KeyValuePair<string, Parameter[]>>();
        public static bool CollectionEnabled = true;
        public static IDictionary<ConsentType, ConsentStatus> Consent;
        public static void LogEvent(string name, params Parameter[] parameters) { Logged.Add(new KeyValuePair<string, Parameter[]>(name, parameters)); }
        public static void SetAnalyticsCollectionEnabled(bool enabled) { CollectionEnabled = enabled; }
        public static void SetConsent(IDictionary<ConsentType, ConsentStatus> consentSettings) { Consent = consentSettings; }
    }
}

namespace UnityEngine
{
    public static class PlayerPrefs
    {
        static readonly Dictionary<string, string> Store = new Dictionary<string, string>();
        public static string GetString(string key, string defaultValue) { return Store.TryGetValue(key, out var v) ? v : defaultValue; }
        public static void SetString(string key, string value) { Store[key] = value; }
    }

    public static class Debug
    {
        public static void Log(object message) { Console.WriteLine(message); }
        public static void LogWarning(object message) { Console.WriteLine("WARN " + message); }
    }
}
