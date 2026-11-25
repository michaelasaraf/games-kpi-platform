using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;
using UnityEngine.Networking;

namespace GamesSdk.Editor
{
    /// <summary>
    /// The versions every game installs together. Change them here (and in docs/games-sdk.md), release a new SDK tag,
    /// and each game gets the same tested set with Tools > Games SDK > Install Dependencies.
    /// The set is Gem Mine's, which is live on Google Play since 2026-11.
    /// </summary>
    public static class GamesSdkVersions
    {
        public const string SdkTag = "games-sdk-v0.1.0";
        public const string RepoUrl = "https://github.com/michaelasaraf/games-kpi-platform.git";

        public const string KpiWrapperPackage = "com.gameskpi.analytics";
        public static readonly string KpiWrapperUrl = RepoUrl + "?path=sdk/unity#" + SdkTag;

        public const string OpenUpmName = "package.openupm.com";
        public const string OpenUpmUrl = "https://package.openupm.com";
        public const string Edm4U = "com.google.external-dependency-manager";
        public const string UnityEdm = "com.unity.external-dependency-manager";

        public const string AdMob = "com.google.ads.mobile";
        public const string AdMobVersion = "11.6.0";

        /// <summary>AdMob mediation adapters (OpenUPM package versions).</summary>
        public static readonly KeyValuePair<string, string>[] Adapters =
        {
            new KeyValuePair<string, string>("com.google.ads.mobile.mediation.unity", "3.22.0"),
            new KeyValuePair<string, string>("com.google.ads.mobile.mediation.metaaudiencenetwork", "3.20.1"),
        };

        public const string FirebaseVersion = "14.1.0";
        public static readonly string[] FirebasePackages = { "com.google.firebase.app", "com.google.firebase.analytics", "com.google.firebase.crashlytics" };
        public const string FirebaseFolder = "GooglePackages";

        public static string FirebaseFile(string package) => $"{package}-{FirebaseVersion}.tgz";

        public static string FirebaseUrl(string package) => $"https://dl.google.com/games/registry/unity/{package}/{FirebaseFile(package)}";
    }

    /// <summary>
    /// Tools > Games SDK: create the config, install the pinned packages, check the setup. On every editor load it also
    /// copies the AdMob app ids from GameSdkConfig into Google's settings (without them the Android app closes at start).
    /// </summary>
    [InitializeOnLoad]
    public static class GamesSdkSetup
    {
        public const string ConfigPath = "Assets/Resources/GameSdkConfig.asset";
        public const string AndroidFirebaseConfig = "Assets/google-services.json";
        public const string IosFirebaseConfig = "Assets/GoogleService-Info.plist";

        private static readonly Queue<string> Downloads = new Queue<string>();
        private static UnityWebRequest download;

        static GamesSdkSetup()
        {
            EditorApplication.delayCall += () => ApplyAdMobAppIds(false);
        }

        private static string ProjectRoot => Directory.GetParent(Application.dataPath)?.FullName ?? Directory.GetCurrentDirectory();

        private static string ManifestPath => Path.Combine(ProjectRoot, "Packages", "manifest.json");

        public static GameSdkConfig LoadConfig() => AssetDatabase.LoadAssetAtPath<GameSdkConfig>(ConfigPath);

        [MenuItem("Tools/Games SDK/Create Config", priority = 1)]
        public static void CreateConfig()
        {
            var config = LoadConfig();
            if (config == null)
            {
                Directory.CreateDirectory(Path.Combine(ProjectRoot, "Assets", "Resources"));
                config = ScriptableObject.CreateInstance<GameSdkConfig>();
                AssetDatabase.CreateAsset(config, ConfigPath);
                AssetDatabase.SaveAssets();
                Debug.Log($"[GameSdk] Created {ConfigPath} with Google's test ad ids. Fill in the game id and the AdMob ids.");
            }

            Selection.activeObject = config;
            EditorGUIUtility.PingObject(config);
        }

