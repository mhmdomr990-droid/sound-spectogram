import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../models/device.dart';
import '../models/device_history.dart';
import '../models/marker.dart';
import '../models/range_mode.dart';
import '../services/api_client.dart';
import '../services/auth_service.dart';
import '../services/socket_service.dart';
import '../services/telegram_service.dart';
import '../widgets/spectrogram_canvas.dart';

class DashboardController extends GetxController {
  final ApiClient api;
  final AuthService auth;
  final SocketService socket;

  DashboardController(this.api, this.auth, this.socket);

  final devices = <Device>[].obs;
  final selected = Rxn<Device>();
  final histories = <DeviceHistory>[].obs;
  final markers = <MarkerData>[].obs;
  final liveDataNotifier = ValueNotifier<(List<DeviceHistory>, String?, String?)>((const [], null, null));
  final loadingDevices = true.obs;
  final loadingHistory = false.obs;
  final error = RxnString();
  final socketStatus = SocketStatus.disconnected.obs;
  final gainDb = 0.0.obs;
  final gainNotifier = ValueNotifier<double>(0.0);
  final rangeMode = RangeMode.followLive.obs;
  final followLiveActive = true.obs;
  final liveWindowMinutes = 15.obs;
  final requestStartTime = RxnString();
  final requestEndTime = RxnString();

  final canvasKey = GlobalKey<SpectrogramCanvasState>();

  StreamSubscription<DeviceHistory>? _dataSub;
  StreamSubscription<SocketStatus>? _statusSub;
  final _pendingLivePackets = <DeviceHistory>[];
  final _historyKeys = <String>{};
  Timer? _pollTimer;

  @override
  void onInit() {
    super.onInit();
    _bindSocket();
    _loadDevices();
  }

  @override
  void onClose() {
    gainNotifier.dispose();
    liveDataNotifier.dispose();
    _pollTimer?.cancel();
    _dataSub?.cancel();
    _statusSub?.cancel();
    super.onClose();
  }

  void _bindSocket() {
    _statusSub = socket.onStatus.listen((s) {
      socketStatus.value = s;
      _onSocketStatusChanged(s);
    });
    _dataSub = socket.onData.listen((h) {
      if (!followLiveActive.value || selected.value == null) return;
      if (h.deviceId != selected.value!.id) return;
      final key = '${h.deviceId}|${h.startTime}|${h.endTime}';
      if (_historyKeys.contains(key)) return;
      if (loadingHistory.value) {
        _historyKeys.add(key);
        _pendingLivePackets.add(h);
        return;
      }
      _historyKeys.add(key);
      insertPacketLive(h);
    });
    socket.connect(_hostFromApi(), token: auth.token);
  }

  void _onSocketStatusChanged(SocketStatus s) async {
    final enabled = await TelegramService.isEnabled();
    if (!enabled) return;
    if (s == SocketStatus.connected) {
      TelegramService.sendConnectionAlert('connected');
    } else if (s == SocketStatus.disconnected) {
      TelegramService.sendConnectionAlert('disconnected');
    }
  }

  void insertPacketLive(DeviceHistory h) {
    if (h.aiStatus == AiStatus.detected) {
      TelegramService.isEnabled().then((on) {
        if (on) {
          TelegramService.sendAlert(
            device: selected.value?.name ?? 'Unknown',
            status: 'detected',
            confidence: h.confidence?.toStringAsFixed(1) ?? 'N/A',
            time: h.endTime ?? h.startTime ?? '',
          );
        }
      });
    }
    histories.add(h);
    histories.sort((a, b) {
      final aStart = DateTime.tryParse(a.startTime ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0);
      final bStart = DateTime.tryParse(b.startTime ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0);
      return aStart.compareTo(bStart);
    });
    final cutoff = DateTime.now().subtract(Duration(minutes: liveWindowMinutes.value));
    histories.removeWhere((e) {
      final end = DateTime.tryParse(e.endTime ?? '');
      return end != null ? !end.isAfter(cutoff) : false;
    });
    final lastEnd = histories.isNotEmpty ? histories.last.endTime : null;
    final anchor = lastEnd != null ? DateTime.tryParse(lastEnd) ?? DateTime.now() : DateTime.now();
    requestStartTime.value = anchor.subtract(Duration(minutes: liveWindowMinutes.value)).toIso8601String();
    requestEndTime.value = anchor.toIso8601String();
    liveDataNotifier.value = (List.unmodifiable(histories), requestStartTime.value, requestEndTime.value);
    canvasKey.currentState?.forceRender();
  }

