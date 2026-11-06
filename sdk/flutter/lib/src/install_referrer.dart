part of '../games_kpi.dart';

const String _referrerDoneKey = 'games_kpi_referrer_done';

/// UA source read from a Google Play install referrer string.
typedef ReferrerInfo = ({String mediaSource, String? campaign, bool? isOrganic});

/// Reads utm_source, utm_medium, utm_campaign and the Google Ads click ids
/// (gclid, gbraid, wbraid) from a Play install referrer.
@visibleForTesting
ReferrerInfo parseInstallReferrer(String referrer) {
  final q = <String, String>{};
  for (final part in referrer.split('&')) {
    if (part.isEmpty) continue;
    final eq = part.indexOf('=');
    final key = (eq < 0 ? part : part.substring(0, eq)).toLowerCase();
    final raw = eq < 0 ? '' : part.substring(eq + 1).replaceAll('+', ' ');
    String value;
    try {
      value = Uri.decodeComponent(raw);
    } catch (_) {
      value = raw;
    }
    q.putIfAbsent(key, () => value);
  }
  String? get(String k) => (q[k]?.isNotEmpty ?? false) ? q[k] : null;

  final source = get('utm_source');
  final medium = get('utm_medium');
  final campaign = get('utm_campaign');
  if (get('gclid') != null || get('gbraid') != null || get('wbraid') != null) {
    return (mediaSource: 'google_ads', campaign: campaign, isOrganic: false);
  }
  if (source == null) return (mediaSource: 'unknown', campaign: campaign, isOrganic: null);
  final organic = medium?.toLowerCase() == 'organic' || source.toLowerCase() == 'google-play';
  return (mediaSource: source, campaign: campaign, isOrganic: organic);
}

Future<String?> _readPlayReferrer() async {
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return null;
  final details = await AndroidPlayInstallReferrer.installReferrer;
  return details.installReferrer ?? '';
}

/// Sends the install referrer once per install, as install_attribution with
/// provider play_referrer. Errors are swallowed: analytics must not break the game.
Future<void> _reportInstallReferrer(Future<String?> Function() read) async {
  final prefs = Kpi._prefs;
  if (prefs == null || (prefs.getBool(_referrerDoneKey) ?? false)) return;
  if (!Kpi._collectionEnabled) return; // try again on a later launch, once consent allows it
  try {
    final referrer = await read();
    if (referrer == null) return; // not Android, or the Play Store could not answer
    if (referrer.isNotEmpty) {
      final info = parseInstallReferrer(referrer);
      await KpiEvents.installAttribution(
        attributionProvider: 'play_referrer',
        mediaSource: info.mediaSource,
        campaign: info.campaign,
        isOrganic: info.isOrganic,
        referrer: referrer,
      );
    }
    await prefs.setBool(_referrerDoneKey, true);
  } catch (e) {
    debugPrint('[GamesKpi] install referrer unavailable: $e');
  }
}
