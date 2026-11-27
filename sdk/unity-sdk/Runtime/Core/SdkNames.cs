using System;
using System.Text;

namespace GamesSdk
{
    /// <summary>
    /// Makes names and values fit Firebase Analytics' rules, so an event Firebase would drop silently still arrives:
    /// names start with a letter and hold only letters, digits and underscores; event and param names are at most 40
    /// characters, user property names 24; firebase_, google_ and ga_ are reserved; string values are at most 100
    /// characters and user property values 36. Ported from Gem Mine's AnalyticsNames.
    /// </summary>
    public static class SdkNames
    {
        public const int EventNameMax = 40;
        public const int ParamNameMax = 40;
        public const int UserPropertyNameMax = 24;
        public const int ParamValueMax = 100;
        public const int UserPropertyValueMax = 36;

        /// <summary>Firebase keeps 25 params per event; the KPI wrapper adds 3 (kpi_event_id, kpi_seq, kpi_sdk).</summary>
        public const int GameParamsMax = 22;

        private static readonly string[] Reserved = { "firebase_", "google_", "ga_" };

        public static string Event(string name) => Name(name, EventNameMax);

        public static string Param(string name) => Name(name, ParamNameMax);

        public static string UserProperty(string name) => Name(name, UserPropertyNameMax);

        public static string ParamValue(string value) => Clip(value, ParamValueMax);

        public static string UserPropertyValue(string value) => Clip(value, UserPropertyValueMax);

        /// <summary>"CoinCart" becomes "coin_cart".</summary>
        public static string SnakeCase(string name)
        {
            if (string.IsNullOrEmpty(name)) return string.Empty;

            var builder = new StringBuilder(name.Length + 4);
            for (var i = 0; i < name.Length; i++)
            {
                var c = name[i];
                if (char.IsUpper(c))
                {
                    if (i > 0 && char.IsLetterOrDigit(name[i - 1]) && name[i - 1] != '_') builder.Append('_');
                    builder.Append(char.ToLowerInvariant(c));
                }
                else
                {
                    builder.Append(c);
                }
            }

            return builder.ToString();
        }

        /// <summary>Other characters become underscores; a leading digit or reserved prefix gets "g_".</summary>
        public static string Name(string name, int max)
        {
            if (string.IsNullOrEmpty(name)) return null;

            var builder = new StringBuilder(name.Length + 2);
            foreach (var c in name.Trim())
            {
                var ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_';
                builder.Append(ok ? c : '_');
            }

            if (builder.Length == 0) return null;

            var text = builder.ToString();
            var first = text[0];
            var startsWithLetter = (first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z');
            if (!startsWithLetter || IsReserved(text)) text = "g_" + text.TrimStart('_');

            return text.Length > max ? text.Substring(0, max) : text;
        }

        private static bool IsReserved(string name)
        {
            foreach (var prefix in Reserved)
            {
                if (name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return true;
            }

            return false;
        }

        private static string Clip(string value, int max)
        {
            if (value == null) return string.Empty;

            return value.Length > max ? value.Substring(0, max) : value;
        }
    }
}
