import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../models/device_history.dart';
import '../utils/spectro.dart';
import '../utils/spectro_isolate.dart';
import 'spectrogram_axes_painter.dart';

class CanvasSeedSnapshot {
  final ui.Image image;
  final List<List<double>>? cachedCombined;
  final int cachedWidth;
  final int cachedHeight;
  final List<double>? frequencyBins;
  final int colCount;
  final DateTime? startTime;
  final DateTime? endTime;

  const CanvasSeedSnapshot({
    required this.image,
    this.cachedCombined,
    this.cachedWidth = 0,
    this.cachedHeight = 0,
    this.frequencyBins,
    this.colCount = 0,
    this.startTime,
    this.endTime,
  });
}

/// Displays a batch of history packets as a scrollable spectrogram image.
///
/// Packets are normalized to [0, 1], truncated vertically to a shared row
/// (frequency) count, and concatenated left-to-right along the time axis so
/// that a multi-packet time range renders like the web dashboard.
class SpectrogramCanvas extends StatefulWidget {
  final List<DeviceHistory> histories;
  final List<List<double>>? colorMap;
  final double gainDb;
  final double noiseThreshold;
  final int? width;
  final int? height;
  final ui.Image? seedImage;
  final List<List<double>>? seedCachedCombined;
  final int seedCachedWidth;
  final int seedCachedHeight;
  final List<double>? seedFrequencyBins;
  final int seedColCount;
  final DateTime? seedStartTime;
  final DateTime? seedEndTime;

  const SpectrogramCanvas({
    super.key,
    this.histories = const [],
    this.colorMap,
    this.gainDb = 0.0,
    this.noiseThreshold = 0.06,
    this.width,
    this.height,
    this.seedImage,
    this.seedCachedCombined,
    this.seedCachedWidth = 0,
    this.seedCachedHeight = 0,
    this.seedFrequencyBins,
    this.seedColCount = 0,
    this.seedStartTime,
    this.seedEndTime,
  });

  @override
  State<SpectrogramCanvas> createState() => SpectrogramCanvasState();
}

class SpectrogramCanvasState extends State<SpectrogramCanvas> {
  ui.Image? _image;
  int _generation = 0;
  List<double>? _frequencyBins;
  DateTime? _startTime;
  DateTime? _endTime;
  int _colCount = 0;
  double _zoomLevel = 1.0;

  List<List<double>>? _cachedCombined;
  int _cachedWidth = 0;
  int _cachedHeight = 0;
  Timer? _renderDebounce;

  CanvasSeedSnapshot? get seedSnapshot {
    if (_image == null) return null;
    return CanvasSeedSnapshot(
      image: _image!,
      cachedCombined: _cachedCombined,
      cachedWidth: _cachedWidth,
      cachedHeight: _cachedHeight,
      frequencyBins: _frequencyBins,
      colCount: _colCount,
      startTime: _startTime,
      endTime: _endTime,
    );
  }

  void zoomIn() => setState(() => _zoomLevel = (_zoomLevel * 1.15).clamp(0.05, 4.0));
  void zoomOut() => setState(() => _zoomLevel = (_zoomLevel / 1.15).clamp(0.05, 4.0));
  void fitToScreen() {
    final img = _image;
    if (img == null) return;
    final w = context.size?.width ?? 400;
    final h = context.size?.height ?? 400;
    final imageAreaHeight = h - 24;
    final nativeHeight = imageAreaHeight > 0 ? imageAreaHeight : 400.0;
    final aspectRatio = img.width / img.height;
    final nativeWidth = nativeHeight * aspectRatio;
    final fitZoom = (w - 34) / nativeWidth;
    setState(() => _zoomLevel = fitZoom.clamp(0.05, 4.0));
  }

  @override
  void initState() {
    super.initState();
    if (widget.seedImage != null) {
      _image = widget.seedImage;
      _cachedCombined = widget.seedCachedCombined;
      _cachedWidth = widget.seedCachedWidth;
      _cachedHeight = widget.seedCachedHeight;
      _frequencyBins = widget.seedFrequencyBins;
      _colCount = widget.seedColCount;
      _startTime = widget.seedStartTime;
      _endTime = widget.seedEndTime;
    } else {
      _render();
    }
  }

