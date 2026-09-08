import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class TelegramService {
  static const _tokenKey = 'telegram_bot_token';
  static const _chatIdKey = 'telegram_chat_id';
  static const _enabledKey = 'telegram_enabled';

  static DateTime? _lastAlertTime;
  static const _alertCooldown = Duration(seconds: 30);

  static Future<void> saveConfig({
    required String token,
    required String chatId,
    required bool enabled,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, token);
    await prefs.setString(_chatIdKey, chatId);
    await prefs.setBool(_enabledKey, enabled);
  }

  static Future<String?> getToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_tokenKey);
  }

  static Future<String?> getChatId() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_chatIdKey);
  }

  static Future<bool> isEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_enabledKey) ?? false;
  }

  static Future<bool> sendAlert({
    required String device,
    required String status,
    required String confidence,
    required String time,
  }) async {
    final now = DateTime.now();
    if (_lastAlertTime != null && now.difference(_lastAlertTime!) < _alertCooldown) {
      return false;
    }

    final token = await getToken();
    final chatId = await getChatId();
    if (token == null || token.isEmpty || chatId == null || chatId.isEmpty) return false;

    final emoji = status == 'detected' ? '\u{1F534}' : status == 'possible' ? '\u{1F7E1}' : '\u{1F7E2}';
    final text = '$emoji *Sound Spectogram Alert*\n\n'
        'Device: $device\n'
        'Status: $status\n'
        'Confidence: $confidence%\n'
        'Time: $time';

    try {
      final response = await http.post(
        Uri.parse('https://api.telegram.org/bot$token/sendMessage'),
        headers: {'Content-Type': 'application/json; charset=UTF-8'},
        body: jsonEncode({
          'chat_id': chatId,
          'text': text,
          'parse_mode': 'Markdown',
        }),
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        _lastAlertTime = now;
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> sendTestMessage() async {
    final token = await getToken();
    final chatId = await getChatId();
    if (token == null || token.isEmpty || chatId == null || chatId.isEmpty) return false;

    try {
      final response = await http.post(
        Uri.parse('https://api.telegram.org/bot$token/sendMessage'),
        headers: {'Content-Type': 'application/json; charset=UTF-8'},
        body: jsonEncode({
          'chat_id': chatId,
          'text': '\u{2705} Sound Spectogram connected successfully!',
        }),
      ).timeout(const Duration(seconds: 10));

      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }
}
