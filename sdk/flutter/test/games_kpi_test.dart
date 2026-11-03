import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:games_kpi/games_kpi.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Records calls instead of talking to Firebase.
class FakeAnalytics implements FirebaseAnalytics {
  final logged = <(String, Map<String, Object>)>[];
  bool collectionEnabled = true;
  bool? adStorage;

  @override
  Future<void> logEvent({required String name, Map<String, Object>? parameters, List<AnalyticsEventItem>? items, AnalyticsCallOptions? callOptions}) async {
    logged.add((name, parameters ?? const {}));
  }

  @override
  Future<void> setAnalyticsCollectionEnabled(bool enabled) async => collectionEnabled = enabled;

  @override
  Future<void> setConsent({
    bool? adStorageConsentGranted,
    bool? analyticsStorageConsentGranted,
    bool? adPersonalizationSignalsConsentGranted,
    bool? adUserDataConsentGranted,
    bool? functionalityStorageConsentGranted,
    bool? personalizationStorageConsentGranted,
    bool? securityStorageConsentGranted,
  }) async {
    adStorage = adStorageConsentGranted;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('sends catalog events with the envelope params', () async {
    SharedPreferences.setMockInitialValues({});
    final fake = FakeAnalytics();
    await Kpi.init(analytics: fake);

    await KpiEvents.levelEnd(levelName: 'w1_l01', levelNumber: 1, success: true, durationSec: 42);
    await KpiEvents.adImpression(adPlatform: 'applovin_max', adFormat: 'rewarded', value_: 0.0123, currency: 'USD');
    await KpiEvents.tutorialBegin();

    expect(fake.logged.map((e) => e.$1), ['level_end', 'ad_impression', 'tutorial_begin']);
    final levelEnd = fake.logged[0].$2;
    expect(levelEnd['success'], 1);
    expect(levelEnd.containsKey('stars'), isFalse);
    expect(fake.logged[1].$2['value'], 0.0123);
    expect(fake.logged[2].$2['kpi_seq'], 3);
    expect((fake.logged[2].$2['kpi_event_id'] as String).length, 32);
    expect(fake.logged[2].$2['kpi_sdk'], kpiSdkVersion);
  });

  test('clips long strings and keeps the sequence across restarts', () async {
    SharedPreferences.setMockInitialValues({'games_kpi_seq': 41});
    final fake = FakeAnalytics();
    await Kpi.init(analytics: fake);
    await KpiEvents.levelStart(levelName: 'x' * 150, levelNumber: 3);
    expect((fake.logged.single.$2['level_name'] as String).length, 100);
    expect(fake.logged.single.$2['kpi_seq'], 42);
  });

  test('sends nothing without analytics consent', () async {
    SharedPreferences.setMockInitialValues({});
    final fake = FakeAnalytics();
    await Kpi.init(analytics: fake, analyticsConsent: false, adsConsent: false);
    await KpiEvents.levelStart(levelName: 'w1_l01', levelNumber: 1);
    expect(fake.logged, isEmpty);
    expect(fake.collectionEnabled, isFalse);
    expect(fake.adStorage, isFalse);
  });
}
