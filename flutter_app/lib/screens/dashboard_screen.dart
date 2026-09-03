import 'dart:async';

import 'package:flutter/material.dart';

import '../models/device.dart';
import '../models/device_history.dart';
import '../services/api_client.dart';
import '../services/auth_service.dart';
import '../services/socket_service.dart';
import '../utils/spectro.dart';
import '../widgets/spectrogram_canvas.dart';
import 'fullscreen_spectrogram.dart';

enum _RangeMode { latestPacket, lastHour, last5h, last24h, followLive, custom }

class DashboardScreen extends StatefulWidget {
  final ApiClient api;
  final AuthService auth;
  final SocketService socket;

  const DashboardScreen({
    super.key,
    required this.api,
    required this.auth,
    required this.socket,
  });

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  List<Device> _devices = [];
  Device? _selected;
  List<DeviceHistory> _histories = [];
  bool _loadingDevices = true;
  bool _loadingHistory = false;
  String? _error;
  SocketStatus _socketStatus = SocketStatus.disconnected;
  int _colorMapIndex = 0;
  double _gainDb = 0.0;
  double _noiseThreshold = 0.06;
  _RangeMode _rangeMode = _RangeMode.followLive;
  bool _followLiveActive = true;
  static const _liveWindowMinutes = 15;
  String? _requestStartTime;
  String? _requestEndTime;
  final _canvasKey = GlobalKey<SpectrogramCanvasState>();

  StreamSubscription<DeviceHistory>? _dataSub;
  StreamSubscription<SocketStatus>? _statusSub;
  final List<DeviceHistory> _pendingLivePackets = [];

  @override
  void initState() {
    super.initState();
    _bindSocket();
    _loadDevices();
  }

  @override
  void dispose() {
    _dataSub?.cancel();
    _statusSub?.cancel();
    super.dispose();
  }

