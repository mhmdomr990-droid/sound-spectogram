import 'dart:async';
import 'dart:typed_data' show Uint8List;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../models/device_history.dart';
import '../utils/spectro_isolate.dart';

const List<List<double>> kColorMapMagma = [
  [0.0, 0.0, 0.0157],
  [0.16, 28.0 / 255.0, 16.0 / 255.0, 68.0 / 255.0],
  [0.33, 79.0 / 255.0, 18.0 / 255.0, 123.0 / 255.0],
  [0.5, 129.0 / 255.0, 37.0 / 255.0, 129.0 / 255.0],
  [0.66, 181.0 / 255.0, 54.0 / 255.0, 122.0 / 255.0],
  [0.83, 229.0 / 255.0, 80.0 / 255.0, 100.0 / 255.0],
  [1.0, 252.0 / 255.0, 253.0 / 255.0, 191.0 / 255.0],
];

const List<List<double>> kColorMapSunset = [
  [0.0, 15.0 / 255.0, 16.0 / 255.0, 50.0 / 255.0],
  [0.2, 45.0 / 255.0, 24.0 / 255.0, 105.0 / 255.0],
  [0.4, 98.0 / 255.0, 33.0 / 255.0, 135.0 / 255.0],
  [0.6, 170.0 / 255.0, 52.0 / 255.0, 112.0 / 255.0],
  [0.8, 235.0 / 255.0, 96.0 / 255.0, 70.0 / 255.0],
  [1.0, 255.0 / 255.0, 190.0 / 255.0, 92.0 / 255.0],
];

const List<List<double>> kColorMapViridis = [
  [0.0, 68.0 / 255.0, 1.0 / 255.0, 84.0 / 255.0],
  [0.25, 59.0 / 255.0, 82.0 / 255.0, 139.0 / 255.0],
  [0.5, 33.0 / 255.0, 145.0 / 255.0, 140.0 / 255.0],
  [0.75, 94.0 / 255.0, 201.0 / 255.0, 97.0 / 255.0],
  [1.0, 253.0 / 255.0, 231.0 / 255.0, 37.0 / 255.0],
];

const List<List<List<double>>> kColorMaps = [
  kColorMapMagma,
  kColorMapSunset,
  kColorMapViridis,
];

const List<String> kColorMapNames = ['magma', 'sunset', 'viridis'];

class CanvasSeedSnapshot {
  final ui.Image? image;
  final List<List<double>>? cachedCombined;
  final int cachedWidth;
  final int cachedHeight;
  final List<double>? frequencyBins;
  final int colCount;
  final DateTime? startTime;
  final DateTime? endTime;

  const CanvasSeedSnapshot({
    this.image,
    this.cachedCombined,
    this.cachedWidth = 0,
    this.cachedHeight = 0,
    this.frequencyBins,
    this.colCount = 0,
    this.startTime,
    this.endTime,
  });
}

/// Renders a frequency x time matrix as a spectrogram using ui.Image + RGBA
/// bytes generated in an isolate (avoids blocking the UI thread).
///
/// After drawing the data surface (identical to the web dashboard's
/// intensity buffer), it overlays the dashboard's GUI layer: dark background,
/// frequency/time grid, axes and axis labels, with proportional margins.
class SpectrogramCanvas extends StatefulWidget {
  final List<List<num>> matrix;
  final List<DeviceHistory>? histories;
  final double gamma;
  final int inputValueMax;
  final double gainDb;
  final Color background;
  final bool smoothVertical;
  final String? intensityType;
  final List<num>? frequencyBins;
  final String? startTime;
  final String? endTime;
  final List<List<double>> colorMap;
  final double noiseThreshold;
  final ui.Image? seedImage;
  final List<List<double>>? seedCachedCombined;
  final int seedCachedWidth;
  final int seedCachedHeight;
  final List<double>? seedFrequencyBins;
  final int seedColCount;
  final DateTime? seedStartTime;
  final DateTime? seedEndTime;

  /// Optional labels shown on the left (frequency) and bottom (time) axes.
  /// When null, generic tick labels are used.
  final List<String>? frequencyLabels;
  final List<String>? timeLabels;

  /// Requested time range for live mode (overrides data timestamps for axis labels).
  final String? requestStartTime;
  final String? requestEndTime;

