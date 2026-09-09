import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/device.dart';
import '../models/device_history.dart';
import 'auth_service.dart';

class ApiException implements Exception {
  final int statusCode;
  final String message;

  const ApiException(this.statusCode, this.message);

  @override
  String toString() => message;
}

class ApiClient {
  String baseUrl;
  final AuthService auth;

  http.Client? _client;

  ApiClient(this.baseUrl, this.auth);

  http.Client get _http => _client ??= http.Client();

  Map<String, String> _headers({bool authRequired = true}) {
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (authRequired) {
      final token = auth.token;
      if (token != null) {
        headers['Authorization'] = 'Bearer $token';
      }
    }
    return headers;
  }

  Uri _uri(String path, {Map<String, String>? query}) {
    final base = baseUrl.endsWith('/') ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl;
    var uri = Uri.parse('$base$path');
    if (query != null && query.isNotEmpty) {
      uri = uri.replace(queryParameters: query);
    }
    return uri;
  }

  Future<dynamic> _decodeResponse(http.Response response) async {
    final status = response.statusCode;
    if (status < 200 || status >= 300) {
      String message = 'Request failed ($status)';
      try {
        final body = jsonDecode(response.body);
        message = (body is Map && body['message'] != null) ? body['message'].toString() : message;
      } catch (_) {}
      throw ApiException(status, message);
    }
    if (response.body.isEmpty) {
      return null;
    }
    try {
      return jsonDecode(response.body);
    } catch (_) {
      return response.body;
    }
  }

  Future<dynamic> get(String path, {Map<String, String>? query, bool authRequired = true}) async {
    final response = await _http.get(_uri(path, query: query), headers: _headers(authRequired: authRequired));
    return _decodeResponse(response);
  }

  Future<dynamic> post(String path, {Map<String, dynamic>? body, bool authRequired = true}) async {
    final response = await _http.post(
      _uri(path),
      headers: _headers(authRequired: authRequired),
      body: body == null ? null : jsonEncode(body),
    );
    return _decodeResponse(response);
  }

  Future<List<Device>> fetchDevices() async {
    final json = await get('/api/devices') as List? ?? [];
    return json.map((e) => Device.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<DeviceHistory> fetchLatest(String baseUrlPath, int deviceId) async {
    final query = <String, String>{'decode': '1'};
    final json = await get('/api$baseUrlPath$deviceId/history/latest', query: query);
    return DeviceHistory.fromJson(json as Map<String, dynamic>);
  }

  Future<List<DeviceHistory>> fetchHistory(int deviceId, {DateTime? from, DateTime? to}) async {
    final query = <String, String>{};
    if (from != null && to != null) {
      query['from'] = _formatNaive(from);
      query['to'] = _formatNaive(to);
    }
    final json = await get('/api/devices/$deviceId/history', query: query) as List? ?? [];
    return json.map((e) => DeviceHistory.fromJson(e as Map<String, dynamic>)).toList();
  }

  static String _formatNaive(DateTime dt) {
    final local = dt.toLocal();
    String two(int v) => v.toString().padLeft(2, '0');
    return '${local.year}-${two(local.month)}-${two(local.day)}T${two(local.hour)}:${two(local.minute)}:${two(local.second)}';
  }
}
