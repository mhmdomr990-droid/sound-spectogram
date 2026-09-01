import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';

import 'spectro.dart';
import '../models/device_history.dart';

// ---------------------------------------------------------------------------
// Color LUT — pre-computed 256-entry RGBA lookup table per color map.
// ---------------------------------------------------------------------------

class ColorLUT {
  final Uint8List rgba;
  const ColorLUT(this.rgba);

  static ColorLUT build(List<List<double>> colorMap) {
    final buf = Uint8List(256 * 4);
    for (var i = 0; i < 256; i++) {
      final v = i / 255.0;
      final c = colorMapToColor(colorMap, v);
      buf[i * 4] = c[0].clamp(0, 255);
      buf[i * 4 + 1] = c[1].clamp(0, 255);
      buf[i * 4 + 2] = c[2].clamp(0, 255);
      buf[i * 4 + 3] = 0xFF;
    }
    return ColorLUT(buf);
  }
}

// ---------------------------------------------------------------------------
// Request / Result classes
// ---------------------------------------------------------------------------

class RawBlockData {
  final List<List<double>> data;
  final String? intensityType;
  final double min;
  final double max;
  const RawBlockData(this.data, this.intensityType, this.min, this.max);
}

class _RenderRequest {
  final List<RawBlockData> rawBlocks;
  final double gainDb;
  final double noiseThreshold;
  final int width;
  final int height;
  const _RenderRequest(this.rawBlocks, this.gainDb, this.noiseThreshold, this.width, this.height);
}

class _RasterizeRequest {
  final List<List<double>> combined;
  final double gainDb;
  final int width;
  final int height;
  final int startCol;
  final int endCol;
  const _RasterizeRequest(this.combined, this.gainDb, this.width, this.height, {this.startCol = 0, this.endCol = -1});
}

class _RenderResult {
  final Uint8List bytes;
  final int width;
  final int height;
  const _RenderResult(this.bytes, this.width, this.height);
}

class _CacheResult {
  final _RenderResult imageBytes;
  final List<List<double>> cachedCombined;
  const _CacheResult(this.imageBytes, this.cachedCombined);
}

class RasterizeOutput {
  final ui.Image image;
  final List<List<double>> cachedCombined;
  const RasterizeOutput({required this.image, required this.cachedCombined});
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

class SpectroIsolate {
  static Future<RasterizeOutput> renderAndCache({
    required List<RawBlockData> rawBlocks,
    required List<List<double>> colorMap,
    double gainDb = 0.0,
    double noiseThreshold = 0.06,
    required int width,
    required int height,
  }) async {
    final req = _RenderRequest(rawBlocks, gainDb, noiseThreshold, width, height);
    final result = await compute(_renderRaw, req);
    if (result == null) throw StateError('renderAndCache failed');
    final image = await _decodeImage(result.imageBytes);
    return RasterizeOutput(image: image, cachedCombined: result.cachedCombined);
  }

  static Future<ui.Image> rasterizeOnly({
    required List<List<double>> cachedCombined,
    required List<List<double>> colorMap,
    double gainDb = 0.0,
    required int width,
    required int height,
    int startCol = 0,
    int endCol = -1,
  }) async {
    final req = _RasterizeRequest(cachedCombined, gainDb, width, height, startCol: startCol, endCol: endCol);
    final result = await compute(_rasterize, req);
    if (result == null) throw StateError('rasterizeOnly failed');
    return _decodeImage(result);
  }