  const SpectrogramCanvas({
    super.key,
    this.matrix = const [],
    this.histories,
    this.gamma = 1.0,
    this.inputValueMax = 255,
    this.gainDb = 0.0,
    this.background = const Color(0xFF111026),
    this.smoothVertical = true,
    this.intensityType,
    this.frequencyBins,
    this.startTime,
    this.endTime,
    this.colorMap = kColorMapMagma,
    this.noiseThreshold = 0.06,
    this.seedImage,
    this.seedCachedCombined,
    this.seedCachedWidth = 0,
    this.seedCachedHeight = 0,
    this.seedFrequencyBins,
    this.seedColCount = 0,
    this.seedStartTime,
    this.seedEndTime,
    this.frequencyLabels,
    this.timeLabels,
    this.requestStartTime,
    this.requestEndTime,
  });

  @override
  State<SpectrogramCanvas> createState() => SpectrogramCanvasState();
}

class SpectrogramCanvasState extends State<SpectrogramCanvas> {
  CanvasSeedSnapshot? seedSnapshot;

  // Viewport: horizontal (time-axis) range [0..1]
  double _viewportStart = 0.0;
  double _viewportEnd = 1.0;
  double _scaleStart = 1.0;
  Offset _lastFocalPoint = Offset.zero;

  void forceRender() {
    if (mounted) setState(() {});
  }

  void fitToScreen() {
    setState(() {
      _viewportStart = 0.0;
      _viewportEnd = 1.0;
    });
  }
  ui.Image? _image;
  int _jobId = 0;
  Size _layoutSize = Size.zero;
  double _dpr = 1.0;
  Timer? _renderDebounce;

  @override
  void initState() {
    super.initState();
  }

