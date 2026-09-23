import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

class AuthUser {
  final int id;
  final String name;
  final String username;
  final String role;

  const AuthUser({
    required this.id,
    required this.name,
    required this.username,
    required this.role,
  });

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: (json['id'] as num).toInt(),
      name: json['name'] as String? ?? '',
      username: json['username'] as String? ?? '',
      role: json['role'] as String? ?? '',
    );
  }
}

class AuthService {
  static const _tokenKey = 'auth_token';
  static const _userKey = 'auth_user';
  static const FlutterSecureStorage _secure = FlutterSecureStorage();

  String? _token;
  AuthUser? _user;

  String? get token => _token;
  AuthUser? get user => _user;
  bool get isLoggedIn => _token != null && _token!.isNotEmpty;

  /// Returns JWT `exp` as DateTime, or null if missing/invalid.
  DateTime? get tokenExpiry {
    final t = _token;
    if (t == null || t.isEmpty) return null;
    try {
      final parts = t.split('.');
      if (parts.length != 3) return null;
      final normalized = base64Url.normalize(parts[1]);
      final map = jsonDecode(utf8.decode(base64Url.decode(normalized))) as Map<String, dynamic>;
      final exp = map['exp'];
      if (exp is num) return DateTime.fromMillisecondsSinceEpoch(exp.toInt() * 1000);
    } catch (_) {}
    return null;
  }

  /// True when the token expires within [margin] (default 5 minutes) or is already expired.
  bool isTokenExpiringSoon({Duration margin = const Duration(minutes: 5)}) {
    final exp = tokenExpiry;
    if (exp == null) return false;
    return !DateTime.now().isBefore(exp.subtract(margin));
  }

  Future<void> load() async {
    _token = await _secure.read(key: _tokenKey);
    var userJson = await _secure.read(key: _userKey);

    final prefs = await SharedPreferences.getInstance();
    // Migrate legacy plaintext values from SharedPreferences → secure storage.
    final legacyToken = prefs.getString(_tokenKey);
    if (_token == null && legacyToken != null && legacyToken.isNotEmpty) {
      _token = legacyToken;
      await _secure.write(key: _tokenKey, value: legacyToken);
    }
    final legacyUser = prefs.getString(_userKey);
    if (userJson == null && legacyUser != null && legacyUser.isNotEmpty) {
      userJson = legacyUser;
      await _secure.write(key: _userKey, value: legacyUser);
    }
    if (legacyToken != null || legacyUser != null) {
      await prefs.remove(_tokenKey);
      await prefs.remove(_userKey);
    }

    if (userJson != null) {
      try {
        _user = AuthUser.fromJson(jsonDecode(userJson) as Map<String, dynamic>);
      } catch (_) {
        _user = null;
      }
    }
  }

  Future<void> save({required String token, required AuthUser user}) async {
    _token = token;
    _user = user;
    await _secure.write(key: _tokenKey, value: token);
    await _secure.write(key: _userKey, value: jsonEncode({
      'id': user.id,
      'name': user.name,
      'username': user.username,
      'role': user.role,
    }));
  }

  Future<void> logout() async {
    _token = null;
    _user = null;
    await _secure.delete(key: _tokenKey);
    await _secure.delete(key: _userKey);
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
    await prefs.remove(_userKey);
  }
}
