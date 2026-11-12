part of '../games_kpi.dart';

const String _referrerDoneKey = 'games_kpi_referrer_done';
const String _metaReferrerDoneKey = 'games_kpi_meta_referrer_done';

/// Up to 20 parts of 100 characters: Meta's data is about 950, and Firebase allows 25 params.
const int _metaReferrerMaxParts = 20;

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

/// Meta's encrypted campaign data (the decoded utm_content JSON) in a Play install
/// referrer, or null when it has none.
@visibleForTesting
String? metaReferrerContent(String referrer) {
  for (final part in referrer.split('&')) {
    if (!part.toLowerCase().startsWith('utm_content=')) continue;
    final raw = part.substring('utm_content='.length).replaceAll('+', ' ');
    String value;
    try {
      value = Uri.decodeComponent(raw);
    } catch (_) {
      value = raw;
    }
    return value.contains('"source"') && value.contains('"nonce"') ? value : null;
  }
  return null;
}

/// Sends Meta's encrypted campaign data whole, as meta_install_referrer with
/// 100-character params p00, p01, ... Firebase drops it from its own campaign
/// event (far over 100 characters); the KPI build joins and decrypts it.
Future<void> _sendMetaReferrer(String content, String origin) {
  final parts = min(_metaReferrerMaxParts, (content.length + _maxStringLength - 1) ~/ _maxStringLength);
  final params = <String, Object>{'origin': origin, 'parts': parts};
  for (var i = 0; i < parts; i++) {
    final start = i * _maxStringLength;
    params['p${i.toString().padLeft(2, '0')}'] = content.substring(start, min(content.length, start + _maxStringLength));
  }
  return _log('meta_install_referrer', params);
}

Future<String?> _readPlayReferrer() async {
  if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) return null;
  final details = await AndroidPlayInstallReferrer.installReferrer;
  return details.installReferrer ?? '';
}

/// Sends the install referrer once per install, as install_attribution with
/// provider play_referrer, and for Meta installs Meta's campaign data as
/// meta_install_referrer. Installs from before the Meta part existed send it on
/// their next launch, while Google Play still has their referrer (about 90 days).
/// Errors are swallowed: analytics must not break the game.
Future<void> _reportInstallReferrer(Future<String?> Function() read) async {
  final prefs = Kpi._prefs;
  if (prefs == null) return;
  final attributionDone = prefs.getBool(_referrerDoneKey) ?? false;
  final metaDone = prefs.getBool(_metaReferrerDoneKey) ?? false;
  if (attributionDone && metaDone) return;
  if (!Kpi._collectionEnabled) return; // try again on a later launch, once consent allows it
  try {
    final referrer = await read();
    if (referrer == null) return; // not Android, or the Play Store could not answer
    if (!attributionDone) {
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
    }
    if (!metaDone) {
      final meta = metaReferrerContent(referrer);
      if (meta != null) await _sendMetaReferrer(meta, 'play');
      await prefs.setBool(_metaReferrerDoneKey, true);
    }
  } catch (e) {
    debugPrint('[GamesKpi] install referrer unavailable: $e');
  }
}
