// GENERATED CODE - DO NOT MODIFY BY HAND.
// Generated from catalog/events.yaml (version 1) by tools/codegen.
// Change the catalog and run `npm run codegen`.

part of '../games_kpi.dart';

/// Typed helpers for every event in the shared KPI event catalog.
abstract final class KpiEvents {
  static const int catalogVersion = 1;

  /// The tutorial starts. Call once per player.
  static Future<void> tutorialBegin() => _log('tutorial_begin', const <String, Object>{});

  /// The player finishes one tutorial step. Steps are numbered from 1.
  static Future<void> tutorialStep({required int step, String? stepName}) {
    return _log('tutorial_step', <String, Object>{
      'step': step,
      if (stepName != null) 'step_name': _clip(stepName),
    });
  }

  /// The last tutorial step is finished.
  static Future<void> tutorialComplete() => _log('tutorial_complete', const <String, Object>{});

  /// A level attempt starts (also on retry).
  static Future<void> levelStart({required String levelName, required int levelNumber, int? attempt}) {
    return _log('level_start', <String, Object>{
      'level_name': _clip(levelName),
      'level_number': levelNumber,
      if (attempt != null) 'attempt': attempt,
    });
  }

  /// A level attempt ends, won or lost. Quitting mid-level counts as a fail.
  static Future<void> levelEnd({required String levelName, required int levelNumber, required bool success, int? durationSec, int? attempt, int? stars, int? boostersUsed}) {
    return _log('level_end', <String, Object>{
      'level_name': _clip(levelName),
      'level_number': levelNumber,
      'success': (success ? 1 : 0),
      if (durationSec != null) 'duration_sec': durationSec,
      if (attempt != null) 'attempt': attempt,
      if (stars != null) 'stars': stars,
      if (boostersUsed != null) 'boosters_used': boostersUsed,
    });
  }

  /// The game offers a rewarded ad (button or popup becomes visible).
  static Future<void> adOfferShown({required String placement}) {
    return _log('ad_offer_shown', <String, Object>{
      'placement': _clip(placement),
    });
  }

  /// The player taps to watch the offered rewarded ad.
  static Future<void> adOfferAccepted({required String placement}) {
    return _log('ad_offer_accepted', <String, Object>{
      'placement': _clip(placement),
    });
  }

  /// An ad was shown and earned revenue. Forward the mediation SDK's paid/revenue callback here (AppLovin MAX OnAdRevenuePaid, LevelPlay ImpressionDataReady, AdMob OnPaidEvent). Skip it for AdMob if Firebase already logs ad_impression automatically, or revenue is counted twice.
  static Future<void> adImpression({required String adPlatform, required String adFormat, required double value_, required String currency, String? adSource, String? adUnitName, String? placement}) {
    return _log('ad_impression', <String, Object>{
      'ad_platform': _clip(adPlatform),
      'ad_format': _clip(adFormat),
      'value': value_,
      'currency': _clip(currency),
      if (adSource != null) 'ad_source': _clip(adSource),
      if (adUnitName != null) 'ad_unit_name': _clip(adUnitName),
      if (placement != null) 'placement': _clip(placement),
    });
  }

  /// The store screen opens.
  static Future<void> storeView({String? storeSection}) {
    return _log('store_view', <String, Object>{
      if (storeSection != null) 'store_section': _clip(storeSection),
    });
  }

  /// A paid offer is shown (popup, banner or store card).
  static Future<void> offerShown({required String offerId, String? placement}) {
    return _log('offer_shown', <String, Object>{
      'offer_id': _clip(offerId),
      if (placement != null) 'placement': _clip(placement),
    });
  }

  /// A purchase succeeded. Always send it. The dashboard counts it as revenue when the game's iap_source is wrapper; with firebase_auto it uses Firebase's own in_app_purchase event instead, so revenue is never counted twice.
  static Future<void> iapPurchase({required String productId, required double value_, required String currency, required String transactionId, String? store}) {
    return _log('iap_purchase', <String, Object>{
      'product_id': _clip(productId),
      'value': value_,
      'currency': _clip(currency),
      'transaction_id': _clip(transactionId),
      if (store != null) 'store': _clip(store),
    });
  }

  /// The player gains soft or hard currency.
  static Future<void> earnCurrency({required String virtualCurrencyName, required int value_, required String source, int? balanceAfter, String? levelName}) {
    return _log('earn_virtual_currency', <String, Object>{
      'virtual_currency_name': _clip(virtualCurrencyName),
      'value': value_,
      'source': _clip(source),
      if (balanceAfter != null) 'balance_after': balanceAfter,
      if (levelName != null) 'level_name': _clip(levelName),
    });
  }

  /// The player spends currency.
  static Future<void> spendCurrency({required String virtualCurrencyName, required int value_, required String sink, String? itemName, int? balanceAfter, String? levelName}) {
    return _log('spend_virtual_currency', <String, Object>{
      'virtual_currency_name': _clip(virtualCurrencyName),
      'value': value_,
      'sink': _clip(sink),
      if (itemName != null) 'item_name': _clip(itemName),
      if (balanceAfter != null) 'balance_after': balanceAfter,
      if (levelName != null) 'level_name': _clip(levelName),
    });
  }

  /// A booster or consumable item is used.
  static Future<void> itemUsed({required String itemId, String? levelName}) {
    return _log('item_used', <String, Object>{
      'item_id': _clip(itemId),
      if (levelName != null) 'level_name': _clip(levelName),
    });
  }

  /// The player cannot continue without paying, watching an ad or waiting.
  static Future<void> blockerHit({required String reason, String? levelName}) {
    return _log('blocker_hit', <String, Object>{
      'reason': _clip(reason),
      if (levelName != null) 'level_name': _clip(levelName),
    });
  }
}
