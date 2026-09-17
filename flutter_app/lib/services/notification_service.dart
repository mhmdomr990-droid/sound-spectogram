import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'foreground_service.dart';

class NotificationService {
  static final _plugin = FlutterLocalNotificationsPlugin();
  static bool _initialized = false;
  static final enabledNotifier = ValueNotifier<bool>(true);

  static const _channelId = 'target_detection';
  static const _channelName = 'اكتشاف أهداف';
  static const _channelDescription = 'إشعارات عند اكتشاف هدف في أحد الأجهزة';
  static const _prefsKey = 'notifications_enabled';

  static bool get enabled => enabledNotifier.value;

  static Future<void> init() async {
    if (_initialized) return;

    final prefs = await SharedPreferences.getInstance();
    enabledNotifier.value = prefs.getBool(_prefsKey) ?? true;

    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const settings = InitializationSettings(android: androidSettings);
    await _plugin.initialize(settings);

    final androidPlugin = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    if (androidPlugin != null) {
      await androidPlugin.createNotificationChannel(
        const AndroidNotificationChannel(
          _channelId,
          _channelName,
          description: _channelDescription,
          importance: Importance.high,
          enableVibration: true,
        ),
      );
    }

    _initialized = true;
  }

  static Future<void> toggle() async {
    enabledNotifier.value = !enabledNotifier.value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_prefsKey, enabledNotifier.value);

    if (!enabledNotifier.value) {
      await AppForegroundService.stop();
    } else {
      await AppForegroundService.start();
    }
  }

  static Future<void> showTargetNotification({
    required String deviceName,
    required double? confidence,
  }) async {
    if (!_initialized || !enabledNotifier.value) return;

    final body = confidence != null
        ? '$deviceName — ${confidence.toStringAsFixed(1)}%'
        : deviceName;

    const androidDetails = AndroidNotificationDetails(
      _channelId,
      _channelName,
      channelDescription: _channelDescription,
      importance: Importance.high,
      priority: Priority.high,
      enableVibration: true,
      icon: '@mipmap/ic_launcher',
    );

    const details = NotificationDetails(android: androidDetails);

    await _plugin.show(
      DateTime.now().millisecondsSinceEpoch.remainder(100000),
      '🔴 هدف مكتشف',
      body,
      details,
    );
  }
}
