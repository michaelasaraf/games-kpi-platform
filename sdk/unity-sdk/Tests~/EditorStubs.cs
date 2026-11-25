// Stand-ins for the UnityEditor APIs the SDK's editor code uses: type-check only (see run.sh).
using System;
using System.Collections.Generic;

namespace UnityEditor
{
    public enum BuildTarget { Android = 13, iOS = 9, StandaloneWindows64 = 19 }
    [Flags] public enum BuildOptions { None = 0, Development = 1 }

    [AttributeUsage(AttributeTargets.Class)] public class InitializeOnLoadAttribute : Attribute { }
    [AttributeUsage(AttributeTargets.Method)] public class MenuItemAttribute : Attribute { public int priority; public MenuItemAttribute(string itemName) { } }

    public static class EditorApplication
    {
        public delegate void CallbackFunction();
        public static CallbackFunction delayCall;
        public static CallbackFunction update;
    }

    public static class AssetDatabase
    {
        public static T LoadAssetAtPath<T>(string path) where T : UnityEngine.Object { return null; }
        public static void CreateAsset(UnityEngine.Object asset, string path) { }
        public static void SaveAssets() { }
    }

    public static class Selection { public static UnityEngine.Object activeObject; }
    public static class EditorGUIUtility { public static void PingObject(UnityEngine.Object obj) { } }

    public static class EditorUtility
    {
        public static bool DisplayDialog(string title, string message, string ok, string cancel) { return true; }
        public static bool DisplayCancelableProgressBar(string title, string info, float progress) { return false; }
        public static void ClearProgressBar() { }
        public static void SetDirty(UnityEngine.Object target) { }
    }

    public static class EditorUserBuildSettings { public static BuildTarget activeBuildTarget; }

    public static class TypeCache
    {
        public static IList<Type> GetTypesDerivedFrom<T>() { return new List<Type>(); }
    }
}

namespace UnityEditor.PackageManager
{
    public static class Client { public static void Resolve() { } }
}

namespace UnityEditor.Build
{
    public interface IOrderedCallback { int callbackOrder { get; } }
    public interface IPreprocessBuildWithReport : IOrderedCallback { void OnPreprocessBuild(Reporting.BuildReport report); }
    public class BuildFailedException : Exception { public BuildFailedException(string message) : base(message) { } }
}

namespace UnityEditor.Build.Reporting
{
    public struct BuildSummary { public BuildTarget platform; public BuildOptions options; }
    public class BuildReport { public BuildSummary summary; }
}

namespace UnityEngine.Networking
{
    public class DownloadHandler { }
    public class DownloadHandlerFile : DownloadHandler { public bool removeFileOnAbort; public DownloadHandlerFile(string path) { } }

    public class UnityWebRequest : IDisposable
    {
        public const string kHttpVerbGET = "GET";
        public enum Result { InProgress, Success, ConnectionError, ProtocolError, DataProcessingError }
        public DownloadHandler downloadHandler;
        public bool isDone;
        public float downloadProgress;
        public Result result;
        public string error;
        public UnityWebRequest(string url, string method) { }
        public object SendWebRequest() { return null; }
        public void Abort() { }
        public void Dispose() { }
    }
}