  String _apiHost() => api.baseUrl.replaceFirst(RegExp(r'^https?://'), '');
  String _hostFromApi() {
    final base = _apiHost().replaceAll(RegExp(r'/$'), '');
    return 'ws://$base';
  }

  Future<void> _loadDevices() async {
    loadingDevices.value = true;
    error.value = null;
    try {
      final result = await api.fetchDevices();
      devices.value = result;
      loadingDevices.value = false;
      if (result.isNotEmpty && selected.value == null) {
        selected.value = result.first;
      }
      if (selected.value != null) {
        await loadRange();
      }
    } on Exception catch (e) {
      loadingDevices.value = false;
      error.value = e.toString();
    }
  }

  Future<void> loadRange() async {
    final device = selected.value;
    if (device == null) return;
    if (rangeMode.value == RangeMode.followLive) {
      setFollowLive();
      return;
    }
    loadingHistory.value = true;
    error.value = null;
    try {
      List<DeviceHistory> result;
      switch (rangeMode.value) {
        case RangeMode.latestPacket:
          result = [await api.fetchLatest('/devices/', device.id)];
          break;
        case RangeMode.lastHour:
          final to = DateTime.now();
          final from = to.subtract(const Duration(hours: 1));
          result = await api.fetchHistory(device.id, from: from, to: to);
          break;
        case RangeMode.last5h:
          final to = DateTime.now();
          final from = to.subtract(const Duration(hours: 2));
          result = await api.fetchHistory(device.id, from: from, to: to);
          break;
        case RangeMode.last24h:
          final to = DateTime.now();
          final from = to.subtract(const Duration(hours: 24));
          result = await api.fetchHistory(device.id, from: from, to: to);
          break;
        case RangeMode.custom:
          result = await api.fetchHistory(device.id);
          break;
        case RangeMode.followLive:
          result = [];
          break;
      }
      histories.value = result;
      loadingHistory.value = false;
      if (result.isNotEmpty) {
        requestStartTime.value = result.first.startTime;
        requestEndTime.value = result.last.endTime;
      } else {
        requestStartTime.value = null;
        requestEndTime.value = null;
      }
      liveDataNotifier.value = (List.unmodifiable(histories), requestStartTime.value, requestEndTime.value);
    } on Exception catch (e) {
      error.value = e.toString();
      loadingHistory.value = false;
    }
  }

  void selectDevice(Device d) {
    if (selected.value?.id == d.id) return;
    selected.value = d;
    histories.clear();
    loadRange();
  }

