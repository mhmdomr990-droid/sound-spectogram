import 'dart:async';

import 'package:flutter/material.dart';

import '../models/device.dart';
import '../models/device_history.dart';
import '../services/api_client.dart';
import '../services/auth_service.dart';
import '../services/socket_service.dart';
import '../utils/test_data.dart';
import '../widgets/spectrogram_canvas.dart';
import 'fullscreen_spectrogram.dart';

enum _RangeMode { latestPacket, lastHour, last5h, last24h, followLive, custom, test }

class DashboardScreen extends StatefulWidget {
  final ApiClient api;
  final AuthService auth;
  final SocketService socket;
  final bool startInTestMode;

  const DashboardScreen({
    super.key,
    required this.api,
    required this.auth,
    required this.socket,
    this.startInTestMode = false,
  });

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  List<Device> _devices = [];
  Device? _selected;
  List<DeviceHistory> _histories = [];
  final ValueNotifier<(List<DeviceHistory>, String?, String?)> _liveDataNotifier = ValueNotifier((const [], null, null));
  bool _loadingDevices = true;
  bool _loadingHistory = false;
  String? _error;
  SocketStatus _socketStatus = SocketStatus.disconnected;
  double _gainDb = 0.0;
  final ValueNotifier<double> _gainNotifier = ValueNotifier<double>(0.0);
  _RangeMode _rangeMode = _RangeMode.followLive;
  bool _followLiveActive = true;
  int _liveWindowMinutes = 15;
  String? _requestStartTime;
  String? _requestEndTime;
  final _canvasKey = GlobalKey<SpectrogramCanvasState>();

