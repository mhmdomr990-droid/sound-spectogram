import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/device.dart';
import '../models/device_history.dart';
import '../models/marker.dart';
import '../models/range_mode.dart';
import '../services/api_client.dart';
import '../services/auth_service.dart';
import '../services/socket_service.dart';
import '../widgets/spectrogram_canvas.dart';

class DeviceStatusInfo {
  String? internet;
  double? battery;
  double? temperature;
  String? uptime;
  DeviceStatusInfo({this.internet, this.battery, this.temperature, this.uptime});
}

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
  final deviceStatusMap = <String, DeviceStatusInfo>{}.obs;

  final canvasKey = GlobalKey<SpectrogramCanvasState>();

  StreamSubscription<DeviceHistory>? _dataSub;
  StreamSubscription<SocketStatus>? _statusSub;
  StreamSubscription<List<DeviceStatusEntry>>? _deviceStatusSub;
  final _pendingLivePackets = <DeviceHistory>[];
  final _historyKeys = <String>{};
  Timer? _pollTimer;
  Timer? _telemetryTimer;

  @override
  void onInit() {
    super.onInit();
    _loadDeviceStatus();
    _bindSocket();
    _loadDevices();
    _telemetryTimer = Timer.periodic(const Duration(seconds: 60), (_) => _fetchLatestTelemetry());
  }

  @override
  void onClose() {
    gainNotifier.dispose();
    liveDataNotifier.dispose();
    _pollTimer?.cancel();
    _telemetryTimer?.cancel();
    _dataSub?.cancel();
    _statusSub?.cancel();
    _deviceStatusSub?.cancel();
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
      if (h.data.isEmpty) {
        _fetchAndInsertPacket(h);
        return;
      }
      insertPacketLive(h);
    });
    _deviceStatusSub = socket.onDeviceStatus.listen((entries) {
      for (final e in entries) {
        final info = deviceStatusMap[e.deviceId] ?? DeviceStatusInfo();
        if (e.source == DeviceStatusSource.ping) {
          info.internet = e.internet;
        }
        info.battery = e.battery;
        info.temperature = e.temperature;
        info.uptime = e.uptime;
        deviceStatusMap[e.deviceId] = info;
        final name = _deviceNameFromId(e.deviceId);
        if (name != null) deviceStatusMap[name] = info;
      }
      deviceStatusMap.refresh();
      _saveDeviceStatus();
    });
    socket.connect(_hostFromApi(), token: auth.token);
  }

  void _onSocketStatusChanged(SocketStatus s) {
    if (s == SocketStatus.connected) {
      _fetchLatestTelemetry();
    }
  }

  void _fetchLatestTelemetry() async {
    final response = await socket.requestLatestTelemetry();
    if (response == null || response['ok'] != true) return;
    final snapshot = response['snapshot'];
    if (snapshot is! Map) return;
    for (final entry in snapshot.entries) {
      final deviceId = entry.key.toString();
      final data = entry.value;
      if (data is! Map) continue;
      final name = (data['name'] ?? '').toString();
      final temperature = (data['temperature'] as num?)?.toDouble();
      final battery = (data['battery'] as num?)?.toDouble();
      final uptime = data['uptime']?.toString();
      final info = deviceStatusMap[deviceId] ?? DeviceStatusInfo();
      info.battery = battery;
      info.temperature = temperature;
      info.uptime = uptime;
      deviceStatusMap[deviceId] = info;
      if (name.isNotEmpty) {
        deviceStatusMap[name] = info;
      }
    }
    deviceStatusMap.refresh();
    _saveDeviceStatus();
  }

  static const _deviceStatusKey = 'device_status_map';

  String? _deviceNameFromId(String deviceId) {
    final id = int.tryParse(deviceId);
    if (id == null) return null;
    for (final d in devices) {
      if (d.id == id) return d.name;
    }
    return null;
  }

  Future<void> _saveDeviceStatus() async {
    final prefs = await SharedPreferences.getInstance();
    final map = <String, dynamic>{};
    for (final e in deviceStatusMap.entries) {
      map[e.key] = {
        'internet': e.value.internet,
        'battery': e.value.battery,
        'temperature': e.value.temperature,
        'uptime': e.value.uptime,
      };
    }
    await prefs.setString(_deviceStatusKey, jsonEncode(map));
  }

  Future<void> _loadDeviceStatus() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_deviceStatusKey);
      if (raw == null) return;
      final map = jsonDecode(raw) as Map<String, dynamic>;
      for (final e in map.entries) {
        final v = e.value as Map<String, dynamic>;
        deviceStatusMap[e.key] = DeviceStatusInfo(
          internet: v['internet']?.toString(),
          battery: (v['battery'] as num?)?.toDouble(),
          temperature: (v['temperature'] as num?)?.toDouble(),
          uptime: v['uptime']?.toString(),
        );
      }
      deviceStatusMap.refresh();
    } catch (_) {}
  }

  void insertPacketLive(DeviceHistory h) {
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
    final windowStart = anchor.subtract(Duration(minutes: liveWindowMinutes.value));
    final firstDataStart = histories.isNotEmpty ? DateTime.tryParse(histories.first.startTime ?? '') : null;
    final adjustedStart = (firstDataStart != null && firstDataStart.isAfter(windowStart)) ? firstDataStart : windowStart;
    requestStartTime.value = adjustedStart.toIso8601String();
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
      if (result.isNotEmpty) {
        requestStartTime.value = result.first.startTime;
        requestEndTime.value = result.last.endTime;
      } else {
        requestStartTime.value = from.toIso8601String();
        requestEndTime.value = to.toIso8601String();
      }
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
        final windowStart = anchor.subtract(Duration(minutes: liveWindowMinutes.value));
        final firstDataStart = histories.isNotEmpty ? DateTime.tryParse(histories.first.startTime ?? '') : null;
        final adjustedStart = (firstDataStart != null && firstDataStart.isAfter(windowStart)) ? firstDataStart : windowStart;
        requestStartTime.value = adjustedStart.toIso8601String();
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

  Future<void> _fetchAndInsertPacket(DeviceHistory h) async {
    final device = selected.value;
    if (device == null) return;
    try {
      final start = DateTime.tryParse(h.startTime ?? '');
      final end = DateTime.tryParse(h.endTime ?? '');
      if (start == null || end == null) return;
      final result = await api.fetchHistory(device.id, from: start, to: end);
      final match = result.where((r) =>
        r.startTime == h.startTime && r.endTime == h.endTime && r.data.isNotEmpty
      ).toList();
      if (match.isNotEmpty) {
        _historyKeys.remove('${h.deviceId}|${h.startTime}|${h.endTime}');
        _historyKeys.add('${match.first.deviceId}|${match.first.startTime}|${match.first.endTime}');
        insertPacketLive(match.first);
      }
    } on Exception catch (_) {
    }
  }

  double _calculateCoverage(List<DeviceHistory> packets, DateTime from, DateTime to) {
    if (packets.isEmpty) return 0.0;
    final totalMs = to.difference(from).inMilliseconds;
    if (totalMs <= 0) return 0.0;
    final ranges = <({int start, int end})>[];
    for (final p in packets) {
      final s = DateTime.tryParse(p.startTime ?? '');
      final e = DateTime.tryParse(p.endTime ?? '');
      if (s == null || e == null) continue;
      final sMs = s.millisecondsSinceEpoch.clamp(from.millisecondsSinceEpoch, to.millisecondsSinceEpoch);
      final eMs = e.millisecondsSinceEpoch.clamp(from.millisecondsSinceEpoch, to.millisecondsSinceEpoch);
      if (eMs > sMs) ranges.add((start: sMs, end: eMs));
    }
    if (ranges.isEmpty) return 0.0;
    ranges.sort((a, b) => a.start.compareTo(b.start));
    int covered = 0;
    int lastEnd = from.millisecondsSinceEpoch;
    for (final r in ranges) {
      if (r.start > lastEnd) covered += r.start - lastEnd;
      if (r.end > lastEnd) lastEnd = r.end;
    }
    if (lastEnd < to.millisecondsSinceEpoch) covered += to.millisecondsSinceEpoch - lastEnd;
    return (to.millisecondsSinceEpoch - from.millisecondsSinceEpoch - covered) / totalMs;
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
      final now = DateTime.now();
      final from = now.subtract(Duration(minutes: liveWindowMinutes.value));
      final result = await api.fetchHistory(device.id, from: from, to: now);
      if (!followLiveActive.value) return;
      for (final h in result) {
        final key = '${h.deviceId}|${h.startTime}|${h.endTime}';
        if (_historyKeys.contains(key)) continue;
        _historyKeys.add(key);
        if (h.data.isEmpty) {
          _fetchAndInsertPacket(h);
          continue;
        }
        insertPacketLive(h);
      }
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
    _pendingLivePackets.clear();
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