  Future<void> pickCustomRange(BuildContext context) async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: now.subtract(const Duration(days: 365)),
      lastDate: now,
    );
    if (date == null) return;

    final timeFrom = await showTimePicker(context: context, initialTime: TimeOfDay(hour: 0, minute: 0));
    if (timeFrom == null) return;
    final timeTo = await showTimePicker(context: context, initialTime: TimeOfDay(hour: 23, minute: 59));
    if (timeTo == null) return;

    final from = DateTime(date.year, date.month, date.day, timeFrom.hour, timeFrom.minute, 0);
    final to = DateTime(date.year, date.month, date.day, timeTo.hour, timeTo.minute, 59);
    if (to.isBefore(from)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('وقت النهاية يجب أن يكون بعد وقت البداية')),
      );
      return;
    }
    if (to.difference(from) > const Duration(hours: 2)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('النطاق الأقصى ساعتان')),
      );
      return;
    }

    _stopPolling();
    rangeMode.value = RangeMode.custom;
    final device = selected.value;
    if (device == null) return;
    loadingHistory.value = true;
    error.value = null;
    try {
      final result = await api.fetchHistory(device.id, from: from, to: to);
      histories.value = result;
      loadingHistory.value = false;
      requestStartTime.value = from.toIso8601String();
      requestEndTime.value = to.toIso8601String();
      liveDataNotifier.value = (List.unmodifiable(histories), requestStartTime.value, requestEndTime.value);
    } on Exception catch (e) {
      error.value = e.toString();
      loadingHistory.value = false;
    }
  }

  Future<void> setFollowLive() async {
    final device = selected.value;
    if (device == null) return;
    final to = DateTime.now();
    final from = to.subtract(Duration(minutes: liveWindowMinutes.value));
    loadingHistory.value = true;
    rangeMode.value = RangeMode.followLive;
    followLiveActive.value = true;
    error.value = null;
    requestStartTime.value = from.toIso8601String();
    requestEndTime.value = to.toIso8601String();
    try {
      final result = await api.fetchHistory(device.id, from: from, to: to);
      histories.value = result;
      _historyKeys
        ..clear()
        ..addAll(result.map((e) => '${e.deviceId}|${e.startTime}|${e.endTime}'));
      if (_pendingLivePackets.isNotEmpty) {
        for (final p in _pendingLivePackets) {
          final pk = '${p.deviceId}|${p.startTime}|${p.endTime}';
          if (!_historyKeys.contains(pk)) {
            histories.add(p);
            _historyKeys.add(pk);
          }
        }
        _pendingLivePackets.clear();
      }
      if (histories.isNotEmpty) {
        final lastEnd = histories.last.endTime;
        final anchor = lastEnd != null ? DateTime.tryParse(lastEnd) ?? DateTime.now() : DateTime.now();
        requestStartTime.value = anchor.subtract(Duration(minutes: liveWindowMinutes.value)).toIso8601String();
        requestEndTime.value = anchor.toIso8601String();
      }
      loadingHistory.value = false;
      liveDataNotifier.value = (List.unmodifiable(histories), requestStartTime.value, requestEndTime.value);
      _startPolling();
    } on Exception catch (e) {
      error.value = e.toString();
      loadingHistory.value = false;
      followLiveActive.value = false;
      _stopPolling();
    }
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 8), (_) => _pollLatest());
  }

  void _stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  Future<void> _pollLatest() async {
    final device = selected.value;
    if (!followLiveActive.value || device == null || loadingHistory.value) return;
    try {
      final h = await api.fetchLatest('/devices/', device.id);
      if (!followLiveActive.value) return;
      final key = '${h.deviceId}|${h.startTime}|${h.endTime}';
      if (_historyKeys.contains(key)) return;
      _historyKeys.add(key);
      insertPacketLive(h);
    } on Exception {
      // Ignore polling errors silently
    }
  }

  void setRange(RangeMode mode) {
    if (rangeMode.value == mode && mode != RangeMode.followLive) return;
    if (mode == RangeMode.followLive) {
      setFollowLive();
      return;
    }
    _stopPolling();
    rangeMode.value = mode;
    followLiveActive.value = false;
    histories.clear();
    _historyKeys.clear();
    requestStartTime.value = null;
    requestEndTime.value = null;
    loadRange();
  }

  void updateGain(double v) {
    gainDb.value = v;
    gainNotifier.value = v;
  }

  void addMarker(int timeMs) {
    markers.add(MarkerData(timeMs: timeMs));
  }

  void removeMarker(int index) {
    markers.removeAt(index);
  }

  void moveMarker(int index, int newTimeMs) {
    markers[index] = MarkerData(timeMs: newTimeMs);
  }

  void clearMarkers() {
    markers.clear();
  }
}