  void _bindSocket() {
    _statusSub = widget.socket.onStatus.listen((s) {
      if (mounted) setState(() => _socketStatus = s);
    });
    _dataSub = widget.socket.onData.listen((h) {
      if (mounted) {
        setState(() {
          if (_followLiveActive) {
            if (_loadingHistory) {
              _pendingLivePackets.add(h);
              return;
            }
            final exists = _histories.any((e) => e.id == h.id);
            if (!exists) {
              final cutoff = DateTime.now().subtract(Duration(minutes: _liveWindowMinutes));
              final updated = [..._histories, h];
              _histories = updated.where((e) {
                final ts = DateTime.tryParse(e.timestamp);
                return ts != null ? ts.isAfter(cutoff) : true;
              }).toList();
              final now = DateTime.now();
              _requestStartTime = now.subtract(Duration(minutes: _liveWindowMinutes)).toIso8601String();
              _requestEndTime = now.toIso8601String();
            }
          } else {
            _histories = [h];
          }
        });
      }
    });
    widget.socket.connect(_hostFromApi());
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
      }
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
      _requestStartTime = from.toUtc().toIso8601String();
      _requestEndTime = to.toUtc().toIso8601String();
    });
    try {
      final result = await widget.api.fetchHistory(device.id, from: from, to: to);
      if (!mounted) return;
      setState(() {
        _histories = result;
        if (_pendingLivePackets.isNotEmpty) {
          for (final p in _pendingLivePackets) {
            final exists = _histories.any((e) => e.id == p.id);
            if (!exists) _histories = [..._histories, p];
          }
          _pendingLivePackets.clear();
        }
        _loadingHistory = false;
      });
    } on Exception catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loadingHistory = false;
        _followLiveActive = false;
      });
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
    setState(() {
      _rangeMode = mode;
      _followLiveActive = false;
      _histories = const [];
      _requestStartTime = null;
      _requestEndTime = null;
    });
    _loadRange();
  }

  Future<void> _logout() async {
    await widget.auth.logout();
    if (mounted) {
      Navigator.of(context).pushReplacementNamed('/login');
    }
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
              height: 36,
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
            padding: const EdgeInsets.symmetric(horizontal: 12),
            visualDensity: VisualDensity.compact,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 16),
                const SizedBox(width: 4),
              ],
              Text(label, style: const TextStyle(fontSize: 10)),
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
            height: 32,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
              children: [
                btn('آخر باكت', Icons.flash_on, () => _setRange(_RangeMode.latestPacket), active: mode(_RangeMode.latestPacket)),
                btn('متابعة البث', Icons.play_circle, () => _setRange(_RangeMode.followLive), active: mode(_RangeMode.followLive)),
                btn('آخر ساعة', Icons.timer, () => _setRange(_RangeMode.lastHour), active: mode(_RangeMode.lastHour)),
                btn('آخر 5 ساعات', Icons.history, () => _setRange(_RangeMode.last5h), active: mode(_RangeMode.last5h)),
                btn('آخر 24 ساعة', Icons.history, () => _setRange(_RangeMode.last24h), active: mode(_RangeMode.last24h)),
                btn('تحميل النطاق', Icons.date_range, _pickCustomRange, active: mode(_RangeMode.custom)),
              ],
            ),
          ),
          SizedBox(
            height: 32,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
              children: [
                btn('الألوان: ${kColorMapNames[_colorMapIndex]}', null, _toggleColorMap),
                if (_rangeMode != _RangeMode.latestPacket)
                  btn('إعادة الضبط', Icons.refresh, _loadRange),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(left: 12, right: 12, bottom: 2),
            child: Row(
              children: [
                const Icon(Icons.volume_up, size: 14, color: Colors.white70),
                const SizedBox(width: 4),
                Text(
                  'الكسب: ${_gainDb.toStringAsFixed(0)} dB',
                  style: const TextStyle(color: Colors.white70, fontSize: 10),
                ),
                Expanded(
                  child: SliderTheme(
                    data: SliderThemeData(trackHeight: 2, thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 5)),
                    child: Slider(
                      value: _gainDb,
                      min: -24,
                      max: 24,
                      divisions: 48,
                      onChanged: (v) => setState(() => _gainDb = v),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(left: 12, right: 12, bottom: 2),
            child: Row(
              children: [
                const Icon(Icons.noise_aware, size: 14, color: Colors.white70),
                const SizedBox(width: 4),
                Text(
                  'الضوضاء: ${_noiseThreshold.toStringAsFixed(2)}',
                  style: const TextStyle(color: Colors.white70, fontSize: 10),
                ),
                Expanded(
                  child: SliderTheme(
                    data: SliderThemeData(trackHeight: 2, thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 5)),
                    child: Slider(
                      value: _noiseThreshold,
                      min: 0.0,
                      max: 0.5,
                      divisions: 50,
                      onChanged: (v) => setState(() => _noiseThreshold = v),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(left: 12, right: 12, bottom: 4),
            child: SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _openFullscreen,
                icon: const Icon(Icons.fullscreen, size: 14),
                label: const Text('ملء الشاشة', style: TextStyle(fontSize: 10)),
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white70,
                  side: const BorderSide(color: Colors.white24),
                  padding: const EdgeInsets.symmetric(vertical: 4),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _toggleColorMap() {
    setState(() {
      _colorMapIndex = (_colorMapIndex + 1) % kColorMaps.length;
    });
  }

  void _openFullscreen() async {
    if (_histories.isEmpty) return;
    final snap = _canvasKey.currentState?.seedSnapshot;
    final result = await Navigator.of(context).push<FullscreenResult>(
      MaterialPageRoute(
        builder: (_) => FullscreenSpectrogram(
          histories: _histories,
          colorMapIndex: _colorMapIndex,
          gainDb: _gainDb,
          noiseThreshold: _noiseThreshold,
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
        _colorMapIndex = result.colorMapIndex;
        _gainDb = result.gainDb;
        _noiseThreshold = result.noiseThreshold;
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
        colorMap: kColorMaps[_colorMapIndex],
        gainDb: _gainDb,
        noiseThreshold: _noiseThreshold,
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