  static Future<ui.Image> _decodeImage(_RenderResult r) async {
    final completer = Completer<ui.Image>();
    ui.decodeImageFromPixels(r.bytes, r.width, r.height, ui.PixelFormat.rgba8888,
        (img) => completer.complete(img));
    return completer.future;
  }
}

// ---------------------------------------------------------------------------
// Isolate functions — run via compute()
// ---------------------------------------------------------------------------

_CacheResult? _renderRaw(_RenderRequest req) {
  final rawBlocks = req.rawBlocks;
  if (rawBlocks.isEmpty) return null;

  final normalizedBlocks = <List<List<double>>>[];
  for (final raw in rawBlocks) {
    if (raw.data.isEmpty || raw.data[0].isEmpty) continue;
    final normalizedBlock = <List<double>>[];
    for (var r = 0; r < raw.data.length; r++) {
      final row = raw.data[r];
      final normalizedRow = <double>[];
      for (var c = 0; c < row.length; c++) {
        normalizedRow.add(DeviceHistory.normalizeValue(row[c], raw.intensityType, raw.min, raw.max));
      }
      normalizedBlock.add(normalizedRow);
    }
    normalizedBlocks.add(normalizedBlock);
  }
  if (normalizedBlocks.isEmpty) return null;

  final globalHist = _collectGlobalHistogram(normalizedBlocks);
  final globalThreshold = math.max(
    _quantileFromHistogram(globalHist, 0.72),
    req.noiseThreshold,
  );

  final denoisedBlocks = <List<List<double>>>[];
  for (final block in normalizedBlocks) {
    denoisedBlocks.add(_processBlockMatrix(block, globalThreshold));
  }

  final combined = _concatBlocks(denoisedBlocks);
  if (combined.isEmpty) return null;

  final bytes = _doRasterizeIntensity(combined, req.gainDb, req.width, req.height);

  final cachedCombined = List<List<double>>.generate(
      combined.length, (r) => List<double>.from(combined[r]));

  return _CacheResult(_RenderResult(bytes, req.width, req.height), cachedCombined);
}

_RenderResult? _rasterize(_RasterizeRequest req) {
  final combined = req.combined;
  if (combined.isEmpty) return null;

  final bytes = _doRasterizeIntensity(combined, req.gainDb, req.width, req.height, startCol: req.startCol, endCol: req.endCol);
  return _RenderResult(bytes, req.width, req.height);
}

// ---------------------------------------------------------------------------
// Rasterization — LUT-based
// ---------------------------------------------------------------------------

Uint8List _doRasterizeIntensity(List<List<double>> combined, double gainDb, int width, int height, {int startCol = 0, int endCol = -1}) {
  final dataHeight = combined.length;
  if (dataHeight == 0) return Uint8List(0);
  final dataWidth = combined[0].length;
  if (dataWidth == 0) return Uint8List(0);

  if (endCol < 0) endCol = dataWidth;
  final visibleCols = endCol - startCol;
  if (visibleCols <= 0) return Uint8List(0);

  final total = width * height * 4;
  final bytes = Uint8List(total);

  final scale = gainDb != 0 ? math.pow(10.0, gainDb / 20.0).toDouble() : 1.0;
  final useGain = gainDb != 0;

  for (var py = 0; py < height; py++) {
    final rowIndex = (dataHeight - 1 - ((py * dataHeight) / height).floor())
        .clamp(0, dataHeight - 1);
    final row = combined[rowIndex];
    final rowOffset = py * width * 4;

    for (var px = 0; px < width; px++) {
      final offset = rowOffset + px * 4;

      final colStart = startCol + ((px * visibleCols) / width).floor();
      final colEndExclusive = startCol + (((px + 1) * visibleCols) / width).floor();

      if (colStart >= row.length || colStart < 0) {
        bytes[offset] = 0;
        bytes[offset + 1] = 0;
        bytes[offset + 2] = 0;
        bytes[offset + 3] = 0;
        continue;
      }

      var maxValue = 0.0;
      for (var ci = colStart; ci < colEndExclusive && ci < row.length; ci++) {
        if (ci >= 0 && row[ci] > maxValue) {
          maxValue = row[ci];
        }
      }

      var value = maxValue;
      if (useGain && value > 0) {
        value = (value * scale).clamp(0.0, 1.0);
      }
      final byteVal = (value * 255).round().clamp(0, 255);
      bytes[offset] = byteVal;
      bytes[offset + 1] = byteVal;
      bytes[offset + 2] = byteVal;
      bytes[offset + 3] = 0xFF;
    }
  }

  return bytes;
}

List<List<double>> _concatBlocks(List<List<List<double>>> denoisedBlocks) {
  if (denoisedBlocks.isEmpty) return [];
  final dataHeight = denoisedBlocks[0].length;
  final combined = <List<double>>[];
  for (var r = 0; r < dataHeight; r++) {
    combined.add(<double>[]);
  }
  for (final block in denoisedBlocks) {
    final rows = block.length;
    for (var r = 0; r < rows && r < dataHeight; r++) {
      combined[r].addAll(block[r]);
    }
  }
  return combined;
}

// ---------------------------------------------------------------------------
// Noise suppression
// ---------------------------------------------------------------------------

List<List<double>> _processBlockMatrix(List<List<double>> matrix, double threshold) {
  final rows = matrix.length;
  if (rows == 0) return matrix;
  final cols = matrix[0].length;
  if (cols == 0) return matrix;

  final gated = List<List<double>>.generate(
      rows, (r) => List<double>.generate(cols, (c) => matrix[r][c]));
  final mask = List<List<bool>>.generate(
      rows, (r) => List<bool>.generate(cols, (c) => false));

  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      final v = gated[r][c];
      if (v < threshold) {
        gated[r][c] = 0;
      }
      mask[r][c] = gated[r][c] > 0;
    }
  }

  final eroded = List<List<bool>>.generate(
      rows, (r) => List<bool>.generate(cols, (c) => false));
  for (var r = 1; r < rows - 1; r++) {
    for (var c = 1; c < cols - 1; c++) {
      if (!mask[r][c]) continue;
      var count = 0;
      for (var dr = -1; dr <= 1; dr++) {
        for (var dc = -1; dc <= 1; dc++) {
          if (mask[r + dr][c + dc]) count++;
        }
      }
      eroded[r][c] = count >= 3;
    }
  }

  const neighborhoodSize = 5;
  const minActiveNeighbors = 2;
  final radius = (neighborhoodSize - 1) ~/ 2;

  var currentMask = eroded;
  for (var pass = 0; pass < 2; pass++) {
    final filteredMask = List<List<bool>>.generate(
        rows, (r) => List<bool>.generate(cols, (c) => false));

    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        if (!currentMask[r][c]) {
          filteredMask[r][c] = false;
          continue;
        }
        final neighborCount =
            _countActiveNeighbors(currentMask, r, c, radius);
        final keep = neighborCount >= minActiveNeighbors ||
            _hasLineSupport(currentMask, r, c);
        filteredMask[r][c] = keep;
      }
    }

    _removeSmallComponents(filteredMask);
    currentMask = filteredMask;
  }

  final bridgedMask = _bridgeThinGaps(currentMask);

  final denoised = List<List<double>>.generate(
      rows, (r) => List<double>.generate(cols, (c) {
    return bridgedMask[r][c] ? gated[r][c] : 0.0;
  }));

  return denoised;
}

