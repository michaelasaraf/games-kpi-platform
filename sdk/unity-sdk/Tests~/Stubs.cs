// Minimal stand-ins for the Unity, Firebase and Google Mobile Ads APIs the SDK uses, so it can be compiled and
// exercised outside Unity (see run.sh). Signatures mirror the real SDKs as of Unity 6, Firebase 14 and GMA 11; they
// prove our own code is consistent, not that the real SDKs match (only a Unity build proves that).
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace UnityEngine
{
    public enum HideFlags { None = 0, HideInHierarchy = 1, HideAndDontSave = 61 }
    public enum RuntimePlatform { Android = 11, IPhonePlayer = 8, WindowsEditor = 7 }
    public enum RuntimeInitializeLoadType { AfterSceneLoad, BeforeSceneLoad }

    [AttributeUsage(AttributeTargets.Method)] public class RuntimeInitializeOnLoadMethodAttribute : Attribute { public RuntimeInitializeOnLoadMethodAttribute(RuntimeInitializeLoadType t) { } }
    [AttributeUsage(AttributeTargets.Class)] public class CreateAssetMenuAttribute : Attribute { public string menuName; public string fileName; }
    [AttributeUsage(AttributeTargets.Class)] public class AddComponentMenuAttribute : Attribute { public AddComponentMenuAttribute(string m) { } }
    [AttributeUsage(AttributeTargets.Field)] public class HeaderAttribute : Attribute { public HeaderAttribute(string h) { } }
    [AttributeUsage(AttributeTargets.Field)] public class TooltipAttribute : Attribute { public TooltipAttribute(string t) { } }

    public class Object
    {
        public HideFlags hideFlags;
        public static void DontDestroyOnLoad(Object target) { }
    }

    public class ScriptableObject : Object
    {
        public static T CreateInstance<T>() where T : ScriptableObject, new() { return new T(); }
    }

    public class Component : Object { }
    public class Behaviour : Component { }
    public class MonoBehaviour : Behaviour { }

    public class GameObject : Object
    {
        public GameObject(string name) { }
        public T AddComponent<T>() where T : Component, new() { return new T(); }
    }

    public static class Application
    {
        public static RuntimePlatform platform = RuntimePlatform.Android;
        public static string version = "1.0";
        public static bool isEditor;
        public static string dataPath = "/tmp/project/Assets";
    }

    public static class Time
    {
        public static double realtimeSinceStartupAsDouble;
        public static float unscaledDeltaTime;
    }

    public static class Resources
    {
        public static T Load<T>(string path) where T : Object { return null; }
    }

    public static class PlayerPrefs
    {
        static readonly Dictionary<string, string> Store = new Dictionary<string, string>();
        public static string GetString(string key, string defaultValue) { return Store.TryGetValue(key, out var v) ? v : defaultValue; }
        public static void SetString(string key, string value) { Store[key] = value; }
        public static int GetInt(string key, int defaultValue) { return Store.TryGetValue(key, out var v) ? int.Parse(v) : defaultValue; }
        public static void SetInt(string key, int value) { Store[key] = value.ToString(); }
        public static void Clear() { Store.Clear(); }
    }

    public static class Debug
    {
        public static bool isDebugBuild = true;
        public static readonly List<string> Lines = new List<string>();
        public static void Log(object message) { Lines.Add(message.ToString()); }
        public static void LogWarning(object message) { Lines.Add("WARN " + message); }
        public static void LogError(object message) { Lines.Add("ERROR " + message); }
    }

    public class AndroidJavaObject : IDisposable
    {
        public AndroidJavaObject(string className, params object[] args) { }
        public void Call(string method, params object[] args) { }
        public T Call<T>(string method, params object[] args) { return default(T); }
        public T CallStatic<T>(string method, params object[] args) { return default(T); }
        public T GetStatic<T>(string field) { return default(T); }
        public void Dispose() { }
    }

    public class AndroidJavaClass : AndroidJavaObject { public AndroidJavaClass(string className) : base(className) { } }
    public class AndroidJavaProxy { public AndroidJavaProxy(string javaInterface) { } }
}

namespace Firebase
{
    public enum DependencyStatus { Available, UnavailableOther }

    public class FirebaseApp
    {
        public static DependencyStatus Status = DependencyStatus.Available;
        public static FirebaseApp DefaultInstance => Status == DependencyStatus.Available ? new FirebaseApp() : null;
        public static Task<DependencyStatus> CheckAndFixDependenciesAsync() { return Task.FromResult(Status); }
    }
}

namespace Firebase.Extensions
{
    public static class TaskExtension
    {
        // The real one runs the continuation on Unity's main thread; here the task is already done, so run it now.
        public static Task ContinueWithOnMainThread<T>(this Task<T> task, Action<Task<T>> continuation) { continuation(task); return Task.CompletedTask; }
    }
}

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
        public static readonly Dictionary<string, string> UserProperties = new Dictionary<string, string>();
        public static string UserId;
        public static bool CollectionEnabled = true;
        public static IDictionary<ConsentType, ConsentStatus> Consent;
        public static void LogEvent(string name, params Parameter[] parameters) { Logged.Add(new KeyValuePair<string, Parameter[]>(name, parameters)); }
        public static void SetUserProperty(string name, string property) { UserProperties[name] = property; }
        public static void SetUserId(string userId) { UserId = userId; }
        public static void SetAnalyticsCollectionEnabled(bool enabled) { CollectionEnabled = enabled; }
        public static void SetConsent(IDictionary<ConsentType, ConsentStatus> consentSettings) { Consent = consentSettings; }
    }
}

