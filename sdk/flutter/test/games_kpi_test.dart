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

  test('parses Play install referrers', () {
    final meta = parseInstallReferrer('utm_source=apps.facebook.com&utm_campaign=fb4a&utm_content=%7B%22app%22%3A1%7D');
    expect(meta.mediaSource, 'apps.facebook.com');
    expect(meta.isOrganic, isFalse);
    expect(meta.campaign, 'fb4a');
    expect(parseInstallReferrer('gclid=Cj0KCQ&utm_source=google&utm_medium=cpc').mediaSource, 'google_ads');
    expect(parseInstallReferrer('utm_source=google-play&utm_medium=organic').isOrganic, isTrue);
    expect(parseInstallReferrer('').mediaSource, 'unknown');
  });

  test('sends the install referrer once per install', () async {
    SharedPreferences.setMockInitialValues({});
    final fake = FakeAnalytics();
    Future<String?> referrer() async => 'utm_source=google-play&utm_medium=organic';
    await Kpi.init(analytics: fake, installReferrer: referrer);
    await Kpi.init(analytics: fake, installReferrer: referrer);
    final sent = fake.logged.where((e) => e.$1 == 'install_attribution').toList();
    expect(sent, hasLength(1));
    expect(sent.single.$2['attribution_provider'], 'play_referrer');
    expect(sent.single.$2['is_organic'], 1);
  });

  test('waits for consent before sending the referrer', () async {
    SharedPreferences.setMockInitialValues({});
    final fake = FakeAnalytics();
    Future<String?> referrer() async => 'utm_source=apps.facebook.com';
    await Kpi.init(analytics: fake, analyticsConsent: false, installReferrer: referrer);
    expect(fake.logged, isEmpty);
    await Kpi.init(analytics: fake, installReferrer: referrer);
    expect(fake.logged.single.$1, 'install_attribution');
  });

  test('sends Meta campaign data in parts, also for installs from before it existed', () async {
    final metaJson = '{"app":1234,"t":1762900000,"source":{"data":"${'a' * 900}","nonce":"${'b' * 24}"}}';
    final ref = 'utm_source=apps.facebook.com&utm_campaign=fb4a&utm_content=${Uri.encodeComponent(metaJson)}';
    SharedPreferences.setMockInitialValues({'games_kpi_referrer_done': true});
    final fake = FakeAnalytics();
    Future<String?> referrer() async => ref;
    await Kpi.init(analytics: fake, installReferrer: referrer);
    await Kpi.init(analytics: fake, installReferrer: referrer);
    expect(fake.logged.where((e) => e.$1 == 'install_attribution'), isEmpty);
    final sent = fake.logged.where((e) => e.$1 == 'meta_install_referrer').toList();
    expect(sent, hasLength(1));
    final p = sent.single.$2;
    expect(p['origin'], 'play');
    expect(p['parts'], (metaJson.length + 99) ~/ 100);
    final keys = p.keys.where((k) => RegExp(r'^p\d\d$').hasMatch(k)).toList()..sort();
    expect(keys.map((k) => p[k]).join(), metaJson);
    expect(p.length, lessThanOrEqualTo(25));
  });

  test('finds Meta campaign data only when it has source and nonce', () {
    expect(metaReferrerContent('utm_source=apps.facebook.com&utm_content=%7B%22app%22%3A1%7D'), isNull);
    expect(metaReferrerContent('utm_source=google-play&utm_medium=organic'), isNull);
    expect(metaReferrerContent('utm_content=%7B%22source%22%3A%7B%22nonce%22%3A%22x%22%7D%7D'), '{"source":{"nonce":"x"}}');
  });
}
