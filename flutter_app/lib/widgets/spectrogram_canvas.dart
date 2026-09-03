import 'dart:async';
import 'dart:io' show Directory, File;
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
      _render();
    }  }

  List<List<num>> _resolvedMatrix() {
    if (widget.matrix.isNotEmpty) {
      return widget.matrix;
    }
    final histories = widget.histories;
    if (histories == null || histories.isEmpty) {
      return const [];
    }

    final dataBlocks = histories.where((entry) => entry.data.isNotEmpty).toList();
    if (dataBlocks.isEmpty) {
      return const [];
    }

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
      await _exportDebugElt(image, result.rgba, width, height);
      setState(() => _image = image);
    } catch (_) {
      if (!mounted || id != _jobId) return;
      setState(() => _image = null);
    }
  }

  Future<void> _exportDebugElt(
      ui.Image img, Uint8List rgba, int width, int height) async {
    try {
      final byteData =
          await img.toByteData(format: ui.ImageByteFormat.png);
      if (byteData == null) return;
      final dir = Directory('/data/data/com.example.spectro_phone/cache');
      await dir.create(recursive: true);
      final stamp = DateTime.now().millisecondsSinceEpoch;
      await File(
              '${dir.path}/spectro_surface_$stamp.png')
          .writeAsBytes(byteData.buffer.asUint8List());
      const f = 'SPECTRO_DEBUG_SAVED';
      // ignore: avoid_print
      print('$f surface_${width}x${height} '
          'nonzero=${rgba.where((v) => v != 0).length} '
          'file=spectro_surface_$stamp.png');
    } catch (e) {
      // ignore: avoid_print
      print('SPECTRO_DEBUG_SAVE_ERR $e');
    }
  }

  @override
  void dispose() {
    _jobId++;
    _image?.dispose();
    super.dispose();
  }

  List<CoverageInterval> _buildCoverageIntervals() {
    final histories = widget.histories;
    if (histories == null || histories.isEmpty) return const [];
    final intervals = <CoverageInterval>[];
    for (final h in histories) {
      if (h.startTime == null || h.endTime == null) continue;
      final s = DateTime.tryParse(h.startTime!);
      final e = DateTime.tryParse(h.endTime!);
      if (s == null || e == null) continue;
      intervals.add(CoverageInterval(startMs: s.millisecondsSinceEpoch, endMs: e.millisecondsSinceEpoch));
    }
    return intervals;
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
            // ignore: avoid_print
            print('DBG_LAYOUT size=${size.width.toStringAsFixed(1)}'
                'x${size.height.toStringAsFixed(1)} dpr=${dpr.toStringAsFixed(2)}');
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
                  startTimeIso: widget.startTime ?? widget.histories?.firstOrNull?.startTime,
                  endTimeIso: widget.endTime ?? widget.histories?.lastOrNull?.endTime,
                  coverageIntervals: _buildCoverageIntervals(),
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

  _SpectroPainter(this.image,
      {this.background = const Color(0xFF111026),
      this.frequencyLabels,
      this.timeLabels,
      this.smoothVertical = true,
      this.viewportStart = 0.0,
      this.viewportEnd = 1.0,
      this.startTimeIso,
      this.endTimeIso,
      this.coverageIntervals});

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

    // Compute viewport time range for labels and gaps.
    final dataFromMs = _parseMs(startTimeIso);
    final dataToMs = _parseMs(endTimeIso);
    final fromMs = dataFromMs != null && dataToMs != null
        ? (dataFromMs + ((dataToMs - dataFromMs) * viewportStart)).round()
        : dataFromMs;
    final toMs = dataFromMs != null && dataToMs != null
        ? (dataFromMs + ((dataToMs - dataFromMs) * viewportEnd)).round()
        : dataToMs;

    // 2b) Gap overlays (time ranges with no data).
    if (coverageIntervals != null && coverageIntervals!.isNotEmpty && span > 0 && fromMs != null && toMs != null) {
      final totalMs = toMs - fromMs;
      if (totalMs > 0) {
        final sorted = List<CoverageInterval>.from(coverageIntervals!)
          ..sort((a, b) => a.startMs.compareTo(b.startMs));
        final merged = <CoverageInterval>[];
        for (final iv in sorted) {
          final clippedStart = iv.startMs.clamp(fromMs, toMs);
          final clippedEnd = iv.endMs.clamp(fromMs, toMs);
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
        final gapStyle = TextStyle(color: _gapStroke, fontSize: 11);
        var cursor = fromMs;
        for (final iv in merged) {
          if (iv.startMs > cursor) {
            final gx0 = pLeft + ((cursor - fromMs) / totalMs) * plotW;
            final gx1 = pLeft + ((iv.startMs - fromMs) / totalMs) * plotW;
            final gw = gx1 - gx0;
            canvas.drawRect(Rect.fromLTWH(gx0, pTop, gw, plotH), gapFillPaint);
            canvas.drawLine(Offset(gx0, pTop), Offset(gx0, pTop + plotH), gapStrokePaint);
            canvas.drawLine(Offset(gx1, pTop), Offset(gx1, pTop + plotH), gapStrokePaint);
            if (gw >= 72) {
              final gapMin = ((iv.startMs - cursor) / 60000).round();
              final gt = TextPainter(
                text: TextSpan(text: 'لا توجد بيانات $gapMin د', style: gapStyle),
                textDirection: TextDirection.rtl,
              )..layout();
              gt.paint(canvas, Offset(gx0 + gw / 2 - gt.width / 2, pTop + 4));
            }
          }
          if (iv.endMs > cursor) cursor = iv.endMs;
        }
        if (cursor < toMs) {
          final gx0 = pLeft + ((cursor - fromMs) / totalMs) * plotW;
          final gx1 = pLeft + plotW;
          final gw = gx1 - gx0;
          canvas.drawRect(Rect.fromLTWH(gx0, pTop, gw, plotH), gapFillPaint);
          canvas.drawLine(Offset(gx1, pTop), Offset(gx1, pTop + plotH), gapStrokePaint);
          if (gw >= 72) {
            final gapMin = ((toMs - cursor) / 60000).round();
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
