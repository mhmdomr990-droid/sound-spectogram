import 'dart:async';
import 'dart:isolate';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'spectro.dart';
import 'log_axis.dart';

/// Stage-1 view build: max-downscale the raw intensity plane to the on-screen
/// plot resolution (+ log-axis warp when requested), executed on the render
/// isolate so the UI thread never freezes. The max bucket keeps thin bright
/// peaks at full strength (web parity). The gain LUT is applied AFTER this
/// step on the UI thread (a cheap per-pixel lookup), so gain changes never
/// re-run the warp.
class WarpRequest {
  final Uint8List intensity;
  final int width;
  final int height;
  final bool logView;

  /// Frequency range the log axis warps over — resolved from the device /
  /// frequencyBins like the web resolveViewRange chain (never 0 unless the
  /// device actually reports 0).
  final double minFreq;
  final double maxFreq;
  final double focusHz;

  /// Target size in device pixels (plot rect × devicePixelRatio). The plane
  /// is upscaled to this size so both views share the exact pixel grid of the
  /// on-screen rendering — the same "render linear first, warp those pixels"
  /// pipeline the web uses. Values <= 0 keep data resolution.
  final int dstWidth;
  final int dstHeight;

  /// Blend between nearest (0, crisp/thin) and bilinear (1, soft/wide — the
  /// web's gl.LINEAR texture filter) when upscaling to display resolution.
  final double softness;

  /// Bright-line thickening: rows added below each hot pixel on the final
  /// plane (0 = off / 1px, 1 = 2px total, ...). The dark noise floor
  /// (< threshold) is untouched.
  final int thickenRows;

  const WarpRequest({
    required this.intensity,
    required this.width,
    required this.height,
    required this.logView,
    required this.minFreq,
    required this.maxFreq,
    required this.focusHz,
    this.dstWidth = 0,
    this.dstHeight = 0,
    this.softness = 0.0,
    this.thickenRows = 0,
  });
}

class RenderRequest {
  final List<List<num>> matrix;
  final int width;
  final int height;
  final double gamma;
  final int inputValueMax;
  final double noiseThreshold;
  final int noiseFloorPercentile;
  final bool isolatedPixelRemovalEnabled;
  final bool morphologyEnabled;
  final int neighborhoodSize;
  final int minActiveNeighbors;
  final String? intensityType;
  final String intensityMode;
  final double dbMin;
  final double dbMax;
  final bool debug;
  final double gainDb;
  final String? startTimeIso;
  final String? endTimeIso;
  final int backgroundColor;
  final String colorMap;
  final num noiseLevel;
  final int dstHeight;

  final List<HistoryBlock>? _histories;
  final String? requestStartTime;
  final String? requestEndTime;

  const RenderRequest({
    required this.matrix,
    required this.width,
    required this.height,
    this.gamma = 1.0,
    this.inputValueMax = 255,
    this.noiseThreshold = 0.06,
    this.noiseFloorPercentile = 72,
    this.isolatedPixelRemovalEnabled = true,
    this.morphologyEnabled = true,
    this.neighborhoodSize = 3,
    this.minActiveNeighbors = 1,
    this.intensityType,
    this.intensityMode = 'linear',
    this.dbMin = -95.0,
    this.dbMax = -20.0,
    this.debug = false,
    this.gainDb = 0.0,
    this.startTimeIso,
    this.endTimeIso,
    this.backgroundColor = 0xFF111026,
    this.colorMap = 'sonic',
    this.noiseLevel = 0,
    this.dstHeight = 0,
    List<HistoryBlock>? histories,
    this.requestStartTime,
    this.requestEndTime,
  }) : _histories = histories;

  bool get hasHistories => _histories != null && _histories!.isNotEmpty;
  List<HistoryBlock> get histories => _histories ?? const [];
}

/// Lightweight serializable block — carries only what the isolate needs
/// to build the combined matrix from histories.
class HistoryBlock {
  final List<List<double>> data;
  final String? startTime;
  final String? endTime;
  final String? intensityType;
  final double minVal;
  final double maxVal;

  const HistoryBlock(this.data, this.startTime, this.endTime, this.intensityType, this.minVal, this.maxVal);
}

