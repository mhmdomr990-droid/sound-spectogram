import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../controllers/auth_controller.dart';
import '../controllers/dashboard_controller.dart';
import '../models/device.dart';
import '../models/device_history.dart';
import '../models/range_mode.dart';
import '../screens/fullscreen_spectrogram.dart';
import '../services/api_client.dart';
import '../services/socket_service.dart';
import '../widgets/spectrogram_canvas.dart';

class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<DashboardController>();
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      backgroundColor: const Color(0xFF0A0A0A),
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.graphic_eq, color: scheme.primary, size: 18),
            const SizedBox(width: 4),
            const Flexible(
              child: Text('Sound Spectogram', style: TextStyle(fontSize: 12, letterSpacing: 1, fontWeight: FontWeight.bold), overflow: TextOverflow.ellipsis),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'تقرير الأهداف',
            icon: const Icon(Icons.assessment, color: Colors.white70),
            onPressed: () => _showAIReport(context, controller),
          ),
          IconButton(
            tooltip: 'تسجيل الخروج',
            icon: const Icon(Icons.logout),
            onPressed: () {
              Get.defaultDialog(
                title: 'تأكيد تسجيل الخروج',
                middleText: 'هل أنت متأكد أنك تريد تسجيل الخروج؟',
                textConfirm: 'نعم',
                textCancel: 'إلغاء',
                confirmTextColor: Colors.white,
                onConfirm: () async {
                  Get.back();
                  await Get.find<AuthController>().logout();
                  Get.offAllNamed('/login');
                },
              );
            },
          ),
        ],
      ),
      body: _buildBody(context, controller, scheme),
    );
  }

  Widget _buildBody(BuildContext context, DashboardController c, ColorScheme scheme) {
    return Column(
      children: [
        _buildDeviceBar(c, scheme),
        _buildRangeControls(context, c, scheme),
        Expanded(child: _buildSpectrogramArea(context, c)),
        _buildStatusBar(c),
      ],
    );
  }

  Widget _buildDeviceBar(DashboardController c, ColorScheme scheme) {
    return Container(
      color: const Color(0xFF111111),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      child: Obx(() {
        c.deviceStatusMap.length;
        return c.loadingDevices.value
            ? const LinearProgressIndicator()
            : SizedBox(
                height: 40,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  children: [
                    for (final d in c.devices)
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        child: ChoiceChip(
                          label: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(Icons.circle, size: 8, color: _deviceStatusColor(c, d.name)),
                              const SizedBox(width: 4),
                              Text(d.name),
                            ],
                          ),
                          selected: c.selected.value?.id == d.id,
                          onSelected: (_) => c.selectDevice(d),
                          selectedColor: scheme.primary,
                          backgroundColor: const Color(0xFF1A1A1A),
                          labelStyle: TextStyle(
                            color: c.selected.value?.id == d.id ? Colors.black : Colors.white70,
                          ),
                        ),
                      ),
                  ],
                ),
              );
      }),
    );
  }

  Color _deviceStatusColor(DashboardController c, String deviceName) {
    final status = c.deviceStatusMap[deviceName];
    if (status == null || status.internet == null) return Colors.white24;
    return status.internet!.toUpperCase() == 'UP' ? Colors.greenAccent : Colors.redAccent;
  }

  Widget _buildRangeControls(BuildContext context, DashboardController c, ColorScheme scheme) {
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

    bool mode(RangeMode m) => c.rangeMode.value == m;

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
                Obx(() => btn('آخر باكت', Icons.flash_on, () => c.setRange(RangeMode.latestPacket), active: mode(RangeMode.latestPacket))),
                Obx(() => btn('متابعة البث', Icons.play_circle, () => c.setRange(RangeMode.followLive), active: mode(RangeMode.followLive))),
                Container(
                  height: 28,
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: Obx(() => DropdownButton<int>(
                    value: c.liveWindowMinutes.value,
                    isDense: true,
                    underline: const SizedBox.shrink(),
                    style: const TextStyle(color: Colors.white70, fontSize: 13),
                    dropdownColor: const Color(0xFF1A1A2E),
                    items: [5, 10, 15, 20, 30].map((m) =>
                      DropdownMenuItem(value: m, child: Text('$m د', style: const TextStyle(fontSize: 13)))
                    ).toList(),
                    onChanged: (v) {
                      if (v != null) {
                        c.liveWindowMinutes.value = v;
                        if (c.rangeMode.value == RangeMode.followLive) c.setFollowLive();
                      }
                    },
                  )),
                ),
                Obx(() => btn('آخر ساعة', Icons.timer, () => c.setRange(RangeMode.lastHour), active: mode(RangeMode.lastHour))),
                Obx(() => btn('آخر ساعتين', Icons.history, () => c.setRange(RangeMode.last5h), active: mode(RangeMode.last5h))),
                Obx(() => btn('تحميل النطاق', Icons.date_range, () => c.pickCustomRange(context), active: mode(RangeMode.custom))),
                Obx(() => c.markers.isNotEmpty
                    ? btn('إزالة العلامات', Icons.clear, () => c.clearMarkers())
                    : const SizedBox.shrink()),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(left: 12, right: 12, bottom: 2),
            child: ValueListenableBuilder<double>(
              valueListenable: c.gainNotifier,
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
                            c.gainDb.value = v;
                            c.gainNotifier.value = v;
                          },
                          onChangeEnd: (_) => c.canvasKey.currentState?.applyGain(),
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
                onPressed: () => _openFullscreen(context, c),
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

  void _openFullscreen(BuildContext context, DashboardController c) async {
    if (c.histories.isEmpty) return;
    final snap = c.canvasKey.currentState?.seedSnapshot;
    final result = await Navigator.of(context).push<FullscreenResult>(
      MaterialPageRoute(
        builder: (_) => FullscreenSpectrogram(
          liveDataNotifier: c.liveDataNotifier,
          gainDb: c.gainDb.value,
          seedImage: snap?.image,
          seedCachedCombined: snap?.cachedCombined,
          seedCachedWidth: snap?.cachedWidth ?? 0,
          seedCachedHeight: snap?.cachedHeight ?? 0,
          seedFrequencyBins: snap?.frequencyBins,
          seedColCount: snap?.colCount ?? 0,
          seedStartTime: snap?.startTime,
          seedEndTime: snap?.endTime,
          seedIntensity: snap?.cachedIntensity,
          seedIntensityWidth: snap?.intensityWidth ?? 0,
          seedIntensityHeight: snap?.intensityHeight ?? 0,
          seedGamma: snap?.cachedGamma ?? 1.0,
          markers: c.markers,
        ),
      ),
    );
    if (result != null) {
      c.updateGain(result.gainDb);
      c.markers.value = result.markers;
      c.canvasKey.currentState?.forceRender();
    }
  }

  Widget _buildSpectrogramArea(BuildContext context, DashboardController c) {
    return Obx(() {
      if (c.error.value != null) {
        return Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.cloud_off, color: Colors.white38, size: 48),
                const SizedBox(height: 12),
                Text(c.error.value!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.redAccent)),
                const SizedBox(height: 16),
                FilledButton(onPressed: () => c.loadRange(), child: const Text('إعادة المحاولة')),
              ],
            ),
          ),
        );
      }

      if (c.loadingHistory.value) {
        return const Center(child: CircularProgressIndicator());
      }

      if (c.selected.value == null) {
        return const Center(child: Text('اختر جهازاً', style: TextStyle(color: Colors.white38)));
      }

      // Force Obx to track markers for reactive rebuild.
      c.markers.length;

      return Stack(
        children: [
          Container(
            margin: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              border: Border.all(color: Colors.white12),
              borderRadius: BorderRadius.circular(4),
            ),
            clipBehavior: Clip.hardEdge,
            child: SpectrogramCanvas(
              key: c.canvasKey,
              histories: c.histories,
              gainNotifier: c.gainNotifier,
              requestStartTime: c.requestStartTime.value,
              requestEndTime: c.requestEndTime.value,
              markers: c.markers,
              onMarkerAdd: (timeMs) => c.addMarker(timeMs),
              onMarkerRemove: (index) => c.removeMarker(index),
              onMarkerMove: (index, newTimeMs) => c.moveMarker(index, newTimeMs),
            ),
          ),
          if (c.markers.isNotEmpty)
            Positioned(
              left: 14,
              bottom: 14,
              child: GestureDetector(
                onTap: () => c.clearMarkers(),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: Colors.black.withOpacity(0.7),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: Colors.white24),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.delete_outline, color: Colors.redAccent, size: 16),
                      SizedBox(width: 4),
                      Text('مسح العلامات', style: TextStyle(color: Colors.white70, fontSize: 12)),
                    ],
                  ),
                ),
              ),
            ),
        ],
      );
    });
  }

  Widget _buildStatusBar(DashboardController c) {
    return Obx(() {
      final connected = c.socketStatus.value == SocketStatus.connected;
      final packetCount = c.histories.length;
      final selectedName = c.selected.value?.name ?? '';
      final devStatus = c.deviceStatusMap[selectedName];
      final temp = devStatus?.temperature;
      final batt = devStatus?.battery;
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
            if (temp != null) ...[
              Icon(Icons.thermostat, size: 12, color: Colors.white38),
              const SizedBox(width: 2),
              Text('${temp.toStringAsFixed(0)}°C', style: const TextStyle(color: Colors.white38, fontSize: 11)),
              const SizedBox(width: 10),
            ],
            if (batt != null) ...[
              Icon(Icons.battery_std, size: 12, color: Colors.white38),
              const SizedBox(width: 2),
              Text('${batt.toStringAsFixed(0)}%', style: const TextStyle(color: Colors.white38, fontSize: 11)),
              const SizedBox(width: 10),
            ],
            Text(
              '$selectedName • $packetCount باكت',
              style: const TextStyle(color: Colors.white38, fontSize: 12),
            ),
          ],
        ),
      );
    });
  }

  void _showAIReport(BuildContext context, DashboardController c) {
    final now = DateTime.now();
    showDialog(
      context: context,
      builder: (_) => _AIReportDialog(
        devices: c.devices.toList(),
        initialDevice: c.selected.value,
        initialFrom: now.subtract(const Duration(hours: 24)),
        initialTo: now,
        deviceStatusMap: c.deviceStatusMap,
      ),
    );
  }
}