        [MenuItem("Tools/Games SDK/Install Dependencies", priority = 2)]
        public static void InstallDependencies()
        {
            if (download != null)
            {
                Debug.Log("[GameSdk] Still downloading Firebase.");
                return;
            }

            var manifest = File.ReadAllText(ManifestPath);
            if (ManifestText.Dependency(manifest, GamesSdkVersions.UnityEdm) != null && !Directory.Exists(Path.Combine(ProjectRoot, "Packages", GamesSdkVersions.Edm4U)))
            {
                // Two dependency managers fight over the Gradle files. Gem Mine solved it with a placeholder package
                // (see docs/games-sdk.md, "Projects that already use Unity's EDM").
                if (!EditorUtility.DisplayDialog("Games SDK",
                        "This project uses Unity's External Dependency Manager (com.unity.external-dependency-manager). Firebase and AdMob from OpenUPM bring Google's EDM4U as well, and two dependency managers conflict.\n\nRead docs/games-sdk.md (Projects that already use Unity's EDM) first. Continue anyway?",
                        "Continue", "Cancel"))
                {
                    return;
                }
            }

            if (!EditorUtility.DisplayDialog("Games SDK",
                    $"This adds to Packages/manifest.json:\n\n• Google Mobile Ads {GamesSdkVersions.AdMobVersion} with the Unity Ads and Meta Audience Network adapters (OpenUPM)\n• Firebase Analytics and Crashlytics {GamesSdkVersions.FirebaseVersion} (downloaded from dl.google.com into {GamesSdkVersions.FirebaseFolder}/)\n• The Games KPI wrapper ({GamesSdkVersions.SdkTag})\n\nPackages already in the manifest keep their version.",
                    "Install", "Cancel"))
            {
                return;
            }

            manifest = ManifestText.EnsureRegistry(manifest, GamesSdkVersions.OpenUpmName, GamesSdkVersions.OpenUpmUrl, GamesSdkVersions.AdMob, GamesSdkVersions.Edm4U);
            manifest = ManifestText.AddDependency(manifest, GamesSdkVersions.AdMob, GamesSdkVersions.AdMobVersion);
            foreach (var adapter in GamesSdkVersions.Adapters) manifest = ManifestText.AddDependency(manifest, adapter.Key, adapter.Value);
            manifest = ManifestText.AddDependency(manifest, GamesSdkVersions.KpiWrapperPackage, GamesSdkVersions.KpiWrapperUrl);
            File.WriteAllText(ManifestPath, manifest);
            WarnAboutOtherVersions(manifest);

            Directory.CreateDirectory(Path.Combine(ProjectRoot, GamesSdkVersions.FirebaseFolder));
            Downloads.Clear();
            foreach (var package in GamesSdkVersions.FirebasePackages)
            {
                if (ManifestText.Dependency(manifest, package) != null) continue;

                Downloads.Enqueue(package);
            }

            NextDownload();
        }

        private static void WarnAboutOtherVersions(string manifest)
        {
            var ads = ManifestText.Dependency(manifest, GamesSdkVersions.AdMob);
            if (ads != GamesSdkVersions.AdMobVersion) Debug.LogWarning($"[GameSdk] {GamesSdkVersions.AdMob} is {ads}; the SDK is tested with {GamesSdkVersions.AdMobVersion}.");
            foreach (var adapter in GamesSdkVersions.Adapters)
            {
                var have = ManifestText.Dependency(manifest, adapter.Key);
                if (have != adapter.Value) Debug.LogWarning($"[GameSdk] {adapter.Key} is {have}; the SDK is tested with {adapter.Value}.");
            }
        }

        private static void NextDownload()
        {
            if (Downloads.Count == 0)
            {
                EditorUtility.ClearProgressBar();
                Debug.Log("[GameSdk] Dependencies are in Packages/manifest.json; Unity is resolving them. Then: Tools > Games SDK > Check Setup.");
                UnityEditor.PackageManager.Client.Resolve();
                return;
            }

            var package = Downloads.Peek();
            var target = Path.Combine(ProjectRoot, GamesSdkVersions.FirebaseFolder, GamesSdkVersions.FirebaseFile(package));
            if (File.Exists(target))
            {
                AddFirebaseDependency(package);
                Downloads.Dequeue();
                NextDownload();
                return;
            }

            download = new UnityWebRequest(GamesSdkVersions.FirebaseUrl(package), UnityWebRequest.kHttpVerbGET)
            {
                downloadHandler = new DownloadHandlerFile(target + ".part") { removeFileOnAbort = true },
            };
            download.SendWebRequest();
            EditorApplication.update += WatchDownload;
        }