// ---------------------------------------------------------------------------
// Global histogram — matches web collectNormalizedHistogram
// ---------------------------------------------------------------------------

_HistogramData _collectGlobalHistogram(List<List<List<double>>> blocks) {
  const binsCount = 1024;
  final hist = List<int>.filled(binsCount, 0);
  var total = 0;

  for (final matrix in blocks) {
    final rows = matrix.length;
    if (rows == 0) continue;
    final cols = matrix[0].length;
    if (cols == 0) continue;
    final rowStep = math.max(1, rows ~/ 64);
    final colStep = math.max(1, cols ~/ 64);

    for (var r = 0; r < rows; r += rowStep) {
      for (var c = 0; c < cols; c += colStep) {
        final v = matrix[r][c].clamp(0.0, 1.0);
        final binIndex =
            (v * (binsCount - 1)).floor().clamp(0, binsCount - 1);
        hist[binIndex]++;
        total++;
      }
    }
  }

  return _HistogramData(hist, total);
}

// ---------------------------------------------------------------------------
// Histogram helpers
// ---------------------------------------------------------------------------

class _HistogramData {
  final List<int> hist;
  final int total;
  const _HistogramData(this.hist, this.total);
}

double _quantileFromHistogram(_HistogramData data, double q) {
  if (data.total <= 0) return 0;
  final target = q * (data.total - 1);
  var acc = 0;
  for (var i = 0; i < data.hist.length; i++) {
    acc += data.hist[i];
    if (acc > target) {
      return i / math.max(1, data.hist.length - 1);
    }
  }
  return 1.0;
}

// ---------------------------------------------------------------------------
// Isolated pixel removal helpers
// ---------------------------------------------------------------------------

int _countActiveNeighbors(List<List<bool>> mask, int row, int col, int radius) {
  final rows = mask.length;
  final cols = rows > 0 ? mask[0].length : 0;
  var neighbors = 0;

  for (var dr = -radius; dr <= radius; dr++) {
    for (var dc = -radius; dc <= radius; dc++) {
      if (dr == 0 && dc == 0) continue;
      final rr = row + dr;
      final cc = col + dc;
      if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
      if (mask[rr][cc]) neighbors++;
    }
  }

  return neighbors;
}

bool _hasLineSupport(List<List<bool>> mask, int row, int col) {
  final rows = mask.length;
  final cols = rows > 0 ? mask[0].length : 0;
  final up = row - 1 >= 0 && mask[row - 1][col];
  final down = row + 1 < rows && mask[row + 1][col];
  final left = col - 1 >= 0 && mask[row][col - 1];
  final right = col + 1 < cols && mask[row][col + 1];
  return (up && down) || (left && right);
}

void _removeSmallComponents(List<List<bool>> mask) {
  final rows = mask.length;
  if (rows == 0) return;
  final cols = mask[0].length;

  final visited = List<List<bool>>.generate(
      rows, (r) => List<bool>.filled(cols, false));

  const dirs = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1],
  ];

  for (var row = 0; row < rows; row++) {
    for (var col = 0; col < cols; col++) {
      if (!mask[row][col] || visited[row][col]) continue;

      final queue = <List<int>>[];
      final members = <List<int>>[];
      queue.add([row, col]);
      visited[row][col] = true;

      while (queue.isNotEmpty) {
        final node = queue.removeLast();
        members.add(node);

        for (final d in dirs) {
          final rr = node[0] + d[0];
          final cc = node[1] + d[1];
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          if (!mask[rr][cc] || visited[rr][cc]) continue;
          visited[rr][cc] = true;
          queue.add([rr, cc]);
        }
      }

      if (members.length < 15) {
        for (final m in members) {
          mask[m[0]][m[1]] = false;
        }
      }
    }
  }
}

List<List<bool>> _bridgeThinGaps(List<List<bool>> mask) {
  final rows = mask.length;
  if (rows == 0) return mask;
  final cols = mask[0].length;

  final next = List<List<bool>>.generate(
      rows, (r) => List<bool>.from(mask[r]));

  for (var row = 1; row < rows - 1; row++) {
    for (var col = 1; col < cols - 1; col++) {
      if (mask[row][col]) continue;
      final verticalBridge = mask[row - 1][col] && mask[row + 1][col];
      final horizontalBridge = mask[row][col - 1] && mask[row][col + 1];
      if (verticalBridge || horizontalBridge) {
        next[row][col] = true;
      }
    }
  }

  return next;
}
