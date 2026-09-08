import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class TelegramService {
  static const _tokenKey = 'telegram_bot_token';
  static const _channelKey = 'telegram_channel';
  static const _inviteLinkKey = 'telegram_invite_link';
  static const _enabledKey = 'telegram_enabled';

  static DateTime? _lastAlertTime;
  static const _alertCooldown = Duration(seconds: 30);

  static DateTime? _lastConnectionAlertTime;
  static const _connectionCooldown = Duration(seconds: 60);

  static Future<void> saveConfig({
    required String token,
    required String channel,
    String? inviteLink,
    required bool enabled,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, token);
    await prefs.setString(_channelKey, channel);
    await prefs.setString(_inviteLinkKey, inviteLink ?? '');
    await prefs.setBool(_enabledKey, enabled);
  }

  static Future<String?> getToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_tokenKey);
  }

  static Future<String?> getChannel() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_channelKey);
  }

  static Future<String?> getInviteLink() async {
    final prefs = await SharedPreferences.getInstance();
    final link = prefs.getString(_inviteLinkKey);
    return (link != null && link.isNotEmpty) ? link : null;
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
    final channel = await getChannel();
    if (token == null || token.isEmpty || channel == null || channel.isEmpty) return false;

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
          'chat_id': channel,
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
    final channel = await getChannel();
    if (token == null || token.isEmpty || channel == null || channel.isEmpty) return false;

    try {
      final response = await http.post(
        Uri.parse('https://api.telegram.org/bot$token/sendMessage'),
        headers: {'Content-Type': 'application/json; charset=UTF-8'},
        body: jsonEncode({
          'chat_id': channel,
          'text': '\u{2705} Sound Spectogram connected successfully!',
        }),
      ).timeout(const Duration(seconds: 10));

      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  static Future<bool> sendConnectionAlert(String status) async {
    final now = DateTime.now();
    if (_lastConnectionAlertTime != null && now.difference(_lastConnectionAlertTime!) < _connectionCooldown) {
      return false;
    }

    final token = await getToken();
    final channel = await getChannel();
    if (token == null || token.isEmpty || channel == null || channel.isEmpty) return false;

    final isConnected = status == 'connected';
    final emoji = isConnected ? '\u{1F7E2}' : '\u{1F534}';
    final label = isConnected ? 'Connected' : 'Disconnected';
    final time = now.toLocal().toString().substring(0, 19);

    final text = '$emoji *Sound Spectogram $label*\n\n'
        'Status: $label\n'
        'Time: $time';

    try {
      final response = await http.post(
        Uri.parse('https://api.telegram.org/bot$token/sendMessage'),
        headers: {'Content-Type': 'application/json; charset=UTF-8'},
        body: jsonEncode({
          'chat_id': channel,
          'text': text,
          'parse_mode': 'Markdown',
        }),
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        _lastConnectionAlertTime = now;
        return true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }
}
