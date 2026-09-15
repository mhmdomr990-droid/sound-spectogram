import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/api_client.dart';
import '../services/auth_service.dart';

class AuthController extends GetxController {
  final AuthService _auth;
  final ApiClient _api;

  AuthController(this._auth, this._api);

  final isLoggedIn = false.obs;
  final isLoading = false.obs;
  final error = ''.obs;

  static const _savedUsernameKey = 'saved_username';
  static const _savedPasswordKey = 'saved_password';

  final savedUsername = ''.obs;
  final savedPassword = ''.obs;

  @override
  void onInit() {
    super.onInit();
    isLoggedIn.value = _auth.isLoggedIn;
    _loadSavedCredentials();
  }

  Future<void> _loadSavedCredentials() async {
    final prefs = await SharedPreferences.getInstance();
    savedUsername.value = prefs.getString(_savedUsernameKey) ?? '';
    savedPassword.value = prefs.getString(_savedPasswordKey) ?? '';
  }

  Future<void> _saveCredentials(String username, String password) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_savedUsernameKey, username);
    await prefs.setString(_savedPasswordKey, password);
    savedUsername.value = username;
    savedPassword.value = password;
  }

  Future<void> login({
    required String username,
    required String password,
    String? serverUrl,
    String? deviceId,
  }) async {
    if (serverUrl != null && serverUrl.isNotEmpty) {
      _api.baseUrl = serverUrl;
    }

    isLoading.value = true;
    error.value = '';

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
      await _saveCredentials(username.trim(), password);

      isLoggedIn.value = true;
    } on ApiException catch (e) {
      if (e.statusCode == 403 && e.message.contains('بانتظار الموافقة')) {
        error.value = 'حسابك بانتظار موافقة المسؤول. تواصل مع الإدارة.';
      } else if (e.statusCode == 403 && e.message.contains('pending')) {
        error.value = 'Your account is pending approval. Contact administration.';
      } else {
        error.value = e.message;
      }
    } catch (e) {
      error.value = (e as Exception?)?.toString() ?? 'Login failed';
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> logout() async {
    await _auth.logout();
    isLoggedIn.value = false;
  }

  String? get token => _auth.token;
  AuthUser? get user => _auth.user;
}
