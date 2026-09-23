import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../models/device_history.dart';

enum SocketStatus { disconnected, connecting, connected }

enum DeviceStatusSource { ping, telemetry, query }

class DeviceStatusEntry {
  final String deviceId;
  final String internet;
  final double? battery;
  final double? temperature;
  final String? uptime;
  final double? ping;
  final DeviceStatusSource source;

  const DeviceStatusEntry({
    required this.deviceId,
    required this.internet,
    this.battery,
    this.temperature,
    this.uptime,
    this.ping,
    this.source = DeviceStatusSource.query,
  });
}

class SocketService {
  io.Socket? _socket;
  final _onData = StreamController<DeviceHistory>.broadcast();
  final _onStatus = StreamController<SocketStatus>.broadcast();
  final _onDeviceStatus = StreamController<List<DeviceStatusEntry>>.broadcast();

  bool _started = false;
  String _currentBase = '';
  bool _secureConnection = false;

  SocketStatus get status => _socket?.connected == true ? SocketStatus.connected : SocketStatus.disconnected;

  Stream<DeviceHistory> get onData => _onData.stream;
  Stream<SocketStatus> get onStatus => _onStatus.stream;
  Stream<List<DeviceStatusEntry>> get onDeviceStatus => _onDeviceStatus.stream;

  void connect(String serverUrl, {String? token}) {
    final secure = serverUrl.startsWith('https') || serverUrl.startsWith('wss');
    final base = serverUrl.replaceFirst(RegExp(r'^wss?://'), '').replaceFirst(RegExp(r'^https?://'), '').replaceAll(RegExp(r'/$'), '');

    if (base.isEmpty) return;

    if (_started && _currentBase == base && _secureConnection == secure && _socket?.connected == true) return;

    if (_started) {
      _socket?.dispose();
      _socket = null;
    }

    _started = true;
    _currentBase = base;
    _secureConnection = secure;

    final opts = io.OptionBuilder()
        .setTransports(['websocket'])
        .setAuth({'token': token})
        .setReconnectionAttempts(999999)
        .setReconnectionDelay(1000)
        .setReconnectionDelayMax(10000)
        .build();

    final scheme = secure ? 'wss' : 'ws';
    _socket = io.io('$scheme://$base', opts);

    _socket!.onConnect((_) {
      _onStatus.add(SocketStatus.connected);
      _socket!.emit('mobile:subscribe', {});
    });

    _socket!.onDisconnect((_) => _onStatus.add(SocketStatus.disconnected));
    _socket!.onConnectError((_) => _onStatus.add(SocketStatus.disconnected));
    _socket!.onError((_) => _onStatus.add(SocketStatus.disconnected));

    _socket!.on('device:data', (payload) {
      final history = _payloadToHistory(payload);
      if (history != null) {
        _onData.add(history);
      }
    });

    _socket!.on('devices_status', (payload) {
      if (kDebugMode) print('[Socket] devices_status RAW: $payload');
      try {
        final entries = <DeviceStatusEntry>[];
        if (payload is Map && payload['entries'] is List) {
          for (final e in payload['entries']) {
            if (e is Map) {
              entries.add(DeviceStatusEntry(
                deviceId: (e['device_id'] ?? '').toString(),
                internet: (e['internet'] ?? 'DOWN').toString(),
                battery: (e['battery'] as num?)?.toDouble(),
                temperature: (e['temperature'] as num?)?.toDouble(),
                uptime: e['uptime']?.toString(),
                source: DeviceStatusSource.telemetry,
              ));
            }
          }
        }
        if (entries.isNotEmpty) {
          if (kDebugMode) print('[Socket] devices_status parsed: ${entries.map((e) => '${e.deviceId}=${e.internet}').toList()}');
          _onDeviceStatus.add(entries);
        }
      } catch (_) {}
    });

    _socket!.on('device_telemetry_update', (payload) {
      if (kDebugMode) print('[Socket] device_telemetry_update RAW type=${payload.runtimeType}: $payload');
      try {
        if (payload is Map) {
          final rawId = payload['device_id'] ?? payload['deviceId'] ?? payload['id'] ?? '';
          final deviceId = rawId.toString();
          final name = (payload['name'] ?? '').toString();
          final info = DeviceStatusEntry(
            deviceId: deviceId,
            internet: (payload['internet'] ?? 'DOWN').toString(),
            battery: (payload['battery'] as num?)?.toDouble(),
            temperature: (payload['temperature'] as num?)?.toDouble(),
            uptime: payload['uptime']?.toString(),
            source: DeviceStatusSource.telemetry,
          );
          _onDeviceStatus.add([info]);
          if (kDebugMode) print('[Socket] device_telemetry_update parsed: id=$deviceId name=$name internet=${info.internet}');
        }
      } catch (e) {
        if (kDebugMode) print('[Socket] device_telemetry_update ERROR: $e');
      }
    });

    _socket!.on('device_ping_update', (payload) {
      if (kDebugMode) print('[Socket] device_ping_update RAW type=${payload.runtimeType}: $payload');
      try {
        if (payload is Map) {
          final rawId = payload['device_id'] ?? payload['deviceId'] ?? payload['id'] ?? '';
          final deviceId = rawId.toString();
          final status = (payload['status'] ?? '').toString().toLowerCase();
          final ping = (payload['ping'] as num?)?.toDouble();
          final isOnline = status == 'on' || status == 'up' || status == 'online';
          if (kDebugMode) print('[Socket] device_ping_update parsed: id=$deviceId status=$status ping=$ping');
          _onDeviceStatus.add([DeviceStatusEntry(
            deviceId: deviceId,
            internet: isOnline ? 'UP' : 'DOWN',
            ping: ping,
            source: DeviceStatusSource.ping,
          )]);
        } else if (payload is List) {
          final entries = <DeviceStatusEntry>[];
          for (final e in payload) {
            if (e is Map) {
              final rawId = e['device_id'] ?? e['deviceId'] ?? e['id'] ?? '';
              final deviceId = rawId.toString();
              final status = (e['status'] ?? '').toString().toLowerCase();
              final ping = (e['ping'] as num?)?.toDouble();
              final isOnline = status == 'on' || status == 'up' || status == 'online';
              entries.add(DeviceStatusEntry(
                deviceId: deviceId,
                internet: isOnline ? 'UP' : 'DOWN',
                ping: ping,
                source: DeviceStatusSource.ping,
              ));
            }
          }
          if (kDebugMode) print('[Socket] device_ping_update parsed list: ${entries.length} entries');
          if (entries.isNotEmpty) _onDeviceStatus.add(entries);
        }
      } catch (e) {
        if (kDebugMode) print('[Socket] device_ping_update ERROR: $e');
      }
    });

    _socket!.connect();
  }

