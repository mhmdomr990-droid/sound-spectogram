import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';

import 'spectro.dart';

class SpectroIsolate {
  static Future<ui.Image> render({
    required List<List<List<double>>> blocks,
    required List<List<double>> colorMap,
    double gainDb = 0.0,
    double noiseThreshold = 0.06,
    required int width,
    required int height,
  }) async {
    final request = _RenderRequest(
      blocks: blocks,
      colorMap: colorMap,
      gainDb: gainDb,
      noiseThreshold: noiseThreshold,
      width: width,
      height: height,
    );
    final result = await compute(_render, request);
    if (result == null) {
      throw StateError('render failed');
    }
    final completer = Completer<ui.Image>();
    ui.decodeImageFromPixels(
        result.bytes, result.width, result.height, ui.PixelFormat.rgba8888,
        (image) => completer.complete(image));
    return completer.future;
  }
}

class _RenderRequest {
  final List<List<List<double>>> blocks;
  final List<List<double>> colorMap;
  final double gainDb;
  final double noiseThreshold;
  final int width;
  final int height;

  const _RenderRequest({
    required this.blocks,
    required this.colorMap,
    required this.gainDb,
    required this.noiseThreshold,
    required this.width,
    required this.height,
  });
}

class _RenderResult {
  final Uint8List bytes;
  final int width;
  final int height;

  const _RenderResult(this.bytes, this.width, this.height);
}

_RenderResult? _render(_RenderRequest req) {
  final blocks = req.blocks;
  if (blocks.isEmpty) return null;

  // Process each block independently (matches web: per-block noise suppression).
  final denoisedBlocks = <List<List<double>>>[];
  for (final block in blocks) {
    if (block.isEmpty || block[0].isEmpty) continue;
    denoisedBlocks.add(_processBlockMatrix(block, req.noiseThreshold));
  }

  if (denoisedBlocks.isEmpty) return null;

  // Concatenate denoised blocks horizontally (time axis).
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

  final dataWidth = combined.isNotEmpty ? combined[0].length : 0;
  if (dataHeight == 0 || dataWidth == 0) return null;

  final total = req.width * req.height * 4;
  final bytes = Uint8List(total);

  for (var py = 0; py < req.height; py++) {
    final rowIndex = (dataHeight - 1 - ((py * dataHeight) / req.height).floor())
        .clamp(0, dataHeight - 1);
    final row = combined[rowIndex];
    for (var px = 0; px < req.width; px++) {
      final colIndex =
          ((px * dataWidth) / req.width).floor().clamp(0, dataWidth - 1);
      final value = (colIndex < row.length) ? row[colIndex] : 0.0;
      final color = colorMapToColor(req.colorMap, _applyGain(value, req.gainDb));

      final offset = (py * req.width + px) * 4;
      bytes[offset] = color[0].clamp(0, 255);
      bytes[offset + 1] = color[1].clamp(0, 255);
      bytes[offset + 2] = color[2].clamp(0, 255);
      bytes[offset + 3] = 0xFF;
    }
  }

  return _RenderResult(bytes, req.width, req.height);
}

double _applyGain(double value, double gainDb) {
  if (gainDb == 0 || value <= 0) return value;
  final scale = math.pow(10.0, gainDb / 20.0).toDouble();
  return (value * scale).clamp(0.0, 1.0);
}

// ---------------------------------------------------------------------------
// Noise suppression — matches web spectrogram.js processBlockMatrix
// ---------------------------------------------------------------------------

List<List<double>> _processBlockMatrix(List<List<double>> matrix, double noiseThreshold) {
  final rows = matrix.length;
  if (rows == 0) return matrix;
  final cols = matrix[0].length;
  if (cols == 0) return matrix;

  // 1. Compute histogram and threshold
  final histData = _collectNormalizedHistogram(matrix);
  final threshold =
      math.max(_quantileFromHistogram(histData, 0.72), noiseThreshold);

  // 2. Gate noise and build active mask
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

  // 3. Morphological erosion — thins all regions, removes thin protrusions/noise
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

  // 4. Isolated pixel removal (aggressive, 2 passes)
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

  // 5. Gap bridging (morphology)
  final bridgedMask = _bridgeThinGaps(currentMask);

  // 6. Build denoised matrix
  final denoised = List<List<double>>.generate(
      rows, (r) => List<double>.generate(cols, (c) {
    return bridgedMask[r][c] ? gated[r][c] : 0.0;
  }));

  return denoised;
}

// ---------------------------------------------------------------------------
// Histogram helpers
// ---------------------------------------------------------------------------

class _HistogramData {
  final List<int> hist;
  final int total;
  const _HistogramData(this.hist, this.total);
}

_HistogramData _collectNormalizedHistogram(List<List<double>> matrix) {
  const binsCount = 1024;
  final hist = List<int>.filled(binsCount, 0);
  var total = 0;

  final rows = matrix.length;
  if (rows == 0) return _HistogramData(hist, 0);
  final cols = matrix[0].length;
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

  return _HistogramData(hist, total);
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