        private static void WatchDownload()
        {
            var package = Downloads.Peek();
            if (!download.isDone)
            {
                if (EditorUtility.DisplayCancelableProgressBar("Games SDK", $"Downloading {GamesSdkVersions.FirebaseFile(package)}", download.downloadProgress))
                {
                    download.Abort();
                }

                return;
            }

            EditorApplication.update -= WatchDownload;
            var target = Path.Combine(ProjectRoot, GamesSdkVersions.FirebaseFolder, GamesSdkVersions.FirebaseFile(package));
            var ok = download.result == UnityWebRequest.Result.Success;
            var error = download.error;
            download.Dispose();
            download = null;
            if (!ok)
            {
                EditorUtility.ClearProgressBar();
                Downloads.Clear();
                Debug.LogError($"[GameSdk] Downloading {GamesSdkVersions.FirebaseUrl(package)} failed: {error}");
                return;
            }

            File.Move(target + ".part", target);
            AddFirebaseDependency(package);
            Downloads.Dequeue();
            NextDownload();
        }

        private static void AddFirebaseDependency(string package)
        {
            var manifest = File.ReadAllText(ManifestPath);
            var value = $"file:../{GamesSdkVersions.FirebaseFolder}/{GamesSdkVersions.FirebaseFile(package)}";
            File.WriteAllText(ManifestPath, ManifestText.AddDependency(manifest, package, value));
        }

        [MenuItem("Tools/Games SDK/Check Setup", priority = 3)]
        public static void CheckSetupFromMenu()
        {
            var problems = CheckSetup(EditorUserBuildSettings.activeBuildTarget, false);
            if (problems.Count == 0) Debug.Log("[GameSdk] Setup looks complete.");
            foreach (var problem in problems) Debug.LogWarning("[GameSdk] " + problem);
        }

        /// <summary>Everything missing or risky for a build of <paramref name="target"/>, one sentence each.</summary>
        public static List<string> CheckSetup(BuildTarget target, bool release)
        {
            var problems = new List<string>();
            var manifest = File.Exists(ManifestPath) ? File.ReadAllText(ManifestPath) : string.Empty;
            var ios = target == BuildTarget.iOS;

            var config = LoadConfig();
            if (config == null)
            {
                problems.Add($"No {ConfigPath}: Tools > Games SDK > Create Config. Builds use Google's test ads until it exists.");
            }
            else
            {
                if (string.IsNullOrEmpty(config.gameId)) problems.Add("GameSdkConfig has no game id (the KPI dashboard's id for this game).");

                var rewarded = ios ? config.iosRewardedId : config.androidRewardedId;
                var interstitial = ios ? config.iosInterstitialId : config.androidInterstitialId;
                var appId = ios ? config.iosAppId : config.androidAppId;
                if (release && (GameSdkConfig.IsTestUnit(rewarded) || GameSdkConfig.IsTestUnit(interstitial) || GameSdkConfig.IsTestUnit(appId)))
                {
                    problems.Add("GameSdkConfig still has Google's test AdMob ids: this release build earns nothing from ads.");
                }
            }

            if (ManifestText.Dependency(manifest, GamesSdkVersions.KpiWrapperPackage) == null && !Directory.Exists(Path.Combine(ProjectRoot, "Packages", GamesSdkVersions.KpiWrapperPackage)))
            {
                problems.Add($"The Games KPI wrapper ({GamesSdkVersions.KpiWrapperPackage}) is missing: Tools > Games SDK > Install Dependencies.");
            }

            if (ManifestText.Dependency(manifest, GamesSdkVersions.AdMob) == null)
            {
                problems.Add("Google Mobile Ads is not installed: phone builds show stand-in ads that pay rewards without an ad.");
            }
            else
            {
                foreach (var adapter in GamesSdkVersions.Adapters)
                {
                    if (ManifestText.Dependency(manifest, adapter.Key) == null) problems.Add($"Mediation adapter {adapter.Key} is not installed.");
                }
            }

            var firebase = ManifestText.Dependency(manifest, "com.google.firebase.analytics") != null;
            if (!firebase) problems.Add("Firebase Analytics is not installed: events only go to the log.");
            if (ManifestText.Dependency(manifest, "com.google.firebase.crashlytics") == null) problems.Add("Firebase Crashlytics is not installed: no crash reports.");
            if (firebase)
            {
                var file = ios ? IosFirebaseConfig : AndroidFirebaseConfig;
                if (!File.Exists(Path.Combine(ProjectRoot, file))) problems.Add($"{file} is missing (download it from the Firebase console): Firebase will not start.");
            }

            return problems;
        }