  StreamSubscription<DeviceHistory>? _dataSub;
  StreamSubscription<SocketStatus>? _statusSub;
  final List<DeviceHistory> _pendingLivePackets = [];
  final Set<String> _historyKeys = {};
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    if (widget.startInTestMode) {
      _setTestMode();
    } else {
      _bindSocket();
      _loadDevices();
    }
  }

  @override
  void dispose() {
    _gainNotifier.dispose();
    _liveDataNotifier.dispose();
    _pollTimer?.cancel();
    _dataSub?.cancel();
    _statusSub?.cancel();
    super.dispose();
  }

  void _bindSocket() {
    _statusSub = widget.socket.onStatus.listen((s) {
      if (mounted) setState(() => _socketStatus = s);
    });
    _dataSub = widget.socket.onData.listen((h) {
      if (!mounted || !_followLiveActive || _selected == null) return;
      if (h.deviceId != _selected!.id) return;
      final key = '${h.deviceId}|${h.startTime}|${h.endTime}';
      if (_historyKeys.contains(key)) return;
      if (_loadingHistory) {
        _historyKeys.add(key);
        _pendingLivePackets.add(h);
        return;
      }
      _historyKeys.add(key);
      _insertPacketLive(h);
    });
    widget.socket.connect(_hostFromApi(), token: widget.auth.token);
  }

  void _insertPacketLive(DeviceHistory h) {
    final newHistories = [..._histories, h]..sort((a, b) {
        final aStart = DateTime.tryParse(a.startTime ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0);
        final bStart = DateTime.tryParse(b.startTime ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0);
        return aStart.compareTo(bStart);
      });
    final cutoff = DateTime.now().subtract(Duration(minutes: _liveWindowMinutes));
    final filtered = newHistories.where((e) {
      final end = DateTime.tryParse(e.endTime ?? '');
      return end != null ? end.isAfter(cutoff) : true;
    }).toList();
    final lastEnd = filtered.isNotEmpty ? filtered.last.endTime : null;
    final anchor = lastEnd != null ? DateTime.tryParse(lastEnd) ?? DateTime.now() : DateTime.now();
    setState(() {
      _histories = filtered;
      _requestStartTime = anchor.subtract(Duration(minutes: _liveWindowMinutes)).toIso8601String();
      _requestEndTime = anchor.toIso8601String();
    });
    _liveDataNotifier.value = (List.unmodifiable(filtered), _requestStartTime, _requestEndTime);
    _canvasKey.currentState?.forceRender();
  }

  String _apiHost() => widget.api.baseUrl.replaceFirst(RegExp(r'^https?://'), '');
  String _hostFromApi() {
    final base = _apiHost().replaceAll(RegExp(r'/$'), '');
    return 'ws://$base';
  }

  Future<void> _loadDevices() async {
    setState(() {
      _loadingDevices = true;
      _error = null;
    });
    try {
      final devices = await widget.api.fetchDevices();
      if (!mounted) return;
      setState(() {
        _devices = devices;
        _loadingDevices = false;
        if (devices.isNotEmpty && _selected == null) {
          _selected = devices.first;
        }
      });
      if (_selected != null) {
        await _loadRange();
      }
    } on Exception catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingDevices = false;
        _error = e.toString();
      });
    }
  }

  Future<void> _loadRange() async {
    final device = _selected;
    if (device == null) {
      return;
    }
    if (_rangeMode == _RangeMode.followLive) {
      _setFollowLive();
      return;
    }
    setState(() {
      _loadingHistory = true;
      _error = null;
    });
    try {
      List<DeviceHistory> result;
      switch (_rangeMode) {
        case _RangeMode.latestPacket:
          result = [await widget.api.fetchLatest('/devices/', device.id)];
          break;
        case _RangeMode.lastHour:
          final to = DateTime.now();
          final from = to.subtract(const Duration(hours: 1));
          result = await widget.api.fetchHistory(device.id, from: from, to: to);
          break;
        case _RangeMode.last5h:
          final to = DateTime.now();
          final from = to.subtract(const Duration(hours: 5));
          result = await widget.api.fetchHistory(device.id, from: from, to: to);
          break;
        case _RangeMode.last24h:
          final to = DateTime.now();
          final from = to.subtract(const Duration(hours: 24));
          result = await widget.api.fetchHistory(device.id, from: from, to: to);
          break;
        case _RangeMode.custom:
          result = await widget.api.fetchHistory(device.id);
          break;
        case _RangeMode.followLive:
          result = [];
          break;
        case _RangeMode.test:
          result = [];
          break;
      }
      if (!mounted) return;
      setState(() {
        _histories = result;
        _loadingHistory = false;
      });
      if (result.isNotEmpty) {
        _requestStartTime = result.first.startTime;
        _requestEndTime = result.last.endTime;
      } else {
        _requestStartTime = null;
        _requestEndTime = null;
      }
      _liveDataNotifier.value = (List.unmodifiable(_histories), _requestStartTime, _requestEndTime);
    } on Exception catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loadingHistory = false;
      });
    }
  }

  void _selectDevice(Device d) {
    if (_selected?.id == d.id) return;
    setState(() {
      _selected = d;
      _histories = const [];
    });
    _loadRange();
  }

  Future<void> _pickCustomRange() async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: now.subtract(const Duration(days: 365)),
      lastDate: now,
    );
    if (date == null || !mounted) return;

    final timeFrom = await showTimePicker(context: context, initialTime: TimeOfDay(hour: 0, minute: 0));
    if (timeFrom == null || !mounted) return;
    final timeTo = await showTimePicker(context: context, initialTime: TimeOfDay(hour: 23, minute: 59));
    if (timeTo == null || !mounted) return;

    final from = DateTime(
      date.year, date.month, date.day,
      timeFrom.hour, timeFrom.minute, 0,
    );
    final to = DateTime(
      date.year, date.month, date.day,
      timeTo.hour, timeTo.minute, 59,
    );
    if (to.isBefore(from)) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('وقت النهاية يجب أن يكون بعد وقت البداية')),
      );
      return;
    }

    setState(() => _rangeMode = _RangeMode.custom);
    final device = _selected;
    if (device == null) return;
    setState(() {
      _loadingHistory = true;
      _error = null;
    });
    try {
      final result = await widget.api.fetchHistory(device.id, from: from, to: to);
      if (!mounted) return;
      setState(() {
        _histories = result;
        _loadingHistory = false;
      });
    } on Exception catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loadingHistory = false;
      });
    }
  }

  Future<void> _setFollowLive() async {
    final device = _selected;
    if (device == null) return;
    final to = DateTime.now();
    final from = to.subtract(Duration(minutes: _liveWindowMinutes));
    setState(() {
      _loadingHistory = true;
      _rangeMode = _RangeMode.followLive;
      _followLiveActive = true;
      _error = null;
      _requestStartTime = from.toIso8601String();
      _requestEndTime = to.toIso8601String();
    });
    try {
      final result = await widget.api.fetchHistory(device.id, from: from, to: to);
      if (!mounted) return;
      setState(() {
        _histories = result;
        _historyKeys
          ..clear()
          ..addAll(result.map((e) => '${e.deviceId}|${e.startTime}|${e.endTime}'));
        if (_pendingLivePackets.isNotEmpty) {
          for (final p in _pendingLivePackets) {
            final pk = '${p.deviceId}|${p.startTime}|${p.endTime}';
            if (!_historyKeys.contains(pk)) {
              _histories = [..._histories, p];
              _historyKeys.add(pk);
            }
          }
          _pendingLivePackets.clear();
        }
        if (_histories.isNotEmpty) {
          final lastEnd = _histories.last.endTime;
          final anchor = lastEnd != null ? DateTime.tryParse(lastEnd) ?? DateTime.now() : DateTime.now();
          _requestStartTime = anchor.subtract(Duration(minutes: _liveWindowMinutes)).toIso8601String();
          _requestEndTime = anchor.toIso8601String();
        }
        _loadingHistory = false;
      });
      _liveDataNotifier.value = (List.unmodifiable(_histories), _requestStartTime, _requestEndTime);
      _startPolling();
    } on Exception catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loadingHistory = false;
        _followLiveActive = false;
      });
      _stopPolling();
    }
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 5), (_) => _pollLatest());
  }

  void _stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  Future<void> _pollLatest() async {
    final device = _selected;
    if (!mounted || !_followLiveActive || device == null || _loadingHistory) return;
    try {
      final h = await widget.api.fetchLatest('/devices/', device.id);
      if (!mounted || !_followLiveActive) return;
      final key = '${h.deviceId}|${h.startTime}|${h.endTime}';
      if (_historyKeys.contains(key)) return;
      _historyKeys.add(key);
      _insertPacketLive(h);
    } on Exception {
      // Ignore polling errors silently
    }
  }

  void _setRange(_RangeMode mode) {
    if (_rangeMode == mode && mode != _RangeMode.followLive) {
      return;
    }
    if (mode == _RangeMode.followLive) {
      _setFollowLive();
      return;
    }
    _stopPolling();
    setState(() {
      _rangeMode = mode;
      _followLiveActive = false;
      _histories = const [];
      _historyKeys.clear();
      _requestStartTime = null;
      _requestEndTime = null;
    });
    _loadRange();
  }

  void _setTestMode() {
    if (_rangeMode == _RangeMode.test) {
      return;
    }
    _stopPolling();
    final testHistories = generateTestData();
    final firstStart = testHistories.first.startTime;
    final lastEnd = testHistories.last.endTime;
    setState(() {
      _rangeMode = _RangeMode.test;
      _followLiveActive = false;
      _histories = testHistories;
      _historyKeys
        ..clear()
        ..addAll(testHistories.map((e) => '${e.deviceId}|${e.startTime}|${e.endTime}'));
      _requestStartTime = firstStart;
      _requestEndTime = lastEnd;
      if (_selected == null) {
        _selected = const Device(id: 1, name: 'pi1', description: 'Test Device');
      }
      _loadingDevices = false;
      _loadingHistory = false;
    });
    _liveDataNotifier.value = (List.unmodifiable(_histories), _requestStartTime, _requestEndTime);
  }

  Future<void> _logout() async {
    await widget.auth.logout();
    if (mounted) {
      Navigator.of(context).pushReplacementNamed('/login');
    }
  }

  void _showAIReport() {
    final now = DateTime.now();
    showDialog(
      context: context,
      builder: (_) => _AIReportDialog(
        socket: widget.socket,
        devices: _devices,
        initialDevice: _selected,
        initialFrom: now.subtract(const Duration(hours: 24)),
        initialTo: now,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: const Color(0xFF0A0A0A),
      appBar: AppBar(
        title: Row(
          children: [
            Icon(Icons.graphic_eq, color: scheme.primary),
            const SizedBox(width: 8),
            const Text('SPECTRO', style: TextStyle(letterSpacing: 3, fontWeight: FontWeight.bold)),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'تقرير الأهداف',
            icon: const Icon(Icons.assessment, color: Colors.white70),
            onPressed: _showAIReport,
          ),
          IconButton(
            tooltip: 'تسجيل الخروج',
            icon: const Icon(Icons.logout),
            onPressed: _logout,
          ),
        ],
      ),
      body: _buildBody(scheme),
    );
  }

  Widget _buildBody(ColorScheme scheme) {
    return Column(
      children: [
        _buildDeviceBar(scheme),
        _buildRangeControls(scheme),
        Expanded(child: _buildSpectrogramArea()),
        _buildStatusBar(),
      ],
    );
  }

  Widget _buildDeviceBar(ColorScheme scheme) {
    return Container(
      color: const Color(0xFF111111),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      child: _loadingDevices
          ? const LinearProgressIndicator()
          : SizedBox(
              height: 40,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  for (final d in _devices)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                      child: ChoiceChip(
                        label: Text(d.name),
                        selected: _selected?.id == d.id,
                        onSelected: (_) => _selectDevice(d),
                        selectedColor: scheme.primary,
                        backgroundColor: const Color(0xFF1A1A1A),
                        labelStyle: TextStyle(
                          color: _selected?.id == d.id ? Colors.black : Colors.white70,
                        ),
                      ),
                    ),
                ],
              ),
            ),
    );
  }

  Widget _buildRangeControls(ColorScheme scheme) {
    Widget btn(String label, IconData? icon, VoidCallback onTap, {bool active = false}) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
          child: OutlinedButton(
          onPressed: onTap,
          style: OutlinedButton.styleFrom(
            foregroundColor: active ? scheme.primary : Colors.white70,
            side: BorderSide(color: active ? scheme.primary : Colors.white24),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
            visualDensity: VisualDensity.compact,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 18),
                const SizedBox(width: 4),
              ],
              Text(label, style: const TextStyle(fontSize: 12)),
            ],
          ),
        ),
      );
    }

    bool mode(_RangeMode m) => _rangeMode == m;

    return Container(
      color: const Color(0xFF0E0E0E),
      child: Column(
        children: [
          SizedBox(
            height: 38,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
              children: [
                btn('آخر باكت', Icons.flash_on, () => _setRange(_RangeMode.latestPacket), active: mode(_RangeMode.latestPacket)),
                btn('متابعة البث', Icons.play_circle, () => _setRange(_RangeMode.followLive), active: mode(_RangeMode.followLive)),
                Container(
                  height: 28,
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: DropdownButton<int>(
                    value: _liveWindowMinutes,
                    isDense: true,
                    underline: const SizedBox.shrink(),
                    style: const TextStyle(color: Colors.white70, fontSize: 13),
                    dropdownColor: const Color(0xFF1A1A2E),
                    items: [5, 10, 15, 20, 30].map((m) =>
                      DropdownMenuItem(value: m, child: Text('$m د', style: const TextStyle(fontSize: 13)))
                    ).toList(),
                    onChanged: (v) {
                      if (v != null) setState(() => _liveWindowMinutes = v);
                      if (_rangeMode == _RangeMode.followLive) _setFollowLive();
                    },
                  ),
                ),
                btn('آخر ساعة', Icons.timer, () => _setRange(_RangeMode.lastHour), active: mode(_RangeMode.lastHour)),
                btn('آخر 5 ساعات', Icons.history, () => _setRange(_RangeMode.last5h), active: mode(_RangeMode.last5h)),
                btn('تحميل النطاق', Icons.date_range, _pickCustomRange, active: mode(_RangeMode.custom)),
                btn('اختبار', Icons.science, _setTestMode, active: mode(_RangeMode.test)),
              ],
            ),
          ),
            Padding(
              padding: const EdgeInsets.only(left: 12, right: 12, bottom: 2),
              child: ValueListenableBuilder<double>(
                valueListenable: _gainNotifier,
                builder: (context, gainVal, _) {
                  return Row(
                    children: [
                      const Icon(Icons.volume_up, size: 18, color: Colors.white70),
                      const SizedBox(width: 6),
                      Text(
                        'الكسب: ${gainVal.toStringAsFixed(0)} dB',
                        style: const TextStyle(color: Colors.white70, fontSize: 12),
                      ),
                      Expanded(
                        child: SliderTheme(
                          data: SliderThemeData(trackHeight: 2, thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 5)),
                          child: Slider(
                            value: gainVal,
                            min: -24,
                            max: 24,
                            divisions: 48,
                            onChanged: (v) {
                              _gainDb = v;
                              _gainNotifier.value = v;
                            },
                          ),
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
          Padding(
            padding: const EdgeInsets.only(left: 12, right: 12, bottom: 4),
            child: SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _openFullscreen,
                icon: const Icon(Icons.fullscreen, size: 18),
                label: const Text('ملء الشاشة', style: TextStyle(fontSize: 12)),
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white70,
                  side: const BorderSide(color: Colors.white24),
                  padding: const EdgeInsets.symmetric(vertical: 6),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _openFullscreen() async {
    if (_histories.isEmpty) return;
    final snap = _canvasKey.currentState?.seedSnapshot;
    final result = await Navigator.of(context).push<FullscreenResult>(
      MaterialPageRoute(
        builder: (_) => FullscreenSpectrogram(
          liveDataNotifier: _liveDataNotifier,
          gainDb: _gainDb,
          seedImage: snap?.image,
          seedCachedCombined: snap?.cachedCombined,
          seedCachedWidth: snap?.cachedWidth ?? 0,
          seedCachedHeight: snap?.cachedHeight ?? 0,
          seedFrequencyBins: snap?.frequencyBins,
          seedColCount: snap?.colCount ?? 0,
          seedStartTime: snap?.startTime,
          seedEndTime: snap?.endTime,
        ),
      ),
    );
    if (result != null && mounted) {
      setState(() {
        _gainDb = result.gainDb;
        _gainNotifier.value = result.gainDb;
      });
      _canvasKey.currentState?.forceRender();
    }
  }

  Widget _buildSpectrogramArea() {
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.cloud_off, color: Colors.white38, size: 48),
              const SizedBox(height: 12),
              Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.redAccent)),
              const SizedBox(height: 16),
              FilledButton(onPressed: _loadRange, child: const Text('إعادة المحاولة')),
            ],
          ),
        ),
      );
    }

    if (_loadingHistory) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_selected == null) {
      return const Center(child: Text('اختر جهازاً', style: TextStyle(color: Colors.white38)));
    }

    return Container(
      margin: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        border: Border.all(color: Colors.white12),
        borderRadius: BorderRadius.circular(4),
      ),
      clipBehavior: Clip.hardEdge,
      child: SpectrogramCanvas(
        key: _canvasKey,
        histories: _histories,
        gainDb: _gainDb,
        gainNotifier: _gainNotifier,
        requestStartTime: _requestStartTime,
        requestEndTime: _requestEndTime,
      ),
    );
  }

  Widget _buildStatusBar() {
    final connected = _socketStatus == SocketStatus.connected;
    final packetCount = _histories.length;
    return Container(
      height: 24,
      color: const Color(0xFF111111),
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(
        children: [
          Icon(Icons.circle, size: 8, color: connected ? Colors.greenAccent : Colors.orangeAccent),
          const SizedBox(width: 6),
          Text(
            connected ? 'متصل' : 'غير متصل',
            style: TextStyle(
              color: connected ? Colors.greenAccent : Colors.orangeAccent,
              fontSize: 11,
              letterSpacing: 1,
            ),
          ),
          const Spacer(),
          Text(
            '${_selected?.name ?? ''} • $packetCount باكت',
            style: const TextStyle(color: Colors.white38, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

class _AIReportDialog extends StatefulWidget {
  final SocketService socket;
  final List<Device> devices;
  final Device? initialDevice;
  final DateTime initialFrom;
  final DateTime initialTo;

  const _AIReportDialog({
    required this.socket,
    required this.devices,
    this.initialDevice,
    required this.initialFrom,
    required this.initialTo,
  });

  @override
  State<_AIReportDialog> createState() => _AIReportDialogState();
}

class _AIReportDialogState extends State<_AIReportDialog> {
  late DateTime _from;
  late DateTime _to;
  late Device? _device;
  bool _loading = false;
  Map<String, dynamic>? _result;
  String? _error;

  @override
  void initState() {
    super.initState();
    _from = widget.initialFrom;
    _to = widget.initialTo;
    _device = widget.initialDevice;
  }

  Future<void> _pickDate({required bool isFrom}) async {
    final initial = isFrom ? _from : _to;
    final date = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2024),
      lastDate: DateTime.now(),
    );
    if (date == null || !mounted) return;

    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial),
    );
    if (time == null) return;

    final picked = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    setState(() {
      if (isFrom) {
        _from = picked;
      } else {
        _to = picked;
      }
    });
  }

  String _fmt(DateTime dt) {
    final y = dt.year;
    final m = dt.month.toString().padLeft(2, '0');
    final d = dt.day.toString().padLeft(2, '0');
    final h = dt.hour.toString().padLeft(2, '0');
    final min = dt.minute.toString().padLeft(2, '0');
    return '$y-$m-$d $h:$min';
  }

  String _timeAgo(DateTime? dt) {
    if (dt == null) return 'غير محدد';
    final diff = DateTime.now().difference(dt);
    if (diff.inSeconds < 60) return 'الآن';
    if (diff.inMinutes < 60) return 'منذ ${diff.inMinutes} دقيقة';
    if (diff.inHours < 24) return 'منذ ${diff.inHours} ساعة';
    return 'منذ ${diff.inDays} يوم';
  }

  String _iso(DateTime dt) {
    final y = dt.year;
    final m = dt.month.toString().padLeft(2, '0');
    final d = dt.day.toString().padLeft(2, '0');
    final h = dt.hour.toString().padLeft(2, '0');
    final min = dt.minute.toString().padLeft(2, '0');
    final s = dt.second.toString().padLeft(2, '0');
    return '$y-$m-${d}T$h:$min:$s';
  }

  Future<void> _fetch() async {
    setState(() {
      _loading = true;
      _error = null;
      _result = null;
    });

    final response = await widget.socket.emitCheckAiStatus(
      deviceId: _device!.id,
      startTime: _iso(_from),
      endTime: _iso(_to),
    );

    if (!mounted) return;

    if (response == null) {
      setState(() {
        _loading = false;
        _error = 'فشل الاتصال بالخادم';
      });
      return;
    }

    if (response['ok'] == false) {
      setState(() {
        _loading = false;
        _error = response['message'] ?? 'خطأ غير معروف';
      });
      return;
    }

    setState(() {
      _loading = false;
      _result = response;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: const Color(0xFF1A1A2E),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 380),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'تقرير الأهداف',
                style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 16),
              _buildDeviceDropdown(),
              const SizedBox(height: 12),
              _buildDateTimeRow('من:', _from, () => _pickDate(isFrom: true)),
              const SizedBox(height: 8),
              _buildDateTimeRow('إلى:', _to, () => _pickDate(isFrom: false)),
              const SizedBox(height: 12),
              _buildQuickRanges(),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _loading ? null : _fetch,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF3B82F6),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  child: _loading
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('جلب التقرير', style: TextStyle(fontWeight: FontWeight.bold)),
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: const TextStyle(color: Color(0xFFEF4444), fontSize: 13)),
              ],
              if (_result != null) ...[
                const SizedBox(height: 16),
                const Divider(color: Colors.white24),
                const SizedBox(height: 8),
                _buildResults(),
              ],
            ],
          ),
        ),
      ),
    );
  }

  int _selectedRange = 3;

  Widget _buildQuickRanges() {
    final now = DateTime.now();
    final ranges = [
      ('ساعة', now.subtract(const Duration(hours: 1))),
      ('6 ساعات', now.subtract(const Duration(hours: 6))),
      ('12 ساعة', now.subtract(const Duration(hours: 12))),
      ('24 ساعة', now.subtract(const Duration(hours: 24))),
    ];

    return Row(
      children: List.generate(ranges.length, (i) {
        final r = ranges[i];
        final selected = _selectedRange == i;
        return Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 3),
            child: ElevatedButton(
              onPressed: () {
                setState(() {
                  _selectedRange = i;
                  _from = r.$2;
                });
                _fetch();
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: selected ? const Color(0xFF21A366) : const Color(0xFF16213E),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 8),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
              ),
              child: Text(r.$1, style: const TextStyle(fontSize: 11)),
            ),
          ),
        );
      }),
    );
  }

  Widget _buildDeviceDropdown() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: const Color(0xFF16213E),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white12),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<int>(
          isExpanded: true,
          value: _device?.id,
          dropdownColor: const Color(0xFF16213E),
          icon: const Icon(Icons.arrow_drop_down, color: Colors.white54),
          style: const TextStyle(color: Colors.white, fontSize: 13),
          items: widget.devices.map((d) => DropdownMenuItem(
            value: d.id,
            child: Text(d.name),
          )).toList(),
          onChanged: (id) {
            if (id == null) return;
            final found = widget.devices.where((d) => d.id == id);
            if (found.isNotEmpty) {
              setState(() => _device = found.first);
            }
          },
        ),
      ),
    );
  }

  Widget _buildDateTimeRow(String label, DateTime value, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: const Color(0xFF16213E),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: Colors.white12),
        ),
        child: Row(
          children: [
            Text(label, style: const TextStyle(color: Colors.white70, fontSize: 13)),
            const SizedBox(width: 8),
            const Icon(Icons.calendar_today, size: 14, color: Colors.white54),
            const SizedBox(width: 4),
            Text(_fmt(value), style: const TextStyle(color: Colors.white, fontSize: 13)),
          ],
        ),
      ),
    );
  }

  Widget _buildResults() {
    final data = _result!['data'];
    if (data == null) return const Text('لا توجد بيانات', style: TextStyle(color: Colors.white54));

    final items = data['items'];
    if (items is! List || items.isEmpty) {
      return const Text('لا توجد أهداف في هذه الفترة', style: TextStyle(color: Colors.white54));
    }

    final filteredItems = items.where((item) => item['deviceId'] == _device?.id).toList();
    if (filteredItems.isEmpty) {
      return const Text('لا توجد أهداف لهذا الجهاز في هذه الفترة', style: TextStyle(color: Colors.white54));
    }

    // Find last detected and last possible
    DateTime? lastDetectedTime;
    double? lastDetectedConf;
    DateTime? lastPossibleTime;
    double? lastPossibleConf;

    int detectedCount = 0;
    int possibleCount = 0;
    int notDetectedCount = 0;

    for (final item in filteredItems) {
      final aiStatus = item['aiStatus'];
      final confidence = item['confidence'];
      final conf = confidence is num ? confidence.toDouble() : double.tryParse('$confidence');

      final endTimeStr = item['endTime'] as String?;
      final endTime = endTimeStr != null ? DateTime.tryParse(endTimeStr) : null;

      if (aiStatus == 1) {
        detectedCount++;
        if (endTime != null && (lastDetectedTime == null || endTime.isAfter(lastDetectedTime))) {
          lastDetectedTime = endTime;
          lastDetectedConf = conf;
        }
      } else if (aiStatus == 0) {
        possibleCount++;
        if (endTime != null && (lastPossibleTime == null || endTime.isAfter(lastPossibleTime))) {
          lastPossibleTime = endTime;
          lastPossibleConf = conf;
        }
      } else if (aiStatus == 2) {
        notDetectedCount++;
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildStatusRow(
          color: const Color(0xFFD13438),
          label: 'آخر هدف مكتشف',
          time: _timeAgo(lastDetectedTime),
          confidence: lastDetectedConf,
        ),
        const SizedBox(height: 10),
        _buildStatusRow(
          color: const Color(0xFFF59E0B),
          label: 'آخر هدف محتمل',
          time: _timeAgo(lastPossibleTime),
          confidence: lastPossibleConf,
        ),
        const SizedBox(height: 14),
        const Divider(color: Colors.white24),
        const SizedBox(height: 8),
        const Text('إحصائيات الفترة:', style: TextStyle(color: Colors.white70, fontSize: 13, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        _buildStatRow(color: const Color(0xFFD13438), label: 'مكتشفة', count: detectedCount),
        const SizedBox(height: 4),
        _buildStatRow(color: const Color(0xFFF59E0B), label: 'محتملة', count: possibleCount),
        const SizedBox(height: 4),
        _buildStatRow(color: const Color(0xFF21A366), label: 'غير مكتشفة', count: notDetectedCount),
        const SizedBox(height: 4),
        _buildStatRow(color: Colors.white54, label: 'إجمالي الباكتات', count: filteredItems.length),
      ],
    );
  }

  Widget _buildStatusRow({
    required Color color,
    required String label,
    required String time,
    double? confidence,
  }) {
    final confText = confidence != null ? ' (%${confidence.toStringAsFixed(1)})' : '';
    return Row(
      children: [
        Icon(Icons.circle, size: 10, color: color),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold)),
              Text(
                '$time$confText',
                style: TextStyle(color: Colors.white.withOpacity(0.7), fontSize: 12),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildStatRow({
    required Color color,
    required String label,
    required int count,
  }) {
    return Row(
      children: [
        Icon(Icons.circle, size: 8, color: color),
        const SizedBox(width: 8),
        Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
        const Spacer(),
        Text('$count', style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold)),
      ],
    );
  }
}
