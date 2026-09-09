import 'dart:async';
import 'dart:math';
import 'dart:typed_data' show Uint8List;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../models/device_history.dart';
import '../models/marker.dart';
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
  final Uint8List? cachedIntensity;
  final int intensityWidth;
  final int intensityHeight;
  final double cachedGamma;

  const CanvasSeedSnapshot({
    this.image,
    this.cachedCombined,
    this.cachedWidth = 0,
    this.cachedHeight = 0,
    this.frequencyBins,
    this.colCount = 0,
    this.startTime,
    this.endTime,
    this.cachedIntensity,
    this.intensityWidth = 0,
    this.intensityHeight = 0,
    this.cachedGamma = 1.0,
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
  final Uint8List? seedIntensity;
  final int seedIntensityWidth;
  final int seedIntensityHeight;
  final double seedGamma;

  /// Optional labels shown on the left (frequency) and bottom (time) axes.
  /// When null, generic tick labels are used.
  final List<String>? frequencyLabels;
  final List<String>? timeLabels;

  /// Requested time range for live mode (overrides data timestamps for axis labels).
  final String? requestStartTime;
  final String? requestEndTime;
  final ValueNotifier<double>? gainNotifier;
  final bool showStatusBar;
  final bool compactStatusBar;
  final List<MarkerData> markers;
  final ValueChanged<int>? onMarkerAdd;
  final void Function(int index)? onMarkerRemove;
  final void Function(int index, int newTimeMs)? onMarkerMove;

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
    this.seedIntensity,
    this.seedIntensityWidth = 0,
    this.seedIntensityHeight = 0,
    this.seedGamma = 1.0,
    this.frequencyLabels,
      this.timeLabels,
      this.requestStartTime,
      this.requestEndTime,
      this.gainNotifier,
      this.showStatusBar = true,
      this.compactStatusBar = false,
      this.markers = const [],
      this.onMarkerAdd,
      this.onMarkerRemove,
      this.onMarkerMove,
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

  // Marker drag state
  int _draggingMarkerIndex = -1;
  double _markerDragStartX = 0;

  // Prevent onTapDown from removing a marker that was just added by onDoubleTapDown.
  int _lastMarkerAddedAt = 0;

  void forceRender() {
    if (!mounted) return;
    _renderDebounce?.cancel();
    _render();
  }

  void fitToScreen() {
    setState(() {
      _viewportStart = 0.0;
      _viewportEnd = 1.0;
    });
  }

  int? _markerLineHitTest(Offset position) {
    final w = _layoutSize.width;
    if (w <= 0 || _image == null) return null;
    final pLeft = 40.0;
    final pRight = 6.0;
    final plotW = w - pLeft - pRight;
    if (plotW <= 0) return null;

    final histories = widget.histories;
    if (histories == null || histories.isEmpty) return null;
    final fromMs = _stateParseMs(widget.requestStartTime ?? histories.first.startTime);
    final toMs = _stateParseMs(widget.requestEndTime ?? histories.last.endTime);
    if (fromMs == null || toMs == null || toMs <= fromMs) return null;
    final rangeMs = toMs - fromMs;

    final span = _viewportEnd - _viewportStart;
    if (span <= 0) return null;

    final markers = widget.markers;
    for (var i = markers.length - 1; i >= 0; i--) {
      final m = markers[i];
      final dataFrac = (m.timeMs - fromMs) / rangeMs;
      if (dataFrac < _viewportStart || dataFrac > _viewportEnd) continue;
      final mx = pLeft + ((dataFrac - _viewportStart) / span) * plotW;
      if ((position.dx - mx).abs() < 8) return i;
    }
    return null;
  }

  int? _markerHitTest(Offset position) {
    final lineIdx = _markerLineHitTest(position);
    if (lineIdx != null) return lineIdx;

    final w = _layoutSize.width;
    if (w <= 0 || _image == null) return null;
    final pLeft = 40.0;
    final pRight = 6.0;
    final pTop = 4.0;
    final plotW = w - pLeft - pRight;
    if (plotW <= 0) return null;

    final histories = widget.histories;
    if (histories == null || histories.isEmpty) return null;
    final fromMs = _stateParseMs(widget.requestStartTime ?? histories.first.startTime);
    final toMs = _stateParseMs(widget.requestEndTime ?? histories.last.endTime);
    if (fromMs == null || toMs == null || toMs <= fromMs) return null;
    final rangeMs = toMs - fromMs;

    final span = _viewportEnd - _viewportStart;
    if (span <= 0) return null;

    final markers = widget.markers;
    final labelTop = pTop + 34.0;
    const boxH = 27.0;
    const laneGap = 8.0;
    final laneBoxes = <_LaneBox>[];
    const markerLabelStyle = TextStyle(
      color: Color(0xFFEEE88E),
      fontSize: 11,
      fontWeight: FontWeight.bold,
      fontFamily: 'monospace',
    );

    for (var i = 0; i < markers.length; i++) {
      final m = markers[i];
      final dataFrac = (m.timeMs - fromMs) / rangeMs;
      if (dataFrac < _viewportStart || dataFrac > _viewportEnd) continue;
      final mx = pLeft + ((dataFrac - _viewportStart) / span) * plotW;

      final dt = DateTime.fromMillisecondsSinceEpoch(m.timeMs, isUtc: true);
      final localDt = dt.toLocal();
      final label = '${localDt.year.toString().padLeft(4, '0')}-${localDt.month.toString().padLeft(2, '0')}-${localDt.day.toString().padLeft(2, '0')} ${localDt.hour.toString().padLeft(2, '0')}:${localDt.minute.toString().padLeft(2, '0')}:${localDt.second.toString().padLeft(2, '0')}';
      final tp = TextPainter(
        text: TextSpan(text: label, style: markerLabelStyle),
        textDirection: TextDirection.ltr,
      )..layout();
      final boxW = max(40.0, tp.width + 20);
      var boxLeft = (mx - boxW / 2).clamp(pLeft, pLeft + plotW - boxW);
      var laneY = labelTop;
      for (final lb in laneBoxes) {
        final horizontallyOverlap = boxLeft < lb.left + lb.width && boxLeft + boxW > lb.left;
        if (horizontallyOverlap && laneY < lb.bottom + laneGap) {
          laneY = lb.bottom + laneGap;
        }
      }

      if (position.dx >= boxLeft && position.dx <= boxLeft + boxW &&
          position.dy >= laneY && position.dy <= laneY + boxH) return i;

      laneBoxes.add(_LaneBox(left: boxLeft, bottom: laneY + boxH, width: boxW));
    }
    return null;
  }

  int? _timeMsFromPosition(Offset position) {
    final w = _layoutSize.width;
    if (w <= 0 || _image == null) return null;
    final pLeft = 40.0;
    final pRight = 6.0;
    final plotW = w - pLeft - pRight;
    if (plotW <= 0) return null;

    final histories = widget.histories;
    if (histories == null || histories.isEmpty) return null;
    final fromMs = _stateParseMs(widget.requestStartTime ?? histories.first.startTime);
    final toMs = _stateParseMs(widget.requestEndTime ?? histories.last.endTime);
    if (fromMs == null || toMs == null || toMs <= fromMs) return null;
    final rangeMs = toMs - fromMs;

    final span = _viewportEnd - _viewportStart;
    if (span <= 0) return null;

    final dataFrac = _viewportStart + ((position.dx - pLeft) / plotW) * span;
    final timeMs = (fromMs + dataFrac * rangeMs).round();
    return timeMs;
  }

  ui.Image? _image;
  bool _imageOwned = false;
  int _jobId = 0;
  Size _layoutSize = Size.zero;
  double _dpr = 1.0;
  Timer? _renderDebounce;

  List<List<num>>? _cachedMatrix;
  Object? _matrixCacheKey;
  List<CoverageInterval>? _cachedCoverageIntervals;
  int _cachedTotalCols = 0;
  Object? _coverageCacheKey;

  Uint8List? _cachedIntensity;
  int _cachedIntensityWidth = 0;
  int _cachedIntensityHeight = 0;
  double _cachedGamma = 1.0;

  @override
  void initState() {
    super.initState();
    _image = widget.seedImage;
    _imageOwned = false;
    _cachedIntensity = widget.seedIntensity;
    _cachedIntensityWidth = widget.seedIntensityWidth;
    _cachedIntensityHeight = widget.seedIntensityHeight;
    _cachedGamma = widget.seedGamma;
    widget.gainNotifier?.addListener(_onGainChanged);
  }

  @override
  void didUpdateWidget(SpectrogramCanvas oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.gainNotifier != widget.gainNotifier) {
      oldWidget.gainNotifier?.removeListener(_onGainChanged);
      widget.gainNotifier?.addListener(_onGainChanged);
    }
    final renderingChanged = oldWidget.matrix != widget.matrix ||
        oldWidget.gamma != widget.gamma ||
        oldWidget.inputValueMax != widget.inputValueMax;
    final gainChanged = oldWidget.gainDb != widget.gainDb;
    final dataChanged = oldWidget.histories != widget.histories ||
        oldWidget.requestStartTime != widget.requestStartTime ||
        oldWidget.requestEndTime != widget.requestEndTime;
    if (dataChanged) {
      _cachedMatrix = null;
      _matrixCacheKey = null;
      _cachedCoverageIntervals = null;
      _cachedTotalCols = 0;
      _coverageCacheKey = null;
    }
    if (renderingChanged || dataChanged) {
      _renderDebounce?.cancel();
      _renderDebounce = Timer(const Duration(milliseconds: 100), () {
        if (mounted) _render();
      });
    } else if (gainChanged && _cachedIntensity != null) {
      _onGainChanged();
    }
  }

  void _onGainChanged() async {
    if (_cachedIntensity == null || _image == null) return;
    final gainDb = widget.gainNotifier?.value ?? widget.gainDb;
    final image = await _applyGainAndBuildImage(gainDb);
    if (!mounted) return;
    final oldImage = _image;
    _imageOwned = true;
    _image = image;
    if (seedSnapshot != null) {
      seedSnapshot = CanvasSeedSnapshot(
        image: image,
        cachedCombined: seedSnapshot!.cachedCombined,
        cachedWidth: seedSnapshot!.cachedWidth,
        cachedHeight: seedSnapshot!.cachedHeight,
        frequencyBins: seedSnapshot!.frequencyBins,
        colCount: seedSnapshot!.colCount,
        startTime: seedSnapshot!.startTime,
        endTime: seedSnapshot!.endTime,
      );
    }
    setState(() {});
    if (oldImage != null && oldImage != image) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        try { oldImage.dispose(); } catch (_) {}
      });
    }
  }

  Future<ui.Image> _applyGainAndBuildImage(double gainDb) async {
    final intensity = _cachedIntensity;
    if (intensity == null || _cachedIntensityWidth <= 0 || _cachedIntensityHeight <= 0) {
      return _image!;
    }
    final w = _cachedIntensityWidth;
    final h = _cachedIntensityHeight;
    final gainScale = gainDb == 0.0 ? 1.0 : pow(10.0, gainDb / 20.0).toDouble();
    final gamma = _cachedGamma;
    final rgba = Uint8List(w * h * 4);
    for (var i = 0; i < w * h; i++) {
      var value = intensity[i].toDouble() / 255.0;
      value = clampDouble(value * gainScale, 0.0, 1.0);
      final rgb = _colorForGamma(value, gamma);
      final offset = i * 4;
      rgba[offset] = (rgb >> 16) & 0xFF;
      rgba[offset + 1] = (rgb >> 8) & 0xFF;
      rgba[offset + 2] = rgb & 0xFF;
      rgba[offset + 3] = 0xFF;
    }
    return rgbaToUiImage(rgba, w, h);
  }

  static double clampDouble(double v, double min, double max) {
    if (v < min) return min;
    if (v > max) return max;
    return v;
  }

  static int _colorForGamma(double v0, double gammaValue) {
    const stops = [
      [0.0, 0.0, 0.0, 4.0 / 255.0],
      [0.16, 28.0 / 255.0, 16.0 / 255.0, 68.0 / 255.0],
      [0.33, 79.0 / 255.0, 18.0 / 255.0, 123.0 / 255.0],
      [0.5, 129.0 / 255.0, 37.0 / 255.0, 129.0 / 255.0],
      [0.66, 181.0 / 255.0, 54.0 / 255.0, 122.0 / 255.0],
      [0.83, 229.0 / 255.0, 80.0 / 255.0, 100.0 / 255.0],
      [1.0, 252.0 / 255.0, 253.0 / 255.0, 191.0 / 255.0],
    ];
    final g = gammaValue > 0 ? gammaValue : 1.0;
    double v = v0;
    if (v < 0) v = 0;
    if (v > 1) v = 1;
    v = pow(v, g).toDouble();
    for (var i = 0; i < stops.length - 1; i++) {
      final a = stops[i];
      final b = stops[i + 1];
      if (v >= a[0] && v <= b[0]) {
        final denom = (b[0] - a[0]).abs() < 1e-9 ? 1.0 : (b[0] - a[0]);
        final t = (v - a[0]) / denom;
        final r = a[1] + (b[1] - a[1]) * t;
        final g2 = a[2] + (b[2] - a[2]) * t;
        final bl = a[3] + (b[3] - a[3]) * t;
        return (0xFF << 24) | (_clamp255(r * 255) << 16) | (_clamp255(g2 * 255) << 8) | _clamp255(bl * 255);
      }
    }
    final last = stops[stops.length - 1];
    return (0xFF << 24) | (_clamp255(last[1] * 255) << 16) | (_clamp255(last[2] * 255) << 8) | _clamp255(last[3] * 255);
  }

  static int _clamp255(double v) => v.round().clamp(0, 255);

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

    final key = Object.hash(histories, widget.requestStartTime, widget.requestEndTime);
    if (_matrixCacheKey == key && _cachedMatrix != null) {
      return _cachedMatrix!;
    }

    final fromMs = _stateParseMs(widget.requestStartTime ?? histories.first.startTime);
    final toMs = _stateParseMs(widget.requestEndTime ?? histories.last.endTime);
    if (fromMs == null || toMs == null || toMs <= fromMs) {
      final result = _resolvedMatrixFallback(histories);
      _cachedMatrix = result;
      _matrixCacheKey = key;
      return result;
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

    _cachedMatrix = combined;
    _matrixCacheKey = key;
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
    final histories = widget.histories;
    final id = ++_jobId;
    if (histories == null || histories.isEmpty || _layoutSize == Size.zero) {
      final stale = _image;
      _image = null;
      if (mounted) setState(() {});
      if (stale != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          try { stale.dispose(); } catch (_) {}
        });
      }
      return;
    }

    try {
      final result = await renderSpectrogramIsolate(
        RenderRequest(
          matrix: const [],
          width: 1,
          height: 1,
          gamma: widget.gamma,
          inputValueMax: widget.inputValueMax,
          intensityType: widget.intensityType ?? histories.firstOrNull?.intensityType,
          startTimeIso: widget.startTime ?? histories.firstOrNull?.startTime,
          endTimeIso: widget.endTime ?? histories.lastOrNull?.endTime,
          debug: false,
          gainDb: 0.0,
          backgroundColor: widget.background.toARGB32(),
          histories: histories.map((h) => HistoryBlock(
            h.data, h.startTime, h.endTime, h.intensityType,
            h.intensityRange[0], h.intensityRange[1],
          )).toList(),
          requestStartTime: widget.requestStartTime,
          requestEndTime: widget.requestEndTime,
        ),
      );
      if (!mounted || id != _jobId) return;
      _cachedIntensity = result.intensity;
      _cachedIntensityWidth = result.width;
      _cachedIntensityHeight = result.height;
      _cachedGamma = result.gamma;
      final gainDb = widget.gainNotifier?.value ?? widget.gainDb;
      final image = await _applyGainAndBuildImage(gainDb);
      if (!mounted || id != _jobId) return;
      seedSnapshot = CanvasSeedSnapshot(
        image: image,
        cachedCombined: null,
        cachedWidth: result.width,
        cachedHeight: result.height,
        frequencyBins: null,
        colCount: result.width,
        startTime: histories.firstOrNull?.startTime != null
            ? DateTime.tryParse(histories.first.startTime!)
            : null,
        endTime: histories.isNotEmpty && histories.last.endTime != null
            ? DateTime.tryParse(histories.last.endTime!)
            : null,
        cachedIntensity: result.intensity,
        intensityWidth: result.width,
        intensityHeight: result.height,
        cachedGamma: result.gamma,
      );
      final oldImage = _image;
      _imageOwned = true;
      _image = image;
      setState(() {});
      if (oldImage != null && oldImage != image) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          try { oldImage.dispose(); } catch (_) {}
        });
      }
    } catch (_) {
      if (!mounted || id != _jobId) return;
      setState(() => _image = null);
    }
  }


  @override
  void dispose() {
    widget.gainNotifier?.removeListener(_onGainChanged);
    _renderDebounce?.cancel();
    _jobId++;
    if (_imageOwned) _image?.dispose();
    super.dispose();
  }

  List<CoverageInterval> _buildCoverageIntervals() {
    final histories = widget.histories;
    if (histories == null || histories.isEmpty) return const [];

    final key = Object.hash(histories, widget.requestStartTime, widget.requestEndTime);
    if (_coverageCacheKey == key && _cachedCoverageIntervals != null) {
      return _cachedCoverageIntervals!;
    }

    final fromMs = _stateParseMs(widget.requestStartTime ?? histories.first.startTime);
    final toMs = _stateParseMs(widget.requestEndTime ?? histories.last.endTime);
    if (fromMs == null || toMs == null || toMs <= fromMs) {
      final result = _buildCoverageIntervalsFallback(histories);
      _cachedCoverageIntervals = result;
      _coverageCacheKey = key;
      return result;
    }

    final colsPerMs = _computeColsPerMs(histories);
    if (colsPerMs == null) {
      final result = _buildCoverageIntervalsFallback(histories);
      _cachedCoverageIntervals = result;
      _coverageCacheKey = key;
      return result;
    }

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
    _cachedCoverageIntervals = intervals;
    _coverageCacheKey = key;
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

    final key = Object.hash(histories, widget.requestStartTime, widget.requestEndTime);
    if (_coverageCacheKey == key && _cachedTotalCols > 0) {
      return _cachedTotalCols;
    }

    final fromMs = _stateParseMs(widget.requestStartTime ?? (histories.isNotEmpty ? histories.first.startTime : null));
    final toMs = _stateParseMs(widget.requestEndTime ?? (histories.isNotEmpty ? histories.last.endTime : null));
    if (fromMs == null || toMs == null || toMs <= fromMs) {
      int total = 0;
      for (final h in histories) {
        if (h.data.isEmpty) continue;
        total += h.data[0].length;
      }
      _cachedTotalCols = total;
      return total;
    }

    final colsPerMs = _computeColsPerMs(histories);
    if (colsPerMs == null) return 0;
    final result = ((toMs - fromMs) * colsPerMs).round();
    _cachedTotalCols = result;
    return result;
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
          final hasData = widget.histories != null && widget.histories!.isNotEmpty;
          return Container(
            color: widget.background,
            alignment: Alignment.center,
            child: hasData
                ? const SizedBox(
                    width: 32,
                    height: 32,
                    child: CircularProgressIndicator(
                      strokeWidth: 3,
                      color: Colors.white54,
                    ),
                  )
                : const Text(
                    'لا توجد بيانات طيف',
                    style: TextStyle(color: Colors.white54),
                  ),
          );
        }
        return SizedBox.expand(
          child: Container(
            color: widget.background,
            child: GestureDetector(
              onDoubleTapDown: (details) {
                final idx = _markerLineHitTest(details.localPosition);
                if (idx != null) return;
                final timeMs = _timeMsFromPosition(details.localPosition);
                if (timeMs != null) {
                  _lastMarkerAddedAt = DateTime.now().millisecondsSinceEpoch;
                  widget.onMarkerAdd?.call(timeMs);
                }
              },
              onTapDown: (details) {
                if (DateTime.now().millisecondsSinceEpoch - _lastMarkerAddedAt < 500) return;
                final idx = _markerLineHitTest(details.localPosition);
                if (idx != null) {
                  widget.onMarkerRemove?.call(idx);
                  return;
                }
              },
              onScaleStart: (details) {
                _scaleStart = _viewportEnd - _viewportStart;
                _lastFocalPoint = details.focalPoint;
                if (details.pointerCount == 1) {
                  final local = details.localFocalPoint ?? details.focalPoint;
                  final markerIdx = _markerHitTest(local);
                  if (markerIdx != null) {
                    _draggingMarkerIndex = markerIdx;
                    _markerDragStartX = local.dx;
                  } else {
                    _draggingMarkerIndex = -1;
                  }
                }
              },
              onScaleUpdate: (details) {
                final w = _layoutSize.width;
                if (w <= 0) return;
                if (details.pointerCount == 2) {
                  _draggingMarkerIndex = -1;
                  final newSpan = (_scaleStart / details.scale).clamp(0.005, 5.0);
                  final anchor = (_lastFocalPoint.dx / w).clamp(0.0, 1.0);
                  final center = _viewportStart + (_viewportEnd - _viewportStart) * anchor;
                  var newStart = center - newSpan * anchor;
                  var newEnd = newStart + newSpan;
                  if (newStart < -(newSpan * 0.8)) newStart = -(newSpan * 0.8);
                  if (newEnd > 1.0 + newSpan * 0.8) newEnd = 1.0 + newSpan * 0.8;
                  setState(() { _viewportStart = newStart; _viewportEnd = newEnd; });
                } else if (details.pointerCount == 1) {
                  final local = details.localFocalPoint ?? details.focalPoint;
                  if (_draggingMarkerIndex >= 0) {
                    final dx = (local.dx - _markerDragStartX).abs();
                    if (dx > 4) {
                      final newTimeMs = _timeMsFromPosition(local);
                      if (newTimeMs != null) {
                        widget.onMarkerMove?.call(_draggingMarkerIndex, newTimeMs);
                      }
                      _markerDragStartX = local.dx;
                    }
                  } else {
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
                }
              },
              onScaleEnd: (details) {
                _draggingMarkerIndex = -1;
              },
              child: RepaintBoundary(
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
                    histories: widget.histories,
                    showStatusBar: widget.showStatusBar,
                    compactStatusBar: widget.compactStatusBar,
                    markers: widget.markers,
                  ),
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

class _LaneBox {
  final double left;
  final double bottom;
  final double width;
  const _LaneBox({required this.left, required this.bottom, required this.width});
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
  final List<DeviceHistory>? histories;
  final bool showStatusBar;
  final bool compactStatusBar;
  final List<MarkerData> markers;

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
      this.totalCols = 0,
      this.histories,
      this.showStatusBar = true,
      this.compactStatusBar = false,
      this.markers = const []});

  static const double _leftInset = 40;
  static const double _rightInset = 6;
  static const double _topInset = 4;
  double get _bottomInset => showStatusBar ? (compactStatusBar ? 50.0 : 68.0) : 36.0;
  static const int _xTicks = 5;
  static const int _yTicks = 5;
  static const double _maxFrequency = 250.0;

  static const Color _gridColor = Color(0x29CFD7E6);
  static const Color _axisColor = Color(0xFFCFD7E6);
  static const Color _textColor = Color(0xFFD8E2FF);
  static const Color _gapFill = Color(0x423667C2);
  static const Color _gapStroke = Color(0xE766C4E7);

  static final Paint _bgPaint = Paint()..color = const Color(0xFF140D28);
  static final Paint _imgPaint = Paint()..isAntiAlias = false..filterQuality = FilterQuality.none;
  static final Paint _gapFillPaint = Paint()..color = _gapFill;
  static final Paint _gapStrokePaint = Paint()..color = _gapStroke..style = PaintingStyle.stroke..strokeWidth = 1;
  static final Paint _gridPaint = Paint()..color = _gridColor..strokeWidth = 1;
  static final Paint _axisPaint = Paint()..color = _axisColor..strokeWidth = 1.2..style = PaintingStyle.stroke;
  static final TextStyle _gapTextStyle = TextStyle(color: Color(0xF2E1F4FF), fontSize: 11);
  static final TextStyle _timeStyle = TextStyle(color: _textColor, fontSize: 10);
  static final TextStyle _freqStyle = TextStyle(color: _textColor, fontSize: 10);
  static final TextStyle _titleStyle = TextStyle(color: _textColor, fontSize: 10);

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

    // 1) Background.
    canvas.drawRect(Rect.fromLTWH(0, 0, w, h), _bgPaint);

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
      canvas.drawImageRect(image, src, dst, _imgPaint);
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
      final double gapScale = image.width.toDouble() / totalCols;
      final int imgCols = image.width;
      final visStartCol = (viewportStart * imgCols).round();
      final visEndCol = (viewportEnd * imgCols).round();
      final visCols = visEndCol - visStartCol;
      if (visCols > 0) {
        final sorted = List<CoverageInterval>.from(coverageIntervals!)
          ..sort((a, b) => a.startMs.compareTo(b.startMs));
        final merged = <CoverageInterval>[];
        for (final iv in sorted) {
          final scaledStart = (iv.startMs * gapScale).round();
          final scaledEnd = (iv.endMs * gapScale).round();
          final clippedStart = scaledStart.clamp(visStartCol, visEndCol);
          final clippedEnd = scaledEnd.clamp(visStartCol, visEndCol);
          if (clippedEnd <= clippedStart) continue;
          if (merged.isNotEmpty && clippedStart <= merged.last.endMs) {
            merged[merged.length - 1] = CoverageInterval(
                startMs: merged.last.startMs,
                endMs: clippedEnd > merged.last.endMs ? clippedEnd : merged.last.endMs);
          } else {
            merged.add(CoverageInterval(startMs: clippedStart, endMs: clippedEnd));
          }
        }
        final gapFillPaint = _gapFillPaint;
        final gapStrokePaint = _gapStrokePaint;
        final gapStyle = _gapTextStyle;
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

    // 2c) Time markers (gold vertical lines with labels).
    if (markers.isNotEmpty && span > 0) {
      final dataFromMs = _parseMs(startTimeIso);
      final dataToMs = _parseMs(endTimeIso);
      if (dataFromMs != null && dataToMs != null && dataToMs > dataFromMs) {
        final rangeMs = dataToMs - dataFromMs;
        final markerLinePaint = Paint()
          ..color = const Color(0xF2FFD60A)
          ..strokeWidth = 1.2;
        final markerLabelBgPaint = Paint()..color = const Color(0xDC12161E);
        final markerLabelBorderPaint = Paint()
          ..color = const Color(0xF2FFD60A)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1;
        const markerLabelStyle = TextStyle(
          color: Color(0xFFEEE88E),
          fontSize: 11,
          fontWeight: FontWeight.bold,
          fontFamily: 'monospace',
        );
        final labelTop = pTop + 34.0;
        const boxH = 27.0;
        const laneGap = 8.0;
        final laneBoxes = <_LaneBox>[];
        for (final m in markers) {
          final dataFrac = (m.timeMs - dataFromMs) / rangeMs;
          if (dataFrac < viewportStart - 0.01 || dataFrac > viewportEnd + 0.01) continue;
          final mx = pLeft + ((dataFrac - viewportStart) / span) * plotW;
          if (mx < pLeft || mx > pLeft + plotW) continue;
          canvas.drawLine(Offset(mx, pTop), Offset(mx, pTop + plotH), markerLinePaint);
          final dt = DateTime.fromMillisecondsSinceEpoch(m.timeMs, isUtc: true);
          final local = dt.toLocal();
          final label = '${local.year.toString().padLeft(4, '0')}-${local.month.toString().padLeft(2, '0')}-${local.day.toString().padLeft(2, '0')} ${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}:${local.second.toString().padLeft(2, '0')}';
          final tp = TextPainter(
            text: TextSpan(text: label, style: markerLabelStyle),
            textDirection: TextDirection.ltr,
          )..layout();
          final boxW = max(40.0, tp.width + 20);
          var boxLeft = (mx - boxW / 2).clamp(pLeft, pLeft + plotW - boxW);
          var laneY = labelTop;
          for (final lb in laneBoxes) {
            final horizontallyOverlap = boxLeft < lb.left + lb.width && boxLeft + boxW > lb.left;
            if (horizontallyOverlap && laneY < lb.bottom + laneGap) {
              laneY = lb.bottom + laneGap;
            }
          }
          canvas.drawRect(Rect.fromLTWH(boxLeft, laneY, boxW, boxH), markerLabelBgPaint);
          canvas.drawRect(Rect.fromLTWH(boxLeft, laneY, boxW, boxH), markerLabelBorderPaint);
          tp.paint(canvas, Offset(boxLeft + (boxW - tp.width) / 2, laneY + (boxH - tp.height) / 2));
          laneBoxes.add(_LaneBox(left: boxLeft, bottom: laneY + boxH, width: boxW));
        }
      }
    }

    // 3) Grid lines.
    final gridPaint = _gridPaint;
    for (var i = 0; i <= _xTicks; i++) {
      final x = pLeft + (plotW * i / _xTicks).roundToDouble();
      canvas.drawLine(Offset(x, pTop), Offset(x, pTop + plotH), gridPaint);
    }
    for (var i = 0; i <= _yTicks; i++) {
      final y = pTop + (plotH * i / _yTicks).roundToDouble();
      canvas.drawLine(Offset(pLeft, y), Offset(pLeft + plotW, y), gridPaint);
    }

    // 4) Axes stroke (left + bottom).
    final axisPaint = _axisPaint;
    canvas.drawPath(
        Path()
          ..moveTo(pLeft, pTop)
          ..lineTo(pLeft, pTop + plotH)
          ..lineTo(pLeft + plotW, pTop + plotH),
        axisPaint);

    // 5) Time (x) axis labels.
    final timeStyle = _timeStyle;
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
    final freqStyle = _freqStyle;
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
    final titleStyle = _titleStyle;
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

    // 8) AI Status bar (below time title).
    if (showStatusBar && histories != null && histories!.isNotEmpty &&
        fromMs != null && toMs != null && toMs! > fromMs! && totalCols > 0 && span > 0) {
      final statusBarY = pTop + plotH + 36;
      final sbHeight = compactStatusBar ? 14.0 : 28.0;
      final sbFontSize = compactStatusBar ? 9.0 : 11.0;
      final sbMinWidth = compactStatusBar ? 50.0 : 72.0;

      for (final h in histories!) {
        final blockStartMs = _parseMs(h.startTime);
        final blockEndMs = _parseMs(h.endTime);
        if (blockStartMs == null || blockEndMs == null) continue;

        final clippedStart = blockStartMs.clamp(fromMs!, toMs!);
        final clippedEnd = blockEndMs.clamp(fromMs!, toMs!);
        if (clippedEnd <= clippedStart) continue;

        final sx0 = (clippedStart - fromMs!).toDouble() / (toMs! - fromMs!) * plotW;
        final sx1 = (clippedEnd - fromMs!).toDouble() / (toMs! - fromMs!) * plotW;
        final sw = max(1.0, sx1 - sx0);

        final color = _resolveStatusColor(h.aiStatus);
        final label = _resolveStatusLabel(h.aiStatus);
        final conf = h.confidence;
        final text = conf != null ? '$label (%${conf.toStringAsFixed(1)})' : label;

        canvas.drawRect(Rect.fromLTWH(pLeft + sx0, statusBarY, sw, sbHeight), Paint()..color = color);

        if (sw >= sbMinWidth) {
          final tp = TextPainter(
            text: TextSpan(
              text: text,
              style: TextStyle(
                color: Colors.white,
                fontSize: sbFontSize,
                fontWeight: FontWeight.bold,
              ),
            ),
            textDirection: TextDirection.rtl,
          )..layout();
          tp.paint(canvas, Offset(
            pLeft + sx0 + sw / 2 - tp.width / 2,
            statusBarY + sbHeight / 2 - tp.height / 2,
          ));
        }
      }
    }
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

  static Color _resolveStatusColor(AiStatus status) {
    switch (status) {
      case AiStatus.detected:
        return const Color(0xFFD13438);
      case AiStatus.notDetected:
        return const Color(0xFF21A366);
      case AiStatus.possible:
        return const Color(0xFFF59E0B);
    }
  }

  static String _resolveStatusLabel(AiStatus status) {
    switch (status) {
      case AiStatus.detected:
        return 'هدف مكتشف';
      case AiStatus.notDetected:
        return 'لا يوجد هدف';
      case AiStatus.possible:
        return 'هدف محتمل';
    }
  }

  @override
  bool shouldRepaint(covariant _SpectroPainter oldDelegate) {
    return oldDelegate.image != image ||
        oldDelegate.background != background ||
        oldDelegate.viewportStart != viewportStart ||
        oldDelegate.viewportEnd != viewportEnd ||
        oldDelegate.totalCols != totalCols ||
        oldDelegate.startTimeIso != startTimeIso ||
        oldDelegate.endTimeIso != endTimeIso ||
        oldDelegate.showStatusBar != showStatusBar ||
        oldDelegate.compactStatusBar != compactStatusBar ||
        !identical(oldDelegate.coverageIntervals, coverageIntervals) ||
        !identical(oldDelegate.histories, histories) ||
        !identical(oldDelegate.markers, markers);
  }
}
