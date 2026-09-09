import 'dart:async';

import 'package:get/get.dart';

import '../models/device_history.dart';
import '../services/socket_service.dart';

class SocketController extends GetxController {
  final SocketService _socket;

  SocketController(this._socket);

  final status = SocketStatus.disconnected.obs;
  final latestData = Rxn<DeviceHistory>();

  StreamSubscription<SocketStatus>? _statusSub;
  StreamSubscription<DeviceHistory>? _dataSub;

  @override
  void onInit() {
    super.onInit();
    _statusSub = _socket.onStatus.listen((s) => status.value = s);
    _dataSub = _socket.onData.listen((h) => latestData.value = h);
  }

  @override
  void onClose() {
    _statusSub?.cancel();
    _dataSub?.cancel();
    super.onClose();
  }

  void connect(String serverUrl, {String? token}) {
    _socket.connect(serverUrl, token: token);
  }

  Future<Map<String, dynamic>?> emitCheckAiStatus({
    required int deviceId,
    required String startTime,
    required String endTime,
  }) {
    return _socket.emitCheckAiStatus(
      deviceId: deviceId,
      startTime: startTime,
      endTime: endTime,
    );
  }

  void disconnect() => _socket.disconnect();
  void disposeSocket() => _socket.dispose();
}