namespace Firebase.Crashlytics
{
    public static class Crashlytics
    {
        public static readonly List<string> Logs = new List<string>();
        public static readonly Dictionary<string, string> Keys = new Dictionary<string, string>();
        public static readonly List<Exception> Exceptions = new List<Exception>();
        public static string UserId;
        public static bool ReportUncaughtExceptionsAsFatal { get; set; }
        public static void Log(string message) { Logs.Add(message); }
        public static void SetCustomKey(string key, string value) { Keys[key] = value; }
        public static void SetUserId(string identifier) { UserId = identifier; }
        public static void LogException(Exception exception) { Exceptions.Add(exception); }
    }
}

namespace GoogleMobileAds.Common
{
    public static class MobileAdsEventExecutor
    {
        public static void Initialize() { }
        public static void ExecuteInUpdate(Action action) { action(); }
    }
}

namespace GoogleMobileAds.Api
{
    public class AdRequest { }
    public class Reward { public string Type; public double Amount; }
    public class AdError { public string GetMessage() { return "ad error"; } }
    public class LoadAdError : AdError { }
    public class AdInspectorError : AdError { }
    public class RequestConfiguration { public List<string> TestDeviceIds { get; set; } }
    public enum AdapterState { NotReady, Ready }
    public class AdapterStatus { public AdapterState InitializationState { get; set; } public string Description { get; set; } public int Latency { get; set; } }

    public class InitializationStatus
    {
        public Dictionary<string, AdapterStatus> Map = new Dictionary<string, AdapterStatus>();
        public Dictionary<string, AdapterStatus> getAdapterStatusMap() { return Map; }
    }

    public static class MobileAds
    {
        public static RequestConfiguration Configuration;
        public static InitializationStatus Status = new InitializationStatus();
        public static void SetRequestConfiguration(RequestConfiguration requestConfiguration) { Configuration = requestConfiguration; }
        public static void Initialize(Action<InitializationStatus> initCompleteAction) { initCompleteAction(Status); }
        public static int InspectorOpened;
        public static void OpenAdInspector(Action<AdInspectorError> onAdInspectorClosed) { InspectorOpened++; onAdInspectorClosed(null); }
    }

    public class AdValue
    {
        public enum PrecisionType { Unknown = 0, Estimated = 1, PublisherProvided = 2, Precise = 3 }
        public PrecisionType Precision { get; set; }
        public long Value { get; set; }
        public string CurrencyCode { get; set; }
    }

    public class AdapterResponseInfo { public string AdSourceName { get; set; } }
    public class ResponseInfo
    {
        public string Source;
        public AdapterResponseInfo GetLoadedAdapterResponseInfo() { return new AdapterResponseInfo { AdSourceName = Source }; }
    }

    public abstract class FullScreenAd
    {
        public static bool NextLoadFails;
        public static AdValue NextValue = new AdValue { Value = 12500, CurrencyCode = "USD", Precision = AdValue.PrecisionType.Precise };
        public static string NextSource = "Unity Ads";
        public event Action<AdValue> OnAdPaid;
        public event Action OnAdImpressionRecorded;
        public event Action OnAdFullScreenContentClosed;
#pragma warning disable 67
        public event Action<AdError> OnAdFullScreenContentFailed;
#pragma warning restore 67
        public bool Destroyed;
        public bool CanShowAd() { return !Destroyed; }
        public void Destroy() { Destroyed = true; }
        public ResponseInfo GetResponseInfo() { return new ResponseInfo { Source = NextSource }; }

        protected void Play(Action reward)
        {
            OnAdImpressionRecorded?.Invoke();
            if (NextValue != null) OnAdPaid?.Invoke(NextValue);
            reward?.Invoke();
            OnAdFullScreenContentClosed?.Invoke();
        }
    }

    public class RewardedAd : FullScreenAd
    {
        public static int Loads;
        public static void Load(string adUnitId, AdRequest request, Action<RewardedAd, LoadAdError> adLoadCallback)
        {
            Loads++;
            if (NextLoadFails) adLoadCallback(null, new LoadAdError());
            else adLoadCallback(new RewardedAd(), null);
        }

        public void Show(Action<Reward> userRewardEarnedCallback) { Play(() => userRewardEarnedCallback(new Reward())); }
    }

    public class InterstitialAd : FullScreenAd
    {
        public static void Load(string adUnitId, AdRequest request, Action<InterstitialAd, LoadAdError> adLoadCallback)
        {
            if (NextLoadFails) adLoadCallback(null, new LoadAdError());
            else adLoadCallback(new InterstitialAd(), null);
        }

        public void Show() { Play(null); }
    }
}

namespace GoogleMobileAds.Ump.Api
{
    public class FormError { public string Message { get; set; } }
    public class ConsentRequestParameters { }
    public enum ConsentStatus { Unknown, NotRequired, Required, Obtained }
    public enum PrivacyOptionsRequirementStatus { Unknown, NotRequired, Required }

    public static class ConsentInformation
    {
        public static bool CanRequest = true;
        public static ConsentStatus ConsentStatus = ConsentStatus.NotRequired;
        public static PrivacyOptionsRequirementStatus PrivacyOptionsRequirementStatus = PrivacyOptionsRequirementStatus.NotRequired;
        public static void Update(ConsentRequestParameters request, Action<FormError> consentInfoUpdateCallback) { consentInfoUpdateCallback(null); }
        public static bool CanRequestAds() { return CanRequest; }
    }

    public static class ConsentForm
    {
        public static void LoadAndShowConsentFormIfRequired(Action<FormError> onDismissed) { onDismissed(null); }
        public static void ShowPrivacyOptionsForm(Action<FormError> onDismissed) { onDismissed(null); }
    }
}
