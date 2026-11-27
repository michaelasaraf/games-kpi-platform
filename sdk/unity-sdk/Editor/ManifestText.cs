using System;
using System.Text.RegularExpressions;

namespace GamesSdk.Editor
{
    /// <summary>
    /// Small text edits to Packages/manifest.json that keep the file's own layout (Unity has no JSON object editor in
    /// the editor API). Plain C# so it is tested outside Unity (Tests~).
    /// </summary>
    public static class ManifestText
    {
        /// <summary>The value a dependency is set to, or null.</summary>
        public static string Dependency(string manifest, string package)
        {
            var match = Regex.Match(DependenciesBlock(manifest), "\"" + Regex.Escape(package) + "\"\\s*:\\s*\"([^\"]*)\"");
            return match.Success ? match.Groups[1].Value : null;
        }

        /// <summary>Adds the dependency when missing. An existing one is left as the game set it.</summary>
        public static string AddDependency(string manifest, string package, string value)
        {
            if (Dependency(manifest, package) != null) return manifest;

            var key = manifest.IndexOf("\"dependencies\"", StringComparison.Ordinal);
            if (key < 0) throw new FormatException("manifest.json has no \"dependencies\".");

            var open = manifest.IndexOf('{', key);
            var rest = manifest.Substring(open + 1).TrimStart();
            var empty = rest.Length > 0 && rest[0] == '}';
            var entry = "\n    \"" + package + "\": \"" + value + "\"" + (empty ? "\n  " : ",");
            return manifest.Insert(open + 1, entry);
        }

        /// <summary>
        /// Makes sure a scoped registry with <paramref name="url"/> exists and lists every scope given.
        /// </summary>
        public static string EnsureRegistry(string manifest, string name, string url, params string[] scopes)
        {
            var at = manifest.IndexOf("\"" + url + "\"", StringComparison.Ordinal);
            if (at < 0) return AddRegistry(manifest, name, url, scopes);

            foreach (var scope in scopes)
            {
                // The scopes array of this registry: the first "scopes" after its url, or before it if listed first.
                var start = manifest.LastIndexOf('{', at);
                var end = manifest.IndexOf('}', at);
                var block = manifest.Substring(start, end - start);
                if (block.Contains("\"" + scope + "\"")) continue;

                var scopesKey = block.IndexOf("\"scopes\"", StringComparison.Ordinal);
                if (scopesKey < 0)
                {
                    manifest = manifest.Insert(at + url.Length + 2, ",\n      \"scopes\": [\n        \"" + scope + "\"\n      ]");
                }
                else
                {
                    var bracket = manifest.IndexOf('[', start + scopesKey);
                    var after = manifest.Substring(bracket + 1).TrimStart();
                    var none = after.Length > 0 && after[0] == ']';
                    manifest = manifest.Insert(bracket + 1, "\n        \"" + scope + "\"" + (none ? "\n      " : ","));
                }

                at = manifest.IndexOf("\"" + url + "\"", StringComparison.Ordinal);
            }

            return manifest;
        }

        private static string AddRegistry(string manifest, string name, string url, string[] scopes)
        {
            var registry = "    {\n" +
                           "      \"name\": \"" + name + "\",\n" +
                           "      \"url\": \"" + url + "\",\n" +
                           "      \"scopes\": [\n        \"" + string.Join("\",\n        \"", scopes) + "\"\n      ]\n" +
                           "    }";

            var key = manifest.IndexOf("\"scopedRegistries\"", StringComparison.Ordinal);
            if (key >= 0)
            {
                var open = manifest.IndexOf('[', key);
                var rest = manifest.Substring(open + 1).TrimStart();
                var empty = rest.Length > 0 && rest[0] == ']';
                return manifest.Insert(open + 1, "\n" + registry + (empty ? "\n  " : ","));
            }

            var first = manifest.IndexOf('{');
            return manifest.Insert(first + 1, "\n  \"scopedRegistries\": [\n" + registry + "\n  ],");
        }

        private static string DependenciesBlock(string manifest)
        {
            var key = manifest.IndexOf("\"dependencies\"", StringComparison.Ordinal);
            if (key < 0) return string.Empty;

            var open = manifest.IndexOf('{', key);
            var close = manifest.IndexOf('}', open);
            return close > open ? manifest.Substring(open, close - open + 1) : string.Empty;
        }
    }
}