  DeviceHistory? _payloadToHistory(dynamic payload) {
    if (payload is! Map && payload is! List) {
      if (kDebugMode) print('[Socket] payload ignored: unexpected type ${payload.runtimeType}');
      return null;
    }
    Map<String, dynamic> map;
    if (payload is List && payload.isNotEmpty) {
      map = (payload.first as Map).cast<String, dynamic>();
    } else {
      map = (payload as Map).cast<String, dynamic>();
    }
    try {
      final history = DeviceHistory.fromJson(map);
      if (history.data.isEmpty && kDebugMode) {
        print('[Socket] packet ${history.startTime}-${history.endTime} has EMPTY data matrix');
      }
      return history;
    } catch (e) {
      if (kDebugMode) print('[Socket] payload parse FAILED: $e | keys: ${map.keys.toList()}');
      return null;
    }
  }

  Future<Map<String, dynamic>?> emitCheckAiStatus({
    required int deviceId,
    required String startTime,
    required String endTime,
  }) async {
    if (_socket == null || _socket?.connected != true) return null;

    final completer = Completer<Map<String, dynamic>?>();

    _socket!.emitWithAck('check_ai_status', {
      'deviceId': deviceId,
      'startTime': startTime,
      'endTime': endTime,
    }, ack: (dynamic response) {
      if (!completer.isCompleted) {
        if (response is Map) {
          completer.complete(Map<String, dynamic>.from(response.cast()));
        } else {
          completer.complete(null);
        }
      }
    });

    return completer.future.timeout(
      const Duration(seconds: 10),
      onTimeout: () => null,
    );
  }

  void disconnect() {
    _socket?.dispose();
    _socket = null;
    _started = false;
    _currentBase = '';
    _secureConnection = false;
  }

  /// Dispose the current socket and open a fresh one with [token].
  /// Used when the JWT expired and a new one was obtained.
  void reconnect({String? token}) {
    final base = _currentBase;
    if (base.isEmpty) return;
    final scheme = _secureConnection ? 'wss' : 'ws';
    _socket?.dispose();
    _socket = null;
    _started = false;
    connect('$scheme://$base', token: token);
  }

  void dispose() {
    disconnect();
    _onData.close();
    _onStatus.close();
    _onDeviceStatus.close();
  }

  Future<Map<String, dynamic>?> requestLatestTelemetry() async {
    if (_socket == null || _socket?.connected != true) return null;

    final completer = Completer<Map<String, dynamic>?>();

    _socket!.emitWithAck('mobile:request_latest_telemetry', {}, ack: (dynamic response) {
      if (!completer.isCompleted) {
        if (response is Map) {
          completer.complete(Map<String, dynamic>.from(response.cast()));
        } else {
          completer.complete(null);
        }
      }
    });

    return completer.future.timeout(
      const Duration(seconds: 10),
      onTimeout: () => null,
    );
  }
}
