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

  List<List<double>>? _cachedCombined;
  int _cachedWidth = 0;
  int _cachedHeight = 0;

  double _viewportStart = 0.0;
  double _viewportEnd = 1.0;
  double _scaleStart = 1.0;
  Offset _lastFocalPoint = Offset.zero;
  Timer? _renderDebounce;

  double get _viewportSpan => _viewportEnd - _viewportStart;

  DateTime? get _visStartTime {
    if (_startTime == null || _endTime == null) return _startTime;
    final totalMs = _endTime!.difference(_startTime!).inMilliseconds;
    return _startTime!.add(Duration(milliseconds: (_viewportStart * totalMs).round()));
  }

  DateTime? get _visEndTime {
    if (_startTime == null || _endTime == null) return _endTime;
    final totalMs = _endTime!.difference(_startTime!).inMilliseconds;
    return _startTime!.add(Duration(milliseconds: (_viewportEnd * totalMs).round()));
  }

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

  List<AiStatusBlock> _computeAiStatusBlocks() {
    if (_startTime == null || _endTime == null || widget.histories.isEmpty) return [];
    final totalMs = _endTime!.difference(_startTime!).inMilliseconds;
    if (totalMs <= 0) return [];

    final visSpan = _viewportEnd - _viewportStart;
    final blocks = <AiStatusBlock>[];
    for (final h in widget.histories) {
      final hStart = DateTime.tryParse(h.startTime ?? h.timestamp);
      final hEnd = DateTime.tryParse(h.endTime ?? h.timestamp);
      if (hStart == null || hEnd == null) continue;

      final absStartFrac = hStart.difference(_startTime!).inMilliseconds / totalMs;
      final absEndFrac = hEnd.difference(_startTime!).inMilliseconds / totalMs;

      final visStartFrac = (absStartFrac - _viewportStart) / visSpan;
      final visEndFrac = (absEndFrac - _viewportStart) / visSpan;

      if (visEndFrac < 0.0 || visStartFrac > 1.0) continue;

      final color = _aiStatusColor(h.aiStatus);
      final label = _aiStatusLabel(h.aiStatus);
      if (color == null) continue;

      blocks.add(AiStatusBlock(
        startFraction: visStartFrac.clamp(0.0, 1.0),
        endFraction: visEndFrac.clamp(0.0, 1.0),
        color: color,
        label: label,
      ));
    }
    return blocks;
  }

  Color? _aiStatusColor(AiStatus s) {
    switch (s) {
      case AiStatus.notDetected:
        return const Color(0xFF21A366);
      case AiStatus.detected:
        return const Color(0xFFD13438);
      case AiStatus.possible:
        return const Color(0xFFF59E0B);
    }
  }

  String _aiStatusLabel(AiStatus s) {
    switch (s) {
      case AiStatus.notDetected:
        return 'لا يوجد هدف';
      case AiStatus.detected:
        return 'هدف مكتشف';
      case AiStatus.possible:
        return 'هدف محتمل';
    }
  }

  void zoomIn() {
    final center = (_viewportStart + _viewportEnd) / 2;
    final newSpan = (_viewportSpan * 0.9).clamp(0.005, 1.0);
    _setViewport(center - newSpan / 2, center + newSpan / 2);
  }

  void zoomOut() {
    final center = (_viewportStart + _viewportEnd) / 2;
    final newSpan = (_viewportSpan / 0.9).clamp(0.005, 20.0);
    _setViewport(center - newSpan / 2, center + newSpan / 2);
  }

  void fitToScreen() {
    _setViewport(0.0, 1.0);
  }

  void panLeft() {
    final shift = _viewportSpan * 0.15;
    _setViewport(_viewportStart - shift, _viewportEnd - shift);
  }

  void panRight() {
    final shift = _viewportSpan * 0.15;
    _setViewport(_viewportStart + shift, _viewportEnd + shift);
  }

  void _setViewport(double start, double end) {
    final span = end - start;
    if (span < 0.005) return;
    if (span > 20.0) return;
    setState(() {
      _viewportStart = start;
      _viewportEnd = end;
    });
    _rasterizeViewport();
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
      _rasterizeViewport();
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
      h.data, h.intensityType, h.intensityRange[0], h.intensityRange[1],
    )).toList();

    try {
      final output = await SpectroIsolate.renderAndCache(
        rawBlocks: rawBlocks,
        colorMap: widget.colorMap ?? kColorMapMagma,
        gainDb: widget.gainDb,
        noiseThreshold: widget.noiseThreshold,
        width: totalCols,
        height: maxRows,
      );

      if (!mounted || gen != _generation) {
        output.image.dispose();
        return;
      }
      _cachedCombined = output.cachedCombined;
      output.image.dispose();
      _rasterizeViewport();
    } catch (e) {
      debugPrint('[SpectrogramCanvas._render] ERROR: $e');
    }
  }

  Future<void> _rasterizeViewport() async {
    final combined = _cachedCombined;
    if (combined == null || _cachedWidth == 0 || _cachedHeight == 0) return;

    final gen = ++_generation;
    final startCol = (_viewportStart * _cachedWidth).floor();
    final endCol = (_viewportEnd * _cachedWidth).ceil();

    try {
      final image = await SpectroIsolate.rasterizeOnly(
        cachedCombined: combined,
        colorMap: widget.colorMap ?? kColorMapMagma,
        gainDb: widget.gainDb,
        width: _cachedWidth,
        height: _cachedHeight,
        startCol: startCol,
        endCol: endCol,
      );

      if (!mounted || gen != _generation) {
        image.dispose();
        return;
      }
      final old = _image;
      setState(() => _image = image);
      old?.dispose();
    } catch (e) {
      debugPrint('[SpectrogramCanvas._rasterizeViewport] ERROR: $e');
    }
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
      final containerWidth = constraints.maxWidth;
      final bottomPad = 18.0;
      final h = (constraints.maxHeight - bottomPad).clamp(0.0, constraints.maxHeight);

      return Container(
        color: const Color(0xFF140D28),
        child: GestureDetector(
          onScaleStart: (details) {
            _scaleStart = _viewportSpan;
            _lastFocalPoint = details.focalPoint;
          },
          onScaleUpdate: (details) {
            if (details.pointerCount == 1) {
              final dx = details.focalPoint.dx - _lastFocalPoint.dx;
              _lastFocalPoint = details.focalPoint;
              final shift = dx / containerWidth * _viewportSpan;
              _setViewport(_viewportStart - shift, _viewportEnd - shift);
            } else {
              final center = (_viewportStart + _viewportEnd) / 2;
              final newSpan = (_scaleStart / details.scale).clamp(0.005, 1.0);
              _setViewport(center - newSpan / 2, center + newSpan / 2);
            }
          },
          child: Stack(
            children: [
              Positioned(
                left: 32,
                top: 0,
                width: math.max(containerWidth - 34, 100),
                height: h,
                child: RawImage(
                  image: img,
                  fit: BoxFit.fill,
                  filterQuality: FilterQuality.medium,
                ),
              ),
              Positioned.fill(
                child: CustomPaint(
                  painter: SpectrogramAxesPainter(
                    colCount: (_viewportSpan * _colCount).round(),
                    frequencyBins: _frequencyBins,
                    startTime: _visStartTime,
                    endTime: _visEndTime,
                    aiStatusBlocks: _computeAiStatusBlocks(),
                  ),
                ),
              ),
              Positioned(
                top: 40,
                right: 8,
                child: Column(
                  children: [
                    _zoomBtn(Icons.add, () => zoomIn()),
                    const SizedBox(height: 4),
                    _zoomBtn(Icons.remove, () => zoomOut()),
                    const SizedBox(height: 4),
                    _zoomBtn(Icons.fit_screen, () => fitToScreen()),
                    const SizedBox(height: 4),
                    _zoomBtn(Icons.arrow_left, () => panLeft()),
                    const SizedBox(height: 4),
                    _zoomBtn(Icons.arrow_right, () => panRight()),
                  ],
                ),
              ),
            ],
          ),
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
