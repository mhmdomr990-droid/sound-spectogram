import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../models/device_history.dart';

enum SocketStatus { disconnected, connecting, connected }

class DeviceStatusEntry {
  final String deviceId;
  final String internet;
  final double? battery;
  final double? temperature;
  final String? uptime;

  const DeviceStatusEntry({
    required this.deviceId,
    required this.internet,
    this.battery,
    this.temperature,
    this.uptime,
  });
}

class SocketService {
  io.Socket? _socket;
  final _onData = StreamController<DeviceHistory>.broadcast();
  final _onStatus = StreamController<SocketStatus>.broadcast();
  final _onDeviceStatus = StreamController<List<DeviceStatusEntry>>.broadcast();

  bool _started = false;

  SocketStatus get status => _socket?.connected == true ? SocketStatus.connected : SocketStatus.disconnected;

  Stream<DeviceHistory> get onData => _onData.stream;
  Stream<SocketStatus> get onStatus => _onStatus.stream;
  Stream<List<DeviceStatusEntry>> get onDeviceStatus => _onDeviceStatus.stream;

  void connect(String serverUrl, {String? token}) {
    if (_started) {
      return;
    }
    _started = true;

    final base = serverUrl.replaceFirst(RegExp(r'^wss?://'), '').replaceFirst(RegExp(r'^https?://'), '').replaceAll(RegExp(r'/$'), '');

    final opts = io.OptionBuilder()
        .setTransports(['websocket'])
        .setAuth({'token': token})
        .build();

    _socket = io.io('ws://$base', opts);

    _socket!.onConnect((_) {
      _onStatus.add(SocketStatus.connected);
      _socket!.emit('device:subscribe', {});
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
      print('[Socket] devices_status RAW: $payload');
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
              ));
            }
          }
        }
        if (entries.isNotEmpty) {
          print('[Socket] devices_status parsed: ${entries.map((e) => '${e.deviceId}=${e.internet}').toList()}');
          _onDeviceStatus.add(entries);
        }
      } catch (_) {}
    });

    _socket!.on('device_telemetry_update', (payload) {
      print('[Socket] device_telemetry_update RAW: $payload');
      try {
        if (payload is Map) {
          _onDeviceStatus.add([DeviceStatusEntry(
            deviceId: (payload['device_id'] ?? '').toString(),
            internet: (payload['internet'] ?? 'DOWN').toString(),
            battery: (payload['battery'] as num?)?.toDouble(),
            temperature: (payload['temperature'] as num?)?.toDouble(),
            uptime: payload['uptime']?.toString(),
          )]);
        }
      } catch (_) {}
    });

    _socket!.connect();
  }

  DeviceHistory? _payloadToHistory(dynamic payload) {
    if (payload is! Map && payload is! List) {
      print('[Socket] payload ignored: unexpected type ${payload.runtimeType}');
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
      if (history.data.isEmpty) {
        print('[Socket] packet ${history.startTime}-${history.endTime} has EMPTY data matrix');
      }
      return history;
    } catch (e) {
      print('[Socket] payload parse FAILED: $e | keys: ${map.keys.toList()}');
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
