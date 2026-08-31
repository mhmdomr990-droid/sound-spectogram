import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../models/device_history.dart';

enum SocketStatus { disconnected, connecting, connected }

class SocketService {
  io.Socket? _socket;
  final _onData = StreamController<DeviceHistory>.broadcast();
  final _onStatus = StreamController<SocketStatus>.broadcast();

  bool _started = false;

  SocketStatus get status => _socket?.connected == true ? SocketStatus.connected : SocketStatus.disconnected;

  Stream<DeviceHistory> get onData => _onData.stream;
  Stream<SocketStatus> get onStatus => _onStatus.stream;

  void connect(String serverUrl) {
    if (_started) {
      return;
    }
    _started = true;

    final base = serverUrl.replaceFirst(RegExp(r'^https?://'), '').replaceAll(RegExp(r'/$'), '');

    _socket = io.io(
      'ws://$base',
      io.OptionBuilder()
          .setTransports(['websocket'])
          .build(),
    );

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

    _socket!.connect();
  }

  DeviceHistory? _payloadToHistory(dynamic payload) {
    if (payload is! Map && payload is! List) {
      return null;
    }
    Map<String, dynamic> map;
    if (payload is List && payload.isNotEmpty) {
      map = (payload.first as Map).cast<String, dynamic>();
    } else {
      map = (payload as Map).cast<String, dynamic>();
    }
    // Broadcast payloads may nest fields under 'data' along with a real matrix.
    try {
      return DeviceHistory.fromJson(map);
    } catch (_) {
      return null;
    }
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
  }
}
