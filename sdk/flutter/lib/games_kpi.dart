/// Games KPI wrapper over Firebase Analytics.
///
/// Call [Kpi.init] once after `Firebase.initializeApp()`, then use the typed
/// helpers in [KpiEvents] (generated from catalog/events.yaml).
library games_kpi;

import 'dart:math';

import 'package:android_play_install_referrer/android_play_install_referrer.dart';
import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

part 'src/install_referrer.dart';
part 'src/kpi_events.g.dart';

/// Version tag sent with every event as `kpi_sdk`.
const String kpiSdkVersion = 'flutter-0.2.0';

const String _seqKey = 'games_kpi_seq';
const int _maxStringLength = 100;

/// Setup and consent for the Games KPI wrapper.
abstract final class Kpi {
  static FirebaseAnalytics? _analytics;
  static SharedPreferences? _prefs;
  static bool _collectionEnabled = true;
  static int _seq = 0;

  /// Prints every event to the debug console. Handy while integrating.
  static bool debugLog = false;

  /// True after [init] has completed.
  static bool get isInitialized => _analytics != null;

  /// Call once, after `await Firebase.initializeApp()`.
  /// Pass the player's consent answers if the game asks for consent.
  ///
  /// On Android, init also reads the Google Play install referrer once per
  /// install and sends it as `install_attribution` (the player's UA source),
  /// without waiting for it. Pass `autoInstallReferrer: false` to turn that off.
  static Future<void> init({
    FirebaseAnalytics? analytics,
    bool analyticsConsent = true,
    bool adsConsent = true,
    bool autoInstallReferrer = true,
    @visibleForTesting Future<String?> Function()? installReferrer,
  }) async {
    _prefs = await SharedPreferences.getInstance();
    _seq = _prefs!.getInt(_seqKey) ?? 0;
    _analytics = analytics ?? FirebaseAnalytics.instance;
    await setConsent(analytics: analyticsConsent, ads: adsConsent);
    if (autoInstallReferrer) {
      final done = _reportInstallReferrer(installReferrer ?? _readPlayReferrer);
      if (installReferrer != null) await done; // tests wait; games do not
    }
  }

  /// Updates consent. With analytics consent off, no KPI events are sent and
  /// Firebase analytics collection is disabled.
  static Future<void> setConsent({required bool analytics, required bool ads}) async {
    final a = _analytics;
    if (a == null) {
      throw StateError('Call Kpi.init() before Kpi.setConsent().');
    }
    await a.setConsent(
      analyticsStorageConsentGranted: analytics,
      adStorageConsentGranted: ads,
      adUserDataConsentGranted: ads,
      adPersonalizationSignalsConsentGranted: ads,
    );
    await a.setAnalyticsCollectionEnabled(analytics);
    _collectionEnabled = analytics;
  }
}

Future<void> _log(String name, Map<String, Object> params) async {
  final analytics = Kpi._analytics;
  if (analytics == null) {
    debugPrint('[GamesKpi] $name dropped: call Kpi.init() after Firebase.initializeApp().');
    return;
  }
  if (!Kpi._collectionEnabled) return;

  Kpi._seq++;
  final seq = Kpi._seq;
  final withEnvelope = <String, Object>{
    ...params,
    'kpi_event_id': _newEventId(),
    'kpi_seq': seq,
    'kpi_sdk': kpiSdkVersion,
  };

  try {
    await Kpi._prefs?.setInt(_seqKey, seq);
    await analytics.logEvent(name: name, parameters: withEnvelope);
    if (Kpi.debugLog) debugPrint('[GamesKpi] $name seq=$seq');
  } catch (e) {
    // Analytics must never crash the game.
    debugPrint('[GamesKpi] failed to log $name: $e');
  }
}

String _clip(String value) =>
    value.length <= _maxStringLength ? value : value.substring(0, _maxStringLength);

final Random _random = Random.secure();

/// 32 hex characters, like a UUID without dashes.
String _newEventId() {
  final buffer = StringBuffer();
  for (var i = 0; i < 16; i++) {
    buffer.write(_random.nextInt(256).toRadixString(16).padLeft(2, '0'));
  }
  return buffer.toString();
}