class RenderResult {
  final Uint8List rgba;
  final int width;
  final int height;
  final Uint8List? intensity;
  final double gamma;

  const RenderResult(this.rgba, this.width, this.height, {this.intensity, this.gamma = 1.0});
}

// ---------------------------------------------------------------------------
// Matrix building from histories — runs inside the isolate so the UI thread
// never touches the large combined matrix.
// ---------------------------------------------------------------------------

int? _parseMs(String? iso) {
  if (iso == null || iso.isEmpty) return null;
  final d = DateTime.tryParse(iso);
  return d?.millisecondsSinceEpoch;
}

double? _computeColsPerMs(List<HistoryBlock> blocks) {
  int totalDataCols = 0;
  int totalDataMs = 0;
  for (final h in blocks) {
    if (h.data.isEmpty) continue;
    final s = _parseMs(h.startTime);
    final e = _parseMs(h.endTime);
    if (s != null && e != null && e > s) {
      totalDataCols += h.data[0].length;
      totalDataMs += e - s;
    }
  }
  if (totalDataMs <= 0 || totalDataCols <= 0) return null;
  return totalDataCols / totalDataMs;
}

List<List<num>> buildMatrixFromHistories(
  List<HistoryBlock> blocks,
  String? requestStart,
  String? requestEnd,
) {
  if (blocks.isEmpty) return const [];

  final fromMs = _parseMs(requestStart ?? blocks.first.startTime);
  final toMs = _parseMs(requestEnd ?? blocks.first.endTime);
  if (fromMs == null || toMs == null || toMs <= fromMs) {
    return const [];
  }

  final colsPerMs = _computeColsPerMs(blocks);
  if (colsPerMs == null) return const [];

  final rangeMs = toMs - fromMs;
  final totalCols = (rangeMs * colsPerMs).round();
  if (totalCols <= 0) return const [];

  int targetRows = 0;
  for (final h in blocks) {
    if (h.data.length > targetRows) targetRows = h.data.length;
  }
  if (targetRows == 0) return const [];

  // Float64List rows: same IEEE-754 doubles as before, stored unboxed
  // (faster fill and far better cache locality for the render passes).
  final combined = List.generate(targetRows, (_) => Float64List(totalCols));

  for (final h in blocks) {
    if (h.data.isEmpty) continue;
    final s = _parseMs(h.startTime);
    final e = _parseMs(h.endTime);
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

// ---------------------------------------------------------------------------
// Persistent Isolate — avoids spawning a new isolate per render
// ---------------------------------------------------------------------------

class _SpectroIsolateWorker {
  Isolate? _isolate;
  SendPort? _sendPort;
  ReceivePort? _receivePort;
  ReceivePort? _commandPort;
  bool _initialized = false;

  Future<void> _ensureInitialized() async {
    if (_initialized && _isolate != null) return;

    _receivePort = ReceivePort();
    _commandPort = ReceivePort();

    _isolate = await Isolate.spawn(
      _isolateEntry,
      _receivePort!.sendPort,
      debugName: 'spectro-render',
    );

    _sendPort = await _receivePort!.first as SendPort;
    _initialized = true;
  }

  Future<RenderResult> render(RenderRequest req) async {
    await _ensureInitialized();

    final resultPort = ReceivePort();
    _sendPort!.send([req, resultPort.sendPort]);

    final result = await resultPort.first;
    resultPort.close();

    if (result is String) {
      throw StateError('Isolate render failed: $result');
    }
    return result as RenderResult;
  }

  void dispose() {
    _isolate?.kill(priority: Isolate.immediate);
    _isolate = null;
    _receivePort?.close();
    _commandPort?.close();
    _sendPort = null;
    _initialized = false;
  }
}

void _isolateEntry(SendPort mainSendPort) {
  final port = ReceivePort();
  mainSendPort.send(port.sendPort);

  port.listen((message) {
    final replyTo = message[1] as SendPort;
    final req = message[0] as RenderRequest;

    try {
      final sw = Stopwatch()..start();
      final List<List<num>> matrix;
      if (req.hasHistories) {
        matrix = buildMatrixFromHistories(req.histories, req.requestStartTime, req.requestEndTime);
      } else {
        matrix = req.matrix;
      }
      final matrixMs = sw.elapsedMilliseconds;

      final int w;
      final int h;
      if (req.hasHistories && matrix.isNotEmpty && matrix.first.isNotEmpty) {
        w = matrix.first.length.clamp(1, 4096);
        h = matrix.length.clamp(1, 4096);
      } else {
        w = req.width;
        h = req.height;
      }

      final result = buildRgba(
        matrix,
        width: w,
        height: h,
        gamma: req.gamma,
        inputValueMax: req.inputValueMax,
        noiseThreshold: req.noiseThreshold,
        noiseFloorPercentile: req.noiseFloorPercentile,
        isolatedPixelRemovalEnabled: req.isolatedPixelRemovalEnabled,
        morphologyEnabled: req.morphologyEnabled,
        neighborhoodSize: req.neighborhoodSize,
        minActiveNeighbors: req.minActiveNeighbors,
        intensityType: req.intensityType,
        intensityMode: req.intensityMode,
        dbMin: req.dbMin,
        dbMax: req.dbMax,
        debug: req.debug,
        gainDb: req.gainDb,
        startTimeIso: req.startTimeIso,
        endTimeIso: req.endTimeIso,
        backgroundColor: req.backgroundColor,
        colorMap: req.colorMap,
        noiseLevel: req.noiseLevel,
        dstHeight: req.dstHeight,
      );
      // ignore: avoid_print
      print('[DbgRx] iso render matrix=${matrixMs}ms rgba=${sw.elapsedMilliseconds - matrixMs}ms '
          'total=${sw.elapsedMilliseconds}ms dims=${result.width}x${result.height} '
          'srcMatrix=${matrix.isNotEmpty ? matrix.first.length : 0}x${matrix.length}');
      replyTo.send(RenderResult(result.rgba, result.width, result.height, intensity: result.intensity, gamma: result.gamma));
    } catch (e) {
      replyTo.send(e.toString());
    }
  });
}

/// Stage-1 view build: nearest-upscale the intensity plane to the on-screen
/// plot resolution (the pixels the linear view draws), then peak-warp for the
/// log view. Runs on intensity — the gain LUT is applied later on the UI
/// thread, so gain changes never re-enter this function.
Uint8List _upscaleAndWarp(WarpRequest req) {
  final w = req.width;
  final h = req.height;
  final intensity = req.intensity;
  if (w <= 0 || h <= 0 || intensity.length < w * h) {
    return Uint8List(0);
  }
  var plane = intensity;
  var pw = w;
  var ph = h;
  final dw = req.dstWidth;
  final dh = req.dstHeight;
  if (dw > 0 && dh > 0 && (dw != w || dh != h)) {
    plane = _upscaleI8(intensity, w, h, dw, dh, req.softness);
    pw = dw;
    ph = dh;
  }
  if (!req.logView) {
    if (req.thickenRows > 0) {
      // Never dilate the caller's source buffer in place — the equal-dims
      // path aliases req.intensity (shared with the widget's plane cache).
      if (identical(plane, intensity)) plane = Uint8List.fromList(plane);
      _thickenBrightVertical(plane, pw, ph, req.thickenRows);
    }
    return plane;
  }
  final warped = warpSpectrogramIntensity(
    plane,
    pw,
    ph,
    buildLogAxis(req.minFreq, req.maxFreq, req.focusHz),
  );
  if (req.thickenRows > 0) _thickenBrightVertical(warped, pw, ph, req.thickenRows);
  // ignore: avoid_print
  print('[TIMING] iso plane ${pw}x$ph log=${req.logView} '
      'inAvg=${_avg(plane)} outAvg=${_avg(warped)} outLen=${warped.length}');
  return warped;
}

/// Bright-line thickening: every hot pixel (>= threshold — the yellow/scarlet
/// tone zone) copies its full value into the `extraRows` rows directly below
/// it, so a 1px line renders (1 + extraRows)px tall while the dark noise floor
/// stays untouched. Reads from a snapshot so a bright row cannot flood its
/// column.
void _thickenBrightVertical(Uint8List plane, int w, int h, int extraRows) {
  if (w <= 0 || h <= 1 || extraRows <= 0) return;
  const threshold = 160;
  final orig = Uint8List.fromList(plane);
  final lastY = h - 1;
  for (var y = 0; y < lastY; y++) {
    final srcOff = y * w;
    final maxY = y + extraRows < lastY ? y + extraRows : lastY;
    for (var x = 0; x < w; x++) {
      final v = orig[srcOff + x];
      if (v < threshold) continue;
      for (var yy = y + 1; yy <= maxY; yy++) {
        final i = yy * w + x;
        if (plane[i] < v) plane[i] = v;
      }
    }
  }
}

double _avg(Uint8List b) {
  if (b.isEmpty) return -1;
  final step = b.length < 40000 ? 1 : b.length ~/ 40000;
  var s = 0;
  var n = 0;
  for (var i = 0; i < b.length; i += step) {
    s += b[i];
    n++;
  }
  return s / n;
}

/// Max-bucket downscale — the web's intensityBuffer fill: each destination
/// pixel takes the maximum over the source region that maps to it, so a thin
/// bright peak never dims (web parity for line brightness/thickness).
Uint8List _maxReduceI8(
    Uint8List src, int srcW, int srcH, int dstW, int dstH) {
  final out = Uint8List(dstW * dstH);
  for (var y = 0; y < dstH; y++) {
    final sy0 = (y * srcH) ~/ dstH;
    var sy1 = ((y + 1) * srcH) ~/ dstH;
    if (sy1 <= sy0) sy1 = sy0 + 1;
    if (sy1 > srcH) sy1 = srcH;
    final dstRow = y * dstW;
    for (var x = 0; x < dstW; x++) {
      final sx0 = (x * srcW) ~/ dstW;
      var sx1 = ((x + 1) * srcW) ~/ dstW;
      if (sx1 <= sx0) sx1 = sx0 + 1;
      if (sx1 > srcW) sx1 = srcW;
      var m = 0;
      for (var sy = sy0; sy < sy1; sy++) {
        final rowOff = sy * srcW;
        for (var sx = sx0; sx < sx1; sx++) {
          final v = src[rowOff + sx];
          if (v > m) m = v;
        }
      }
      out[dstRow + x] = m;
    }
  }
  return out;
}

/// Softness-aware downscale: 0 = max-bucket (bright, web parity — a peak is
/// never missed or dimmed), 1 = bilinear (soft/wide, the web's gl.LINEAR
/// filter), in between = a linear blend of the two.
Uint8List _upscaleI8(
    Uint8List src, int srcW, int srcH, int dstW, int dstH, double softness) {
  final t = softness <= 0 ? 0.0 : (softness >= 1 ? 1.0 : softness);
  if (t <= 0) return _maxReduceI8(src, srcW, srcH, dstW, dstH);
  final maxR = _maxReduceI8(src, srcW, srcH, dstW, dstH);
  if (t >= 1) return _bilinearUpscaleI8(src, srcW, srcH, dstW, dstH);
  final bil = _bilinearUpscaleI8(src, srcW, srcH, dstW, dstH);
  final out = Uint8List(maxR.length);
  for (var i = 0; i < out.length; i++) {
    out[i] = (maxR[i] + (bil[i] - maxR[i]) * t).round().clamp(0, 255);
  }
  return out;
}

/// Bilinear upscale matching a GPU gl.LINEAR texture sample: each destination
/// pixel samples the four nearest source texels with fractional weights, so a
/// thin bright peak spreads into a wider, softer glow (web parity).
Uint8List _bilinearUpscaleI8(
    Uint8List src, int srcW, int srcH, int dstW, int dstH) {
  final out = Uint8List(dstW * dstH);
  // Precompute the horizontal source texel pairs + fractional weight per column.
  final x0s = Int32List(dstW);
  final x1s = Int32List(dstW);
  final xW = Float64List(dstW);
  for (var x = 0; x < dstW; x++) {
    final fx = (x + 0.5) * srcW / dstW - 0.5;
    var x0 = fx.floor();
    final frac = fx - x0;
    var x1 = x0 + 1;
    if (x0 < 0) x0 = 0;
    if (x0 >= srcW) x0 = srcW - 1;
    if (x1 < 0) x1 = 0;
    if (x1 >= srcW) x1 = srcW - 1;
    x0s[x] = x0;
    x1s[x] = x1;
    xW[x] = frac < 0 ? 0.0 : (frac > 1 ? 1.0 : frac);
  }
  for (var y = 0; y < dstH; y++) {
    final fy = (y + 0.5) * srcH / dstH - 0.5;
    var y0 = fy.floor();
    final fyFrac = fy - y0;
    var y1 = y0 + 1;
    if (y0 < 0) y0 = 0;
    if (y0 >= srcH) y0 = srcH - 1;
    if (y1 < 0) y1 = 0;
    if (y1 >= srcH) y1 = srcH - 1;
    final row0 = y0 * srcW;
    final row1 = y1 * srcW;
    final dstRow = y * dstW;
    final wy = fyFrac < 0 ? 0.0 : (fyFrac > 1 ? 1.0 : fyFrac);
    for (var x = 0; x < dstW; x++) {
      final x0 = x0s[x];
      final x1 = x1s[x];
      final wx = xW[x];
      final p00 = src[row0 + x0];
      final p10 = src[row0 + x1];
      final p01 = src[row1 + x0];
      final p11 = src[row1 + x1];
      final top = p00 + (p10 - p00) * wx;
      final bot = p01 + (p11 - p01) * wx;
      out[dstRow + x] = (top + (bot - top) * wy).round().clamp(0, 255);
    }
  }
  return out;
}

/// Singleton persistent isolate worker — reused across all renders.
final _SpectroIsolateWorker _worker = _SpectroIsolateWorker();

// ---------------------------------------------------------------------------
// Dedicated warp isolate — kept separate from the render worker so view
// toggles never queue behind multi-second full renders.
// ---------------------------------------------------------------------------

class _WarpIsolateWorker {
  Isolate? _isolate;
  SendPort? _sendPort;
  ReceivePort? _receivePort;
  bool _initialized = false;

  Future<void> _ensureInitialized() async {
    if (_initialized && _isolate != null) return;

    _receivePort = ReceivePort();
    _isolate = await Isolate.spawn(
      _warpIsolateEntry,
      _receivePort!.sendPort,
      debugName: 'spectro-warp',
    );
    _sendPort = await _receivePort!.first as SendPort;
    _initialized = true;
  }

  Future<Uint8List> warp(WarpRequest req) async {
    await _ensureInitialized();

    final resultPort = ReceivePort();
    _sendPort!.send([req, resultPort.sendPort]);

    final result = await resultPort.first;
    resultPort.close();

    if (result is String) {
      throw StateError('Isolate warp failed: $result');
    }
    return result as Uint8List;
  }

  void dispose() {
    _isolate?.kill(priority: Isolate.immediate);
    _isolate = null;
    _receivePort?.close();
    _sendPort = null;
    _initialized = false;
  }
}

void _warpIsolateEntry(SendPort mainSendPort) {
  final port = ReceivePort();
  mainSendPort.send(port.sendPort);
  port.listen((message) {
    final req = message[0] as WarpRequest;
    final replyTo = message[1] as SendPort;
    try {
      replyTo.send(_upscaleAndWarp(req));
    } catch (e) {
      replyTo.send(e.toString());
    }
  });
}

final _WarpIsolateWorker _warpWorker = _WarpIsolateWorker();

Future<RenderResult> renderSpectrogramIsolate(RenderRequest req) async {
  return _worker.render(req);
}

/// Applies the gain LUT (+ log-axis warp) on the dedicated warp isolate and
/// returns the raw RGBA bytes for `decodeImageFromPixels`.
Future<Uint8List> warpSpectrogramIsolate(WarpRequest req) {
  return _warpWorker.warp(req);
}

Future<ui.Image> rgbaToUiImage(Uint8List rgba, int width, int height) async {
  final completer = Completer<ui.Image>();
  ui.decodeImageFromPixels(
    rgba.buffer.asUint8List(rgba.offsetInBytes, rgba.lengthInBytes),
    width,
    height,
    ui.PixelFormat.rgba8888,
    completer.complete,
  );
  return completer.future;
}


