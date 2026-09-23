import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/api_client.dart';
import '../services/auth_service.dart';
import '../services/foreground_service.dart';
import '../services/socket_service.dart';

class AuthController extends GetxController {
  final AuthService _auth;
  final ApiClient _api;

  AuthController(this._auth, this._api);

  static const _savedUsernameKey = 'saved_username';
  static const _savedPasswordKey = 'saved_password';
  static const _savedServerKey = 'saved_server_url';
  static const FlutterSecureStorage _secure = FlutterSecureStorage();

  final isLoggedIn = false.obs;
  final isLoading = false.obs;
  final error = ''.obs;

  final savedUsername = ''.obs;
  final savedPassword = ''.obs;
  final savedServerUrl = ''.obs;

  @override
  void onInit() {
    super.onInit();
    isLoggedIn.value = _auth.isLoggedIn;
    _loadSavedCredentials();
  }

  Future<void> _loadSavedCredentials() async {
    final prefs = await SharedPreferences.getInstance();
    savedUsername.value = prefs.getString(_savedUsernameKey) ?? '';
    savedServerUrl.value = prefs.getString(_savedServerKey) ?? '';

    // Migrate legacy plaintext password from SharedPreferences → secure storage.
    final legacyPassword = prefs.getString(_savedPasswordKey);
    if (legacyPassword != null && legacyPassword.isNotEmpty) {
      await _secure.write(key: _savedPasswordKey, value: legacyPassword);
      await prefs.remove(_savedPasswordKey);
    }
    savedPassword.value = await _secure.read(key: _savedPasswordKey) ?? '';

    if (savedServerUrl.value.isNotEmpty) {
      _api.baseUrl = savedServerUrl.value;
    }
  }

  Future<void> _saveCredentials(String username, String password, String serverUrl) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_savedUsernameKey, username);
    await prefs.setString(_savedServerKey, serverUrl);
    await _secure.write(key: _savedPasswordKey, value: password);
    savedUsername.value = username;
    savedPassword.value = password;
    savedServerUrl.value = serverUrl;
  }

  static String? _validateServerUrl(String serverUrl) {
    final trimmed = serverUrl.trim();
    if (trimmed.isEmpty) return null;
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      return 'عنوان السيرفر يجب أن يبدأ بـ http:// أو https://';
    }
    try {
      final uri = Uri.parse(trimmed);
      if (uri.host.isEmpty) return 'عنوان السيرفر غير صالح';
    } catch (_) {
      return 'عنوان السيرفر غير صالح';
    }
    return null;
  }

  Future<void> login({
    required String username,
    required String password,
    String? serverUrl,
    String? deviceId,
  }) async {
    isLoading.value = true;
    error.value = '';

    if (serverUrl != null && serverUrl.isNotEmpty) {
      final urlError = _validateServerUrl(serverUrl);
      if (urlError != null) {
        error.value = urlError;
        isLoading.value = false;
        return;
      }
      _api.baseUrl = serverUrl.trim();
    }

    try {
      final body = <String, dynamic>{
        'username': username.trim(),
        'password': password,
      };
      if (deviceId != null) {
        body['deviceId'] = deviceId;
      }

      final json = await _api.post(
        '/api/auth/login',
        body: body,
        authRequired: false,
      ) as Map<String, dynamic>;

      final token = json['token'] as String;
      final user = AuthUser.fromJson(json['user'] as Map<String, dynamic>);
      await _auth.save(token: token, user: user);
      await _saveCredentials(username.trim(), password, serverUrl ?? '');

      isLoggedIn.value = true;
      await AppForegroundService.start();
    } on ApiException catch (e) {
      if (e.statusCode == 403 && e.message.contains('بانتظار الموافقة')) {
        error.value = 'حسابك بانتظار موافقة المسؤول. تواصل مع الإدارة.';
      } else if (e.statusCode == 403 && e.message.contains('pending')) {
        error.value = 'Your account is pending approval. Contact administration.';
      } else {
        error.value = e.message;
      }
    } catch (e) {
      if (kDebugMode) debugPrint('[AUTH] login failed: $e');
      error.value = e.toString().isNotEmpty ? e.toString() : 'Login failed';
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> logout() async {
    await _auth.logout();
    isLoggedIn.value = false;
    await AppForegroundService.stop();
    Get.find<SocketService>().disconnect();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_savedUsernameKey);
    await prefs.remove(_savedPasswordKey);
    await prefs.remove(_savedServerKey);
    await _secure.delete(key: _savedPasswordKey);
    savedUsername.value = '';
    savedPassword.value = '';
    savedServerUrl.value = '';
    _api.baseUrl = '';
  }

  /// Silent re-login using saved credentials. Returns new token or null.
  /// Does not touch UI state (isLoading/error) or navigate.
  Future<String?> tryRefreshToken() async {
    if (!_auth.isLoggedIn) return null;
    final username = savedUsername.value;
    var password = savedPassword.value;
    if (password.isEmpty) {
      password = await _secure.read(key: _savedPasswordKey) ?? '';
    }
    if (username.isEmpty || password.isEmpty) return null;
    try {
      final json = await _api.post(
        '/api/auth/login',
        body: {'username': username.trim(), 'password': password},
        authRequired: false,
      ) as Map<String, dynamic>;
      final token = json['token'] as String;
      final user = AuthUser.fromJson(json['user'] as Map<String, dynamic>);
      await _auth.save(token: token, user: user);
      return token;
    } catch (_) {
      return null;
    }
  }

  String? get token => _auth.token;
  AuthUser? get user => _auth.user;
}