        [MenuItem("Tools/Games SDK/Apply AdMob App Ids", priority = 4)]
        public static void ApplyFromMenu() => ApplyAdMobAppIds(true);

        /// <summary>
        /// Copies the app ids from GameSdkConfig into Google's settings asset when they differ (or always, from the menu).
        /// Does nothing before Google Mobile Ads is installed.
        /// </summary>
        public static void ApplyAdMobAppIds(bool always)
        {
            var settingsType = TypeCache.GetTypesDerivedFrom<ScriptableObject>()
                .FirstOrDefault(t => t.FullName == "GoogleMobileAds.Editor.GoogleMobileAdsSettings");
            if (settingsType == null)
            {
                if (always) Debug.Log("[GameSdk] Google Mobile Ads is not installed yet: Tools > Games SDK > Install Dependencies.");
                return;
            }

            var config = LoadConfig();
            if (config == null)
            {
                if (always) Debug.LogWarning("[GameSdk] No GameSdkConfig yet: Tools > Games SDK > Create Config.");
                return;
            }

            const BindingFlags any = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance;
            var load = settingsType.GetMethod("LoadInstance", any);
            var settings = load != null ? load.Invoke(null, null) as UnityEngine.Object : null;
            var android = settingsType.GetProperty("GoogleMobileAdsAndroidAppId", any);
            var ios = settingsType.GetProperty("GoogleMobileAdsIOSAppId", any);
            if (settings == null || android == null)
            {
                Debug.LogWarning($"[GameSdk] Could not set the AdMob app id. Open Assets > Google Mobile Ads > Settings and paste {config.androidAppId}.");
                return;
            }

            var androidId = string.IsNullOrEmpty(config.androidAppId) ? GameSdkConfig.TestAndroidAppId : config.androidAppId.Trim();
            var iosId = string.IsNullOrEmpty(config.iosAppId) ? GameSdkConfig.TestIosAppId : config.iosAppId.Trim();
            var changed = false;
            if (always || (android.GetValue(settings) as string) != androidId)
            {
                android.SetValue(settings, androidId);
                changed = true;
            }

            if (ios != null && (always || (ios.GetValue(settings) as string) != iosId))
            {
                ios.SetValue(settings, iosId);
                changed = true;
            }

            if (!changed) return;

            EditorUtility.SetDirty(settings);
            AssetDatabase.SaveAssets();
            Debug.Log($"[GameSdk] AdMob app ids set (Android {androidId}, iOS {iosId}).");
        }
    }

    /// <summary>
    /// Before each Android or iOS build: copies the AdMob app ids, lists what is missing, and stops a build that would
    /// ship broken (Firebase installed without its config file, or a release with Google's test ad ids).
    /// </summary>
    public sealed class GamesSdkBuildCheck : IPreprocessBuildWithReport
    {
        public int callbackOrder => 0;

        public void OnPreprocessBuild(BuildReport report)
        {
            var target = report.summary.platform;
            if (target != BuildTarget.Android && target != BuildTarget.iOS) return;

            GamesSdkSetup.ApplyAdMobAppIds(false);
            var release = (report.summary.options & BuildOptions.Development) == 0;
            var problems = GamesSdkSetup.CheckSetup(target, release);
            var fatal = new StringBuilder();
            foreach (var problem in problems)
            {
                var stops = problem.Contains("Firebase will not start") || (release && problem.Contains("test AdMob ids"));
                if (stops) fatal.AppendLine(problem);
                else Debug.LogWarning("[GameSdk] " + problem);
            }

            if (fatal.Length > 0)
            {
                throw new BuildFailedException("[GameSdk] " + fatal + "Fix these, or build a development build to test with Google's test ads.");
            }
        }
    }
}