  @override
  void didUpdateWidget(covariant SpectrogramCanvas oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.histories, widget.histories) ||
        oldWidget.noiseThreshold != widget.noiseThreshold) {
      _renderDebounced();
    } else if (oldWidget.colorMap != widget.colorMap ||
        oldWidget.gainDb != widget.gainDb) {
      _renderCached();
    }
  }

  void _renderDebounced() {
    _renderDebounce?.cancel();
    _renderDebounce = Timer(const Duration(milliseconds: 50), _render);
  }

  Future<void> _render() async {
    final gen = ++_generation;
    final histories = widget.histories.where((h) => h.data.isNotEmpty).toList();

    if (histories.isEmpty) {
      if (mounted && _image != null) {
        setState(() {
          _image = null;
          _cachedCombined = null;
        });
      }
      return;
    }

    List<double>? firstBins;
    DateTime? earliest;
    DateTime? latest;
    int maxRows = 0;
    int totalCols = 0;
    for (final history in histories) {
      if (history.data.length > maxRows) maxRows = history.data.length;
      totalCols += history.data.isNotEmpty ? history.data[0].length : 0;
      if (firstBins == null && history.frequencyBins != null && history.frequencyBins!.isNotEmpty) {
        firstBins = history.frequencyBins;
      }
      final st = history.startTime ?? history.timestamp;
      final et = history.endTime ?? history.timestamp;
      if (st.isNotEmpty) {
        final dt = DateTime.tryParse(st);
        if (dt != null && (earliest == null || dt.isBefore(earliest))) earliest = dt;
      }
      if (et.isNotEmpty) {
        final dt = DateTime.tryParse(et);
        if (dt != null && (latest == null || dt.isAfter(latest))) latest = dt;
      }
    }
    _frequencyBins = firstBins;
    _startTime = earliest;
    _endTime = latest;
    _colCount = totalCols;
    _cachedWidth = totalCols;
    _cachedHeight = maxRows;

    final rawBlocks = histories.map((h) => RawBlockData(
      h.data,
      h.intensityType,
      h.intensityRange[0],
      h.intensityRange[1],
    )).toList();

    ui.Image? image;
    try {
      final output = await SpectroIsolate.renderAndCache(
        rawBlocks: rawBlocks,
        colorMap: widget.colorMap ?? kColorMapMagma,
        gainDb: widget.gainDb,
        noiseThreshold: widget.noiseThreshold,
        width: totalCols,
        height: maxRows,
      );
      image = output.image;
      _cachedCombined = output.cachedCombined;
    } catch (_) {
      image = null;
    }

    if (!mounted || gen != _generation) {
      image?.dispose();
      return;
    }
    setState(() => _image = image);
  }

  Future<void> _renderCached() async {
    final combined = _cachedCombined;
    if (combined == null || _cachedWidth == 0 || _cachedHeight == 0) return;

    final gen = ++_generation;
    ui.Image? image;
    try {
      image = await SpectroIsolate.rasterizeOnly(
        cachedCombined: combined,
        colorMap: widget.colorMap ?? kColorMapMagma,
        gainDb: widget.gainDb,
        width: _cachedWidth,
        height: _cachedHeight,
      );
    } catch (_) {
      image = null;
    }

    if (!mounted || gen != _generation) {
      image?.dispose();
      return;
    }
    setState(() => _image = image);
  }

  @override
  void dispose() {
    _renderDebounce?.cancel();
    _image?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final img = _image;
    if (img == null) {
      return Container(
        color: const Color(0xFF140D28),
        alignment: Alignment.center,
        child: const Text(
          'لا توجد بيانات',
          style: TextStyle(color: Colors.white38, fontSize: 14),
        ),
      );
    }
    return LayoutBuilder(builder: (context, constraints) {
      final imageAreaHeight = constraints.maxHeight - 24;
      final nativeHeight = imageAreaHeight > 0 ? imageAreaHeight : 400.0;
      final aspectRatio = img.width / img.height;
      final nativeWidth = nativeHeight * aspectRatio;
      final displayWidth = nativeWidth * _zoomLevel;
      final displayHeight = nativeHeight * _zoomLevel;

      return Container(
        color: const Color(0xFF140D28),
        child: Stack(
          children: [
            SingleChildScrollView(
              scrollDirection: Axis.vertical,
              child: SizedBox(
                width: math.max(constraints.maxWidth, displayWidth + 34),
                height: math.max(constraints.maxHeight, displayHeight + 24),
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: SizedBox(
                    width: math.max(constraints.maxWidth, displayWidth + 34),
                    height: math.max(constraints.maxHeight, displayHeight + 24),
                    child: Stack(
                      children: [
                        Positioned(
                          left: 32,
                          top: 0,
                          width: displayWidth,
                          height: displayHeight,
                          child: RawImage(
                            image: img,
                            fit: BoxFit.fill,
                            filterQuality: FilterQuality.medium,
                          ),
                        ),
                        Positioned.fill(
                          child: CustomPaint(
                            painter: SpectrogramAxesPainter(
                              colCount: _colCount,
                              frequencyBins: _frequencyBins,
                              startTime: _startTime,
                              endTime: _endTime,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            Positioned(
              top: 8,
              right: 8,
              child: Column(
                children: [
                  _zoomBtn(Icons.add, () => zoomIn()),
                  const SizedBox(height: 4),
                  _zoomBtn(Icons.remove, () => zoomOut()),
                  const SizedBox(height: 4),
                  _zoomBtn(Icons.fit_screen, () => fitToScreen()),
                ],
              ),
            ),
          ],
        ),
      );
    });
  }

  Widget _zoomBtn(IconData icon, VoidCallback onTap) {
    return Material(
      color: Colors.black54,
      shape: const CircleBorder(),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Icon(icon, color: Colors.white70, size: 20),
        ),
      ),
    );
  }
}