  @override
  void didUpdateWidget(SpectrogramCanvas oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.matrix != widget.matrix ||
        oldWidget.gamma != widget.gamma ||
        oldWidget.inputValueMax != widget.inputValueMax ||
        oldWidget.gainDb != widget.gainDb) {
      _renderDebounce?.cancel();
      _renderDebounce = Timer(const Duration(milliseconds: 100), () {
        if (mounted) _render();
      });
    }
    if (oldWidget.histories != widget.histories ||
        oldWidget.requestStartTime != widget.requestStartTime ||
        oldWidget.requestEndTime != widget.requestEndTime) {
      _renderDebounce?.cancel();
      _renderDebounce = Timer(const Duration(milliseconds: 100), () {
        if (mounted) _render();
      });
    }
  }

  static int? _stateParseMs(String? iso) {
    if (iso == null || iso.isEmpty) return null;
    final d = DateTime.tryParse(iso);
    return d?.millisecondsSinceEpoch;
  }

  double? _computeColsPerMs(List<DeviceHistory> histories) {
    int totalDataCols = 0;
    int totalDataMs = 0;
    for (final h in histories) {
      if (h.data.isEmpty) continue;
      final s = _stateParseMs(h.startTime);
      final e = _stateParseMs(h.endTime);
      if (s != null && e != null && e > s) {
        totalDataCols += h.data[0].length;
        totalDataMs += e - s;
      }
    }
    if (totalDataMs <= 0 || totalDataCols <= 0) return null;
    return totalDataCols / totalDataMs;
  }

  List<List<num>> _resolvedMatrix() {
    if (widget.matrix.isNotEmpty) {
      return widget.matrix;
    }
    final histories = widget.histories;
    if (histories == null || histories.isEmpty) {
      return const [];
    }

    final fromMs = _stateParseMs(widget.requestStartTime ?? histories.first.startTime);
    final toMs = _stateParseMs(widget.requestEndTime ?? histories.last.endTime);
    if (fromMs == null || toMs == null || toMs <= fromMs) {
      return _resolvedMatrixFallback(histories);
    }

    final colsPerMs = _computeColsPerMs(histories);
    if (colsPerMs == null) {
      return _resolvedMatrixFallback(histories);
    }

    final rangeMs = toMs - fromMs;
    final totalCols = (rangeMs * colsPerMs).round();
    if (totalCols <= 0) return const [];

    int targetRows = 0;
    for (final h in histories) {
      if (h.data.length > targetRows) targetRows = h.data.length;
    }
    if (targetRows == 0) return const [];

    final combined = List.generate(targetRows, (_) => List<num>.filled(totalCols, 0));

    for (final h in histories) {
      if (h.data.isEmpty) continue;
      final s = _stateParseMs(h.startTime);
      final e = _stateParseMs(h.endTime);
      if (s == null || e == null || e <= s) continue;

      final startCol = ((s - fromMs) * colsPerMs).round().clamp(0, totalCols);
      final endCol = ((e - fromMs) * colsPerMs).round().clamp(0, totalCols);
      final srcRows = h.data.length;
      final srcCols = h.data[0].length;

      for (int r = 0; r < targetRows; r++) {
        if (r >= srcRows) continue;
        final srcRow = h.data[r];
        final width = (endCol - startCol).clamp(0, srcCols);
        for (int c = 0; c < width; c++) {
          combined[r][startCol + c] = srcRow[c < srcCols ? c : srcCols - 1];
        }
      }
    }

    return combined;
  }

  List<List<num>> _resolvedMatrixFallback(List<DeviceHistory> histories) {
    final dataBlocks = histories.where((entry) => entry.data.isNotEmpty).toList();
    if (dataBlocks.isEmpty) return const [];

    final first = dataBlocks.first.data;
    final combined = first
        .map((row) => List<num>.from(row, growable: true))
        .toList(growable: true);

    for (int i = 1; i < dataBlocks.length; i++) {
      final current = dataBlocks[i].data;
      if (current.isEmpty) continue;
      final rows = combined.length;
      final extraRows = current.length;
      final targetRows = rows > extraRows ? rows : extraRows;
      for (int r = 0; r < targetRows; r++) {
        final left = r < combined.length ? combined[r] : <num>[];
        final right = r < current.length ? current[r] : const <num>[];
        final merged = <num>[];
        merged.addAll(left);
        merged.addAll(right);
        if (r < combined.length) {
          combined[r] = merged;
        } else {
          combined.add(merged);
        }
      }
    }

    return combined;
  }

  Future<void> _render() async {
    final renderMatrix = _resolvedMatrix();
    final id = ++_jobId;
    if (renderMatrix.isEmpty || _layoutSize == Size.zero) {
      _image?.dispose();
      _image = null;
      if (mounted) setState(() {});
      return;
    }

    // Render the full matrix at its natural dimensions so the app does not
    // crop or compress half of the spectrogram before drawing it to the screen.
    // The painter will then scale the resulting image to the visible canvas,
    // matching the web behavior while keeping the mobile fullscreen layout full.
    final dataWidth = renderMatrix.isNotEmpty && renderMatrix.first.isNotEmpty ? renderMatrix.first.length : 1;
    final dataHeight = renderMatrix.length;
    final width = dataWidth.clamp(1, 4096);
    final height = dataHeight.clamp(1, 4096);

    try {
      final result = await renderSpectrogramIsolate(
        RenderRequest(
          matrix: renderMatrix,
          width: width,
          height: height,
          gamma: widget.gamma,
          inputValueMax: widget.inputValueMax,
          // Match the web dashboard: when the server does not report an
          // intensity type, infer it from the data (uint8 here) exactly like
          // the web's resolveIntensityType -> inferImageIntensityType.
          intensityType: widget.intensityType ?? widget.histories?.firstOrNull?.intensityType,
          startTimeIso: widget.startTime ?? widget.histories?.firstOrNull?.startTime,
          endTimeIso: widget.endTime ?? widget.histories?.firstOrNull?.endTime,
          debug: true,
          gainDb: widget.gainDb,
          backgroundColor: widget.background.toARGB32(),
        ),
      );
      if (!mounted || id != _jobId) return;
      final image = await rgbaToUiImage(result.rgba, width, height);
      if (!mounted || id != _jobId) return;
      _image?.dispose();
      setState(() => _image = image);
    } catch (_) {
      if (!mounted || id != _jobId) return;
      setState(() => _image = null);
    }
  }


  @override
  void dispose() {
    _renderDebounce?.cancel();
    _jobId++;
    _image?.dispose();
    super.dispose();
  }

  List<CoverageInterval> _buildCoverageIntervals() {
    final histories = widget.histories;
    if (histories == null || histories.isEmpty) return const [];

    final fromMs = _stateParseMs(widget.requestStartTime ?? histories.first.startTime);
    final toMs = _stateParseMs(widget.requestEndTime ?? histories.last.endTime);
    if (fromMs == null || toMs == null || toMs <= fromMs) {
      return _buildCoverageIntervalsFallback(histories);
    }

    final colsPerMs = _computeColsPerMs(histories);
    if (colsPerMs == null) return _buildCoverageIntervalsFallback(histories);

    final intervals = <CoverageInterval>[];
    for (final h in histories) {
      if (h.data.isEmpty) continue;
      final s = _stateParseMs(h.startTime);
      final e = _stateParseMs(h.endTime);
      if (s == null || e == null || e <= s) continue;
      final startCol = ((s - fromMs) * colsPerMs).round().clamp(0, 1 << 30);
      final endCol = ((e - fromMs) * colsPerMs).round().clamp(0, 1 << 30);
      if (endCol > startCol) {
        intervals.add(CoverageInterval(startMs: startCol, endMs: endCol));
      }
    }
    return intervals;
  }

  List<CoverageInterval> _buildCoverageIntervalsFallback(List<DeviceHistory> histories) {
    final intervals = <CoverageInterval>[];
    int cumCols = 0;
    for (final h in histories) {
      if (h.data.isEmpty) continue;
      final blockCols = h.data[0].length;
      intervals.add(CoverageInterval(startMs: cumCols, endMs: cumCols + blockCols));
      cumCols += blockCols;
    }
    return intervals;
  }

  int _totalCols() {
    final histories = widget.histories;
    if (histories == null || histories.isEmpty) return 0;

    final fromMs = _stateParseMs(widget.requestStartTime ?? (histories.isNotEmpty ? histories.first.startTime : null));
    final toMs = _stateParseMs(widget.requestEndTime ?? (histories.isNotEmpty ? histories.last.endTime : null));
    if (fromMs == null || toMs == null || toMs <= fromMs) {
      int total = 0;
      for (final h in histories) {
        if (h.data.isEmpty) continue;
        total += h.data[0].length;
      }
      return total;
    }

    final colsPerMs = _computeColsPerMs(histories);
    if (colsPerMs == null) return 0;
    return ((toMs - fromMs) * colsPerMs).round();
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.hasBoundedWidth && constraints.hasBoundedHeight) {
          final size = constraints.biggest;
          final dpr = MediaQuery.devicePixelRatioOf(context);
          if (size != _layoutSize || dpr != _dpr) {
            _layoutSize = size;
            _dpr = dpr;
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (mounted) _render();
            });
          }
        }
        final img = _image;
        if (img == null) {
          return Container(
            color: widget.background,
            alignment: Alignment.center,
            child: const Text(
              'لا توجد بيانات طيف',
              style: TextStyle(color: Colors.white54),
            ),
          );
        }
        return SizedBox.expand(
          child: Container(
            color: widget.background,
            child: GestureDetector(
              onScaleStart: (details) {
                _scaleStart = _viewportEnd - _viewportStart;
                _lastFocalPoint = details.focalPoint;
              },
              onScaleUpdate: (details) {
                final w = _layoutSize.width;
                if (w <= 0) return;
                if (details.pointerCount == 2) {
                  final newSpan = (_scaleStart / details.scale).clamp(0.005, 5.0);
                  final anchor = (_lastFocalPoint.dx / w).clamp(0.0, 1.0);
                  final center = _viewportStart + (_viewportEnd - _viewportStart) * anchor;
                  var newStart = center - newSpan * anchor;
                  var newEnd = newStart + newSpan;
                  if (newStart < -(newSpan * 0.8)) newStart = -(newSpan * 0.8);
                  if (newEnd > 1.0 + newSpan * 0.8) newEnd = 1.0 + newSpan * 0.8;
                  setState(() { _viewportStart = newStart; _viewportEnd = newEnd; });
                } else if (details.pointerCount == 1) {
                  final dx = details.focalPoint.dx - _lastFocalPoint.dx;
                  _lastFocalPoint = details.focalPoint;
                  final span = _viewportEnd - _viewportStart;
                  final shift = dx / w * span;
                  var newStart = _viewportStart - shift;
                  var newEnd = _viewportEnd - shift;
                  if (newStart < -(span * 0.8)) newStart = -(span * 0.8);
                  if (newEnd > 1.0 + span * 0.8) newEnd = 1.0 + span * 0.8;
                  setState(() { _viewportStart = newStart; _viewportEnd = newEnd; });
                }
              },
              child: CustomPaint(
                size: Size(constraints.maxWidth, constraints.maxHeight),
                painter: _SpectroPainter(
                  img,
                  background: widget.background,
                  smoothVertical: widget.smoothVertical,
                  frequencyLabels: widget.frequencyLabels,
                  timeLabels: widget.timeLabels,
                  viewportStart: _viewportStart,
                  viewportEnd: _viewportEnd,
                  startTimeIso: widget.requestStartTime ?? widget.startTime ?? widget.histories?.firstOrNull?.startTime,
                  endTimeIso: widget.requestEndTime ?? widget.endTime ?? widget.histories?.lastOrNull?.endTime,
                  coverageIntervals: _buildCoverageIntervals(),
                  totalCols: _totalCols(),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class CoverageInterval {
  final int startMs;
  final int endMs;
  const CoverageInterval({required this.startMs, required this.endMs});
}

class _SpectroPainter extends CustomPainter {
  final ui.Image image;
  final Color background;
  final List<String>? frequencyLabels;
  final List<String>? timeLabels;
  final bool smoothVertical;
  final double viewportStart;
  final double viewportEnd;
  final String? startTimeIso;
  final String? endTimeIso;
  final List<CoverageInterval>? coverageIntervals;
  final int totalCols;

  _SpectroPainter(this.image,
      {this.background = const Color(0xFF111026),
      this.frequencyLabels,
      this.timeLabels,
      this.smoothVertical = true,
      this.viewportStart = 0.0,
      this.viewportEnd = 1.0,
      this.startTimeIso,
      this.endTimeIso,
      this.coverageIntervals,
      this.totalCols = 0});

  static const double _leftInset = 40;
  static const double _rightInset = 6;
  static const double _topInset = 4;
  static const double _bottomInset = 36;
  static const int _xTicks = 5;
  static const int _yTicks = 5;
  static const double _maxFrequency = 250.0;

  static const Color _gridColor = Color(0x29CFD7E6);
  static const Color _axisColor = Color(0xFFCFD7E6);
  static const Color _textColor = Color(0xFFD8E2FF);
  static const Color _gapFill = Color(0x423667C2);
  static const Color _gapStroke = Color(0xE766C4E7);

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    if (w <= 0 || h <= 0 || image.width <= 0 || image.height <= 0) return;

    final pLeft = _leftInset;
    final pTop = _topInset;
    final plotW = w - _leftInset - _rightInset;
    final plotH = h - _topInset - _bottomInset;
    if (plotW <= 0 || plotH <= 0) return;

    final paint = Paint()
      ..isAntiAlias = false
      ..filterQuality = FilterQuality.none;

    // 1) Background.
    canvas.drawRect(Rect.fromLTWH(0, 0, w, h), Paint()..color = const Color(0xFF140D28));

    // 2) Spectrogram image with viewport.
    final span = viewportEnd - viewportStart;
    if (span > 0) {
      final dataStart = viewportStart.clamp(0.0, 1.0);
      final dataEnd = viewportEnd.clamp(0.0, 1.0);
      final srcX0 = (dataStart * image.width).round();
      final srcX1 = (dataEnd * image.width).round();
      final destX0 = pLeft + ((dataStart - viewportStart) / span) * plotW;
      final destX1 = pLeft + ((dataEnd - viewportStart) / span) * plotW;
      final src = Rect.fromLTWH(srcX0.toDouble(), 0, (srcX1 - srcX0).toDouble(), image.height.toDouble());
      final dst = Rect.fromLTWH(destX0, pTop, destX1 - destX0, plotH);
      canvas.drawImageRect(image, src, dst, paint);
    }

    // Compute viewport time range for labels.
    final dataFromMs = _parseMs(startTimeIso);
    final dataToMs = _parseMs(endTimeIso);
    final fromMs = dataFromMs != null && dataToMs != null
        ? (dataFromMs + ((dataToMs - dataFromMs) * viewportStart)).round()
        : dataFromMs;
    final toMs = dataFromMs != null && dataToMs != null
        ? (dataFromMs + ((dataToMs - dataFromMs) * viewportEnd)).round()
        : dataToMs;

    // 2b) Gap overlays using column-based positioning (matches image layout).
    if (coverageIntervals != null && coverageIntervals!.isNotEmpty && span > 0 && totalCols > 0) {
      final tc = totalCols;
      final visStartCol = (viewportStart * tc).round();
      final visEndCol = (viewportEnd * tc).round();
      final visCols = visEndCol - visStartCol;
      if (visCols > 0) {
        final sorted = List<CoverageInterval>.from(coverageIntervals!)
          ..sort((a, b) => a.startMs.compareTo(b.startMs));
        final merged = <CoverageInterval>[];
        for (final iv in sorted) {
          final clippedStart = iv.startMs.clamp(visStartCol, visEndCol);
          final clippedEnd = iv.endMs.clamp(visStartCol, visEndCol);
          if (clippedEnd <= clippedStart) continue;
          if (merged.isNotEmpty && clippedStart <= merged.last.endMs) {
            merged[merged.length - 1] = CoverageInterval(
                startMs: merged.last.startMs,
                endMs: clippedEnd > merged.last.endMs ? clippedEnd : merged.last.endMs);
          } else {
            merged.add(CoverageInterval(startMs: clippedStart, endMs: clippedEnd));
          }
        }
        final gapFillPaint = Paint()..color = _gapFill;
        final gapStrokePaint = Paint()
          ..color = _gapStroke
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1;
        final gapStyle = TextStyle(color: Color(0xF2E1F4FF), fontSize: 11);
        var cursor = visStartCol;
        for (final iv in merged) {
          if (iv.startMs > cursor) {
            final gx0 = pLeft + ((cursor - visStartCol) / visCols) * plotW;
            final gx1 = pLeft + ((iv.startMs - visStartCol) / visCols) * plotW;
            final gw = gx1 - gx0;
            canvas.drawRect(Rect.fromLTWH(gx0, pTop, gw, plotH), gapFillPaint);
            canvas.drawLine(Offset(gx0, pTop), Offset(gx0, pTop + plotH), gapStrokePaint);
            canvas.drawLine(Offset(gx1, pTop), Offset(gx1, pTop + plotH), gapStrokePaint);
            if (gw >= 52) {
              final gapMin = ((iv.startMs - cursor) / visCols * (toMs! - fromMs!) / 60000).round();
              final gt = TextPainter(
                text: TextSpan(text: 'لا توجد بيانات $gapMin د', style: gapStyle),
                textDirection: TextDirection.rtl,
              )..layout();
              gt.paint(canvas, Offset(gx0 + gw / 2 - gt.width / 2, pTop + 4));
            }
          }
          if (iv.endMs > cursor) cursor = iv.endMs;
        }
        if (cursor < visEndCol) {
          final gx0 = pLeft + ((cursor - visStartCol) / visCols) * plotW;
          final gx1 = pLeft + plotW;
          final gw = gx1 - gx0;
          canvas.drawRect(Rect.fromLTWH(gx0, pTop, gw, plotH), gapFillPaint);
          canvas.drawLine(Offset(gx0, pTop), Offset(gx0, pTop + plotH), gapStrokePaint);
          canvas.drawLine(Offset(gx1, pTop), Offset(gx1, pTop + plotH), gapStrokePaint);
          if (gw >= 52) {
            final gapMin = ((visEndCol - cursor) / visCols * (toMs! - fromMs!) / 60000).round();
            final gt = TextPainter(
              text: TextSpan(text: 'لا توجد بيانات $gapMin د', style: gapStyle),
              textDirection: TextDirection.rtl,
            )..layout();
            gt.paint(canvas, Offset(gx0 + gw / 2 - gt.width / 2, pTop + 4));
          }
        }
      }
    }

    // 3) Grid lines.
    final gridPaint = Paint()..color = _gridColor..strokeWidth = 1;
    for (var i = 0; i <= _xTicks; i++) {
      final x = pLeft + (plotW * i / _xTicks).roundToDouble();
      canvas.drawLine(Offset(x, pTop), Offset(x, pTop + plotH), gridPaint);
    }
    for (var i = 0; i <= _yTicks; i++) {
      final y = pTop + (plotH * i / _yTicks).roundToDouble();
      canvas.drawLine(Offset(pLeft, y), Offset(pLeft + plotW, y), gridPaint);
    }

    // 4) Axes stroke (left + bottom).
    final axisPaint = Paint()
      ..color = _axisColor
      ..strokeWidth = 1.2
      ..style = PaintingStyle.stroke;
    canvas.drawPath(
        Path()
          ..moveTo(pLeft, pTop)
          ..lineTo(pLeft, pTop + plotH)
          ..lineTo(pLeft + plotW, pTop + plotH),
        axisPaint);

    // 5) Time (x) axis labels.
    final timeStyle = TextStyle(color: _textColor, fontSize: 10);
    final withDate = (toMs != null && fromMs != null) && (toMs - fromMs > 24 * 3600 * 1000);
    for (var i = 0; i <= _xTicks; i++) {
      final label = _timeLabelFor(i, _xTicks, fromMs, toMs, withDate);
      final x = pLeft + plotW * i / _xTicks;
      final tp = TextPainter(
        text: TextSpan(text: label, style: timeStyle),
        textDirection: TextDirection.ltr,
      )..layout();
      tp.paint(canvas, Offset(x - tp.width / 2, pTop + plotH + 6));
    }

    // 6) Frequency (y) axis labels — 0 to 250 Hz.
    final freqStyle = TextStyle(color: _textColor, fontSize: 10);
    for (var i = 0; i <= _yTicks; i++) {
      final hz = ((_yTicks - i) * _maxFrequency / _yTicks).round();
      final label = '$hz';
      final y = pTop + plotH * i / _yTicks;
      final fp = TextPainter(
        text: TextSpan(text: label, style: freqStyle),
        textDirection: TextDirection.ltr,
      )..layout();
      fp.paint(canvas, Offset(pLeft - 6 - fp.width, y - fp.height / 2));
    }

    // 7) Axis titles.
    final titleStyle = TextStyle(color: _textColor, fontSize: 10);
    canvas.save();
    canvas.translate(10, pTop + plotH / 2);
    canvas.rotate(-3.141592653589793 / 2);
    final freqTitle = TextPainter(
      text: TextSpan(text: 'التردد (Hz)', style: titleStyle),
      textDirection: TextDirection.rtl,
    )..layout();
    freqTitle.paint(canvas, Offset(-freqTitle.width / 2, -freqTitle.height / 2));
    canvas.restore();

    final timeTitle = TextPainter(
      text: TextSpan(text: 'الزمن', style: titleStyle),
      textDirection: TextDirection.rtl,
    )..layout();
    timeTitle.paint(canvas, Offset(pLeft + plotW / 2 - timeTitle.width / 2, pTop + plotH + 20));
  }

  static int? _parseMs(String? iso) {
    if (iso == null || iso.isEmpty) return null;
    final d = DateTime.tryParse(iso);
    return d?.millisecondsSinceEpoch;
  }

  static String _fmtTime(int ms, bool withDate) {
    final d = DateTime.fromMillisecondsSinceEpoch(ms);
    final hh = d.hour.toString().padLeft(2, '0');
    final mm = d.minute.toString().padLeft(2, '0');
    if (!withDate) return '$hh:$mm';
    final y = d.year;
    final mon = d.month.toString().padLeft(2, '0');
    final day = d.day.toString().padLeft(2, '0');
    return '$y-$mon-$day $hh:$mm';
  }

  String _timeLabelFor(int i, int n, int? fromMs, int? toMs, bool withDate) {
    if (timeLabels != null && i < timeLabels!.length) return timeLabels![i];
    if (fromMs == null || toMs == null) return '';
    final labelMs = fromMs + ((toMs - fromMs) * i / n).round();
    return _fmtTime(labelMs, withDate);
  }

  @override
  bool shouldRepaint(covariant _SpectroPainter oldDelegate) {
    return oldDelegate.image != image ||
        oldDelegate.background != background ||
        oldDelegate.viewportStart != viewportStart ||
        oldDelegate.viewportEnd != viewportEnd;
  }
}
