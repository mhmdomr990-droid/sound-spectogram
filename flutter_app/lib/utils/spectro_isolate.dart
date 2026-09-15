import 'dart:async';
import 'dart:isolate';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'spectro.dart';

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
  final double dbMin;
  final double dbMax;
  final bool debug;
  final double gainDb;
  final String? startTimeIso;
  final String? endTimeIso;
  final int backgroundColor;

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
    this.dbMin = -95.0,
    this.dbMax = -20.0,
    this.debug = false,
    this.gainDb = 0.0,
    this.startTimeIso,
    this.endTimeIso,
    this.backgroundColor = 0xFF111026,
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

  final combined = List.generate(targetRows, (_) => List<num>.filled(totalCols, 0));

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
    final req = message[0] as RenderRequest;
    final replyTo = message[1] as SendPort;

    try {
      final List<List<num>> matrix;
      if (req.hasHistories) {
        matrix = buildMatrixFromHistories(req.histories, req.requestStartTime, req.requestEndTime);
      } else {
        matrix = req.matrix;
      }

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
        dbMin: req.dbMin,
        dbMax: req.dbMax,
        debug: req.debug,
        gainDb: req.gainDb,
        startTimeIso: req.startTimeIso,
        endTimeIso: req.endTimeIso,
        backgroundColor: req.backgroundColor,
      );
      replyTo.send(RenderResult(result.rgba, result.width, result.height, intensity: result.intensity, gamma: result.gamma));
    } catch (e) {
      replyTo.send(e.toString());
    }
  });
}

/// Singleton persistent isolate worker — reused across all renders.
final _SpectroIsolateWorker _worker = _SpectroIsolateWorker();

Future<RenderResult> renderSpectrogramIsolate(RenderRequest req) async {
  return _worker.render(req);
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