class _AIReportDialog extends StatefulWidget {
  final List<Device> devices;
  final Device? initialDevice;
  final DateTime initialFrom;
  final DateTime initialTo;
  final Map<String, DeviceStatusInfo> deviceStatusMap;

  const _AIReportDialog({
    required this.devices,
    this.initialDevice,
    required this.initialFrom,
    required this.initialTo,
    required this.deviceStatusMap,
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
  int _selectedRange = 3;

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
      _selectedRange = -1;
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

    final socket = Get.find<SocketService>();
    final response = await socket.emitCheckAiStatus(
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

    final List<MapEntry<DateTime, double?>> detectedList = [];
    final List<MapEntry<DateTime, double?>> possibleList = [];

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
        if (endTime != null) {
          detectedList.add(MapEntry(endTime, conf));
        }
      } else if (aiStatus == 0) {
        possibleCount++;
        if (endTime != null) {
          possibleList.add(MapEntry(endTime, conf));
        }
      } else if (aiStatus == 2) {
        notDetectedCount++;
      }
    }

    detectedList.sort((a, b) => b.key.compareTo(a.key));
    possibleList.sort((a, b) => b.key.compareTo(a.key));
    final lastDetected = detectedList.take(3).toList();
    final lastPossible = possibleList.take(3).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (lastDetected.isNotEmpty) ...[
          const Text('آخر أهداف مكتشفة:', style: TextStyle(color: Color(0xFFD13438), fontSize: 13, fontWeight: FontWeight.bold)),
          const SizedBox(height: 6),
          for (final e in lastDetected)
            _buildStatusRow(
              color: const Color(0xFFD13438),
              time: _fmt(e.key),
              timeAgo: _timeAgo(e.key),
              confidence: e.value,
            ),
        ],
        if (lastDetected.isEmpty)
          _buildStatusRow(color: const Color(0xFFD13438), time: 'لا توجد', label: 'آخر هدف مكتشف'),
        const SizedBox(height: 10),
        if (lastPossible.isNotEmpty) ...[
          const Text('آخر أهداف محتملة:', style: TextStyle(color: Color(0xFFF59E0B), fontSize: 13, fontWeight: FontWeight.bold)),
          const SizedBox(height: 6),
          for (final e in lastPossible)
            _buildStatusRow(
              color: const Color(0xFFF59E0B),
              time: _fmt(e.key),
              timeAgo: _timeAgo(e.key),
              confidence: e.value,
            ),
        ],
        if (lastPossible.isEmpty)
          _buildStatusRow(color: const Color(0xFFF59E0B), time: 'لا توجد', label: 'آخر هدف محتمل'),
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
        const SizedBox(height: 14),
        const Divider(color: Colors.white24),
        const SizedBox(height: 8),
        _buildDeviceStatusSection(),
      ],
    );
  }

  Widget _buildStatusRow({
    required Color color,
    required String time,
    String? timeAgo,
    double? confidence,
    String? label,
  }) {
    final confText = confidence != null ? ' (%${confidence.toStringAsFixed(1)})' : '';
    final agoText = timeAgo != null ? ' $timeAgo' : '';
    return Row(
      children: [
        Icon(Icons.circle, size: 8, color: color),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (label != null)
                Text(label, style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold)),
              Text(
                label != null ? '$time$confText' : '$time$confText$agoText',
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

  Widget _buildDeviceStatusSection() {
    final name = _device?.name ?? '';
    final status = widget.deviceStatusMap[name];
    if (status == null || status.internet == null) {
      return const Text('لا توجد بيانات حالة الجهاز', style: TextStyle(color: Colors.white54, fontSize: 12));
    }
    final isUp = status.internet!.toUpperCase() == 'UP';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('حالة الجهاز:', style: TextStyle(color: Colors.white70, fontSize: 13, fontWeight: FontWeight.bold)),
        const SizedBox(height: 6),
        Row(
          children: [
            Icon(Icons.circle, size: 8, color: isUp ? Colors.greenAccent : Colors.redAccent),
            const SizedBox(width: 8),
            Text('الاتصال: ${isUp ? "متصل" : "غير متصل"}', style: TextStyle(color: isUp ? Colors.greenAccent : Colors.redAccent, fontSize: 12)),
          ],
        ),
        if (status.temperature != null) ...[
          const SizedBox(height: 4),
          Row(
            children: [
              const Icon(Icons.thermostat, size: 12, color: Colors.white54),
              const SizedBox(width: 8),
              Text('درجة الحرارة: ${status.temperature!.toStringAsFixed(1)}°C', style: const TextStyle(color: Colors.white70, fontSize: 12)),
            ],
          ),
        ],
        if (status.battery != null) ...[
          const SizedBox(height: 4),
          Row(
            children: [
              const Icon(Icons.battery_std, size: 12, color: Colors.white54),
              const SizedBox(width: 8),
              Text('البطارية: ${status.battery!.toStringAsFixed(0)}%', style: const TextStyle(color: Colors.white70, fontSize: 12)),
            ],
          ),
        ],
        if (status.uptime != null) ...[
          const SizedBox(height: 4),
          Row(
            children: [
              const Icon(Icons.access_time, size: 12, color: Colors.white54),
              const SizedBox(width: 8),
              Text('مدة التشغيل: ${status.uptime}', style: const TextStyle(color: Colors.white70, fontSize: 12)),
            ],
          ),
        ],
      ],
    );
  }
}
