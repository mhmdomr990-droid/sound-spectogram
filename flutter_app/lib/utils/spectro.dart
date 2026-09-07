import 'dart:math';
import 'dart:typed_data';
import 'dart:ui' as ui;

class MagmaStop {
  final double p;
  final int r;
  final int g;
  final int b;

  const MagmaStop(this.p, this.r, this.g, this.b);
}

const List<MagmaStop> _magmaStops = [
  MagmaStop(0.0, 0, 0, 4),
  MagmaStop(0.16, 28, 16, 68),
  MagmaStop(0.33, 79, 18, 123),
  MagmaStop(0.5, 129, 37, 129),
  MagmaStop(0.66, 181, 54, 122),
  MagmaStop(0.83, 229, 80, 100),
  MagmaStop(1.0, 252, 253, 191),
];

double clamp01(double n) {
  if (n.isNaN) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

double normalizeIntensity(num value, {num inputValueMax = 255}) {
  final n = value.toDouble();
  if (n.isNaN) return 0;
  if (n <= 1) return clamp01(n);
  final maxValue = inputValueMax.toDouble();
  if (maxValue <= 0) return clamp01(n);
  return clamp01(n / maxValue);
}

/// Maps an intensity value (0..255 or 0..1) to an ARGB 32-bit int using the
/// magma colour map (identical stops to the web dashboard).
int valueToColor(num value, {num gamma = 1.0, num inputValueMax = 255}) {
  return _colorForNormalized(
    normalizeIntensity(value, inputValueMax: inputValueMax),
    gamma.toDouble(),
  );
}

int _colorForNormalized(double v0, double gammaValue) {
  final g = gammaValue > 0 ? gammaValue : 1.0;
  double v = clamp01(v0);
  v = pow(v, g).toDouble();

  for (var i = 0; i < _magmaStops.length - 1; i++) {
    final a = _magmaStops[i];
    final b = _magmaStops[i + 1];
    if (v >= a.p && v <= b.p) {
      final denom = (b.p - a.p).abs() < 1e-9 ? 1.0 : (b.p - a.p);
      final t = (v - a.p) / denom;
      final r = _round(_lerp(a.r, b.r, t));
      final g2 = _round(_lerp(a.g, b.g, t));
      final bl = _round(_lerp(a.b, b.b, t));
      return (0xFF << 24) | (r << 16) | (g2 << 8) | bl;
    }
  }

  final last = _magmaStops[_magmaStops.length - 1];
  return (0xFF << 24) | (last.r << 16) | (last.g << 8) | last.b;
}

double _lerp(num a, num b, double t) => a + (b - a) * t;

int _round(double v) {
  int r = v.round();
  if (r < 0) r = 0;
  if (r > 255) r = 255;
  return r;
}

double _dbFromMagnitude(num value) {
  final n = value.toDouble();
  if (!n.isFinite || n <= 0) return double.negativeInfinity;
  return 20 * log(n) / ln10;
}

String _inferImageIntensityType(List<List<num>> matrix) {
  var maxV = double.negativeInfinity;
  final rows = matrix.length;
  final cols = rows > 0 ? matrix[0].length : 0;
  final rowStep = max(1, (rows / 64).floor());
  final colStep = max(1, (cols / 64).floor());
  for (var r = 0; r < rows; r += rowStep) {
    for (var c = 0; c < cols; c += colStep) {
      final v = matrix[r][c];
      if (v is num) {
        final dv = v.toDouble();
        if (dv > maxV) maxV = dv;
      }
    }
  }
  if (!maxV.isFinite) return 'uint8';
  if (maxV <= 1.5) return 'normalized';
  if (maxV <= 255.0) return 'uint8';
  return 'magnitude';
}

double _normalizeScalarByType(num value, String? intensityType, num inputValueMax, num dbMin, num dbMax) {
  final n = value.toDouble();
  if (intensityType == null) {
    return normalizeIntensity(n, inputValueMax: inputValueMax);
  }
  final type = intensityType.toLowerCase();
  if (type == 'normalized') return clamp01(n);
  if (type == 'uint8') return clamp01(n / 255.0);
  if (type == 'db') {
    var minDb = dbMin.toDouble();
    var maxDb = dbMax.toDouble();
    if (!minDb.isFinite) minDb = -95.0;
    if (!maxDb.isFinite || maxDb <= minDb) maxDb = minDb + 75.0;
    return clamp01((n - minDb) / (maxDb - minDb));
  }
  // magnitude or fallback
  if (type == 'magnitude') {
    final db = _dbFromMagnitude(n);
    if (!db.isFinite) return 0.0;
    var minDb = dbMin.toDouble();
    var maxDb = dbMax.toDouble();
    if (!minDb.isFinite) minDb = -95.0;
    if (!maxDb.isFinite || maxDb <= minDb) maxDb = minDb + 75.0;
    return clamp01((db - minDb) / (maxDb - minDb));
  }
  return normalizeIntensity(n, inputValueMax: inputValueMax);
}

// --- Processing helpers ported from web spectrogram.js ---

Map<String, dynamic> _collectNormalizedHistogram(
    List<List<num>> matrix, int maxSamples, int histogramBins,
    {num inputValueMax = 255}) {
  final rows = matrix.length;
  final cols = rows > 0 ? matrix[0].length : 0;
  final limit = max(1000, maxSamples);
  final binsCount = max(64, histogramBins);
  final hist = List<int>.filled(binsCount, 0);
  var total = 0;
  var sum = 0.0;
  var minV = double.infinity;
  var maxV = double.negativeInfinity;

  final rowStep = max(1, (rows / 64).floor());
  final colStep = max(1, (cols / 64).floor());

  for (var r = 0; r < rows; r += rowStep) {
    for (var c = 0; c < cols; c += colStep) {
      final v = normalizeIntensity(matrix[r][c], inputValueMax: inputValueMax);
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
      sum += v;
      total += 1;
      final binIndex = min(binsCount - 1, max(0, (v * (binsCount - 1)).floor()));
      hist[binIndex] += 1;
      if (total >= limit) {
        return {
          'hist': hist,
          'total': total,
          'sum': sum,
          'min': minV.isFinite ? minV : 0,
          'max': maxV.isFinite ? maxV : 0,
          'binsCount': binsCount
        };
      }
    }
  }

  return {
    'hist': hist,
    'total': total,
    'sum': sum,
    'min': minV.isFinite ? minV : 0,
    'max': maxV.isFinite ? maxV : 0,
    'binsCount': binsCount
  };
}

double _quantileFromHistogram(Map<String, dynamic>? histogramData, double q) {
  if (histogramData == null) return 0.0;
  final hist = histogramData['hist'] as List<int>?;
  final total = histogramData['total'] as int? ?? 0;
  final binsCount = histogramData['binsCount'] as int? ?? 0;
  if (hist == null || total <= 0) return 0.0;
  final target = clamp01(q) * (total - 1);
  var acc = 0;
  for (var i = 0; i < binsCount; i++) {
    acc += hist[i];
    if (acc > target) return i / max(1, binsCount - 1);
  }
  return 1.0;
}

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
      if (mask[rr][cc]) neighbors += 1;
    }
  }
  return neighbors;
}

bool _hasLineSupport(List<List<bool>> mask, int row, int col) {
  final rows = mask.length;
  final cols = rows > 0 ? mask[0].length : 0;
  final up = row - 1 >= 0 ? mask[row - 1][col] : false;
  final down = row + 1 < rows ? mask[row + 1][col] : false;
  final left = col - 1 >= 0 ? mask[row][col - 1] : false;
  final right = col + 1 < cols ? mask[row][col + 1] : false;
  return (up && down) || (left && right);
}

void _removeSingletonComponents(List<List<bool>> mask) {
  final rows = mask.length;
  final cols = rows > 0 ? mask[0].length : 0;
  final visited = List.generate(rows, (_) => List<bool>.filled(cols, false));
  final dirs = [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
    [1, 1]
  ];

  for (var row = 0; row < rows; row++) {
    for (var col = 0; col < cols; col++) {
      if (!mask[row][col] || visited[row][col]) continue;
      final queue = <Map<String, int>>[];
      queue.add({'r': row, 'c': col});
      final members = <Map<String, int>>[];
      visited[row][col] = true;
      while (queue.isNotEmpty) {
        final node = queue.removeLast();
        members.add(node);
        for (var di = 0; di < dirs.length; di++) {
          final rr = node['r']! + dirs[di][0];
          final cc = node['c']! + dirs[di][1];
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          if (!mask[rr][cc] || visited[rr][cc]) continue;
          visited[rr][cc] = true;
          queue.add({'r': rr, 'c': cc});
        }
      }
      if (members.length == 1) {
        final only = members[0];
        mask[only['r']!][only['c']!] = false;
      }
    }
  }
}

List<List<bool>> _bridgeThinGaps(List<List<bool>> mask) {
  final rows = mask.length;
  final cols = rows > 0 ? mask[0].length : 0;
  final next = List.generate(rows, (r) => mask[r].toList());
  for (var row = 1; row < rows - 1; row++) {
    for (var col = 1; col < cols - 1; col++) {
      if (mask[row][col]) continue;
      final verticalBridge = mask[row - 1][col] && mask[row + 1][col];
      final horizontalBridge = mask[row][col - 1] && mask[row][col + 1];
      if (verticalBridge || horizontalBridge) next[row][col] = true;
    }
  }
  return next;
}

List<List<double>> _processMatrix(
  List<List<num>> matrix, {
  required num inputValueMax,
  required num noiseThreshold,
  required int noiseFloorPercentile,
  required bool isolatedPixelRemovalEnabled,
  required bool morphologyEnabled,
  required int neighborhoodSize,
  required int minActiveNeighbors,
  String? intensityType,
  num dbMin = -95,
  num dbMax = -20,
}) {
  final rows = matrix.length;
  final cols = rows > 0 ? matrix[0].length : 0;
  final original = List.generate(rows, (_) => List<double>.filled(cols, 0.0));
  final thresholded = List.generate(rows, (_) => List<double>.filled(cols, 0.0));
  var mask = List.generate(rows, (_) => List<bool>.filled(cols, false));

  // adaptive floor via histogram
  final hist = _collectNormalizedHistogram(matrix, 200000, 1024, inputValueMax: inputValueMax);
  var adaptiveFloor = _quantileFromHistogram(hist, clamp01(noiseFloorPercentile / 100.0));
  if (!adaptiveFloor.isFinite) adaptiveFloor = 0.0;
  final minimumThreshold = clamp01(noiseThreshold.toDouble());
  var threshold = max(adaptiveFloor, minimumThreshold);
  threshold = clamp01(threshold);

  var activeBefore = 0;
  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      final normalized = _normalizeScalarByType(matrix[r][c], intensityType, inputValueMax, dbMin, dbMax);
      original[r][c] = normalized;
      final gated = (normalized < threshold) ? 0.0 : normalized;
      thresholded[r][c] = gated;
      final active = gated > 0.0;
      mask[r][c] = active;
      if (active) activeBefore += 1;
    }
  }

  if (isolatedPixelRemovalEnabled) {
    final radius = ((neighborhoodSize - 1) / 2).floor();
    final filteredMask = List.generate(rows, (_) => List<bool>.filled(cols, false));
    for (var rr = 0; rr < rows; rr++) {
      for (var cc = 0; cc < cols; cc++) {
        if (!mask[rr][cc]) {
          filteredMask[rr][cc] = false;
          continue;
        }
        final neighborCount = _countActiveNeighbors(mask, rr, cc, radius);
        final keep = neighborCount >= minActiveNeighbors || _hasLineSupport(mask, rr, cc);
        filteredMask[rr][cc] = keep;
      }
    }
    mask = filteredMask;
    _removeSingletonComponents(mask);
  }

  if (morphologyEnabled) {
    mask = _bridgeThinGaps(mask);
  }

  final denoised = List.generate(rows, (_) => List<double>.filled(cols, 0.0));
  for (var r2 = 0; r2 < rows; r2++) {
    for (var c2 = 0; c2 < cols; c2++) {
      final keepValue = mask[r2][c2] ? thresholded[r2][c2] : 0.0;
      denoised[r2][c2] = keepValue;
    }
  }

  return denoised;
}

// --- end processing helpers ---

/// Builds an RGBA byte buffer (width*height*4) that renders a spectrogram
/// from a frequency x time matrix, with optional column bucket aggregation
/// (max) to fit the display width. Returns raw RGBA bytes ready for a ui.Image.
class SpectroRgbaResult {
  final Uint8List rgba;
  final int width;
  final int height;
  final Uint8List? intensity;
  final double gamma;

  const SpectroRgbaResult(this.rgba, this.width, this.height, {this.intensity, this.gamma = 1.0});
}

SpectroRgbaResult buildRgba(
  List<List<num>> matrix, {
  required int width,
  required int height,
  num gamma = 1.0,
  num inputValueMax = 255,
  num noiseThreshold = 0.0,
  int noiseFloorPercentile = 72,
  bool isolatedPixelRemovalEnabled = true,
  bool morphologyEnabled = true,
  int neighborhoodSize = 3,
  int minActiveNeighbors = 1,
  String? intensityType,
  num dbMin = -95,
  num dbMax = -20,
  bool debug = false,
  num gainDb = 0.0,
  String? startTimeIso,
  String? endTimeIso,
  int backgroundColor = 0xFF111026,
}) {
  final rows = matrix.length;
  final cols = rows > 0 ? matrix[0].length : 0;

  final rgba = Uint8List(width * height * 4);

  final bgR = (backgroundColor >> 16) & 0xFF;
  final bgG = (backgroundColor >> 8) & 0xFF;
  final bgB = backgroundColor & 0xFF;
  for (var i = 0; i < rgba.length; i += 4) {
    rgba[i] = bgR;
    rgba[i + 1] = bgG;
    rgba[i + 2] = bgB;
    rgba[i + 3] = 0xFF;
  }

  if (rows == 0 || cols == 0) {
  return SpectroRgbaResult(rgba, width, height);
  }

  final colToBin = cols / width;
  final rowToFreq = rows / height;
  final gammaArg = gamma.toDouble();
  final gainScale = pow(10.0, gainDb.toDouble() / 20.0).toDouble();

  // Infer intensity type when not provided (match web behavior)
  String? effectiveIntensityType = intensityType;
  if (effectiveIntensityType == null) {
    effectiveIntensityType = _inferImageIntensityType(matrix);
  }

  if (debug) {
    print('SPECTRO DEBUG: effectiveIntensityType=$effectiveIntensityType');
  }

  // Pre-process matrix to match web renderer (denoising / gating / morphology)
  final processedMatrix = _processMatrix(matrix,
      inputValueMax: inputValueMax,
      noiseThreshold: noiseThreshold,
      noiseFloorPercentile: noiseFloorPercentile,
      isolatedPixelRemovalEnabled: isolatedPixelRemovalEnabled,
      morphologyEnabled: morphologyEnabled,
      neighborhoodSize: neighborhoodSize,
      minActiveNeighbors: minActiveNeighbors,
      intensityType: effectiveIntensityType,
      dbMin: dbMin,
      dbMax: dbMax);

  if (debug) {
    // print a sample of the raw input matrix (before processing)
    if (rows > 0 && cols > 0) {
      final rawSample = matrix[(rows / 2).floor()];
      final rawSampleVals = rawSample.take(min(10, rawSample.length)).map((e) => e.toString()).join(',');
      print('SPECTRO DEBUG: rawSampleRow[0..${min(10, rawSample.length)-1}]=[$rawSampleVals]');
    }
    // compute basic stats of processed matrix
    final rowsP = processedMatrix.length;
    final colsP = rowsP > 0 ? processedMatrix[0].length : 0;
    double minP = double.infinity;
    double maxP = double.negativeInfinity;
    for (var r = 0; r < rowsP; r++) {
      for (var c = 0; c < colsP; c++) {
        final v = processedMatrix[r][c];
        if (v.isFinite) {
          if (v < minP) minP = v;
          if (v > maxP) maxP = v;
        }
      }
    }
    if (!minP.isFinite) minP = 0.0;
    if (!maxP.isFinite) maxP = 0.0;
    print('SPECTRO DEBUG: rows=$rows cols=$cols processedRows=$rowsP processedCols=$colsP intensityType=$intensityType dbMin=$dbMin dbMax=$dbMax noiseThreshold=$noiseThreshold noiseFloorPct=$noiseFloorPercentile processedMin=$minP processedMax=$maxP gamma=$gamma gainScale=$gainScale');
    if (rowsP > 0 && colsP > 0) {
      final sampleRow = processedMatrix[(rowsP / 2).floor()];
      final sampleVals = sampleRow.take(min(10, sampleRow.length)).map((e) => e.toStringAsFixed(3)).join(',');
      print('SPECTRO DEBUG: sampleRow[0..${min(10, sampleRow.length)-1}]=[$sampleVals]');

      // compute simple percentiles and mean
      final flat = <double>[];
      flat.length = 0;
      for (var r = 0; r < rowsP; r++) {
        flat.addAll(processedMatrix[r]);
      }
      flat.removeWhere((v) => !v.isFinite);
      if (flat.isNotEmpty) {
        flat.sort();
        double mean = flat.reduce((a, b) => a + b) / flat.length;
        double p50 = flat[(flat.length * 0.5).floor().clamp(0, flat.length - 1)];
        double p75 = flat[(flat.length * 0.75).floor().clamp(0, flat.length - 1)];
        double p90 = flat[(flat.length * 0.9).floor().clamp(0, flat.length - 1)];
          print('SPECTRO DEBUG: stats mean=${mean.toStringAsFixed(3)} p50=${p50.toStringAsFixed(3)} p75=${p75.toStringAsFixed(3)} p90=${p90.toStringAsFixed(3)}');
          final nonZero = flat.where((v) => v > 0).length;
          print('SPECTRO DEBUG: flatCount=${flat.length} nonZero=$nonZero noiseFloorPct=$noiseFloorPercentile');
          // histogram
          final bins = 20;
          final hist = List<int>.filled(bins, 0);
          final minF = flat.first;
          final maxF = flat.last;
          final range = max(1e-12, maxF - minF);
          for (var v in flat) {
            final b = (((v - minF) / range) * (bins - 1)).floor().clamp(0, bins - 1);
            hist[b] += 1;
          }
          print('SPECTRO DEBUG: histogram=${hist.sublist(0, min(bins, hist.length))} minF=${minF.toStringAsFixed(6)} maxF=${maxF.toStringAsFixed(6)}');
      }
    }
  }
    // Build an intensity mapper similar to web's buildIntensityMapper.
      // build intensity mapper using the raw input matrix (matches web's collectDbSamples)
      final intensityMapper = _buildIntensityMapper(matrix,
        intensityType: effectiveIntensityType, dbMin: dbMin, dbMax: dbMax);

    // helper matching web's aggregateBucketValue behaviour (supports 'hybrid').
    num _aggregateBucketValue(num maxValue, num sumValue, int countValue, {String bucketAggregation = 'hybrid'}) {
      if (bucketAggregation == 'hybrid') {
        if (countValue <= 0) return 0;
        final meanValue = sumValue / countValue;
        return 0.7 * maxValue + 0.3 * meanValue;
      }
      return maxValue;
    }

  // Match the web renderer's bucket flush behavior: fill a native intensity buffer
  // first, then convert each intensity byte to the magma palette. This keeps the
  // same yellow/high-value lines as the web version and avoids stray single-pixel dots.
  final intensity = Uint8List(width * height);
  final fastRowStride = max(1, (rows / 260).floor());

  void flushColumnBucket(List<num> bucketMax, List<num> bucketSum, List<int> bucketCount, int xStart, int xEnd) {
    for (var r = 0; r < rows; r += fastRowStride) {
      final rowEnd = min(rows, r + fastRowStride);
      num groupedValue = 0;
      for (var rg = r; rg < rowEnd; rg++) {
        final candidate = _aggregateBucketValue(bucketMax[rg], bucketSum[rg], bucketCount[rg], bucketAggregation: 'max');
        if (candidate > groupedValue) {
          groupedValue = candidate;
        }
      }

      final yNativeTop = rows - rowEnd;
      final yNativeBottom = rows - 1 - r;
      if (yNativeBottom < 0 || yNativeTop >= height) continue;

      final yStart = max(0, yNativeTop);
      final yStop = min(height - 1, yNativeBottom);
      if (yStop < yStart) continue;

      var value = intensityMapper(groupedValue);
      if (!value.isFinite) value = 0.0;
      value = clamp01(value * gainScale);
      if (value <= noiseThreshold) {
        continue;
      }
      final byteValue = max(0, min(255, (value * 255).round()));

      for (var yNative = yStart; yNative <= yStop; yNative++) {
        final rowOffset = yNative * width;
        for (var x = xStart; x < xEnd && x < width; x++) {
          intensity[rowOffset + x] = byteValue;
        }
      }
    }
  }

  // Aggregate columns into x-buckets and flush like the web renderer's flushColumnBucket.
  final bucketMax = List<num>.filled(rows, 0);
  final bucketSum = List<num>.filled(rows, 0);
  final bucketCount = List<int>.filled(rows, 0);
  var hasBucket = false;
  int bucketX0 = -1;
  int bucketX1 = -1;

  for (var c = 0; c < cols; c++) {
    // compute x mapping by dividing columns across width or using explicit time range
    int xStart;
    int xEnd;
    if (startTimeIso != null && endTimeIso != null) {
      try {
        final startMs = DateTime.parse(startTimeIso).toUtc().millisecondsSinceEpoch.toDouble();
        final endMs = DateTime.parse(endTimeIso).toUtc().millisecondsSinceEpoch.toDouble();
        if (endMs > startMs) {
          final stepMs = (endMs - startMs) / max(1, cols);
          final timeMs = startMs + c * stepMs;
          final nextTimeMs = startMs + (c + 1) * stepMs;
          final range = max(1e-9, endMs - startMs);
          xStart = (((timeMs - startMs) / range) * width).floor().clamp(0, width - 1);
          xEnd = (((nextTimeMs - startMs) / range) * width).ceil().clamp(xStart + 1, width);
        } else {
          xStart = ((c * width) / cols).floor().clamp(0, width - 1);
          xEnd = ((((c + 1) * width) / cols).ceil()).clamp(xStart + 1, width);
        }
      } catch (_) {
        xStart = ((c * width) / cols).floor().clamp(0, width - 1);
        xEnd = ((((c + 1) * width) / cols).ceil()).clamp(xStart + 1, width);
      }
    } else {
      // compute x mapping by dividing columns across width
      xStart = ((c * width) / cols).floor().clamp(0, width - 1);
      xEnd = ((((c + 1) * width) / cols).ceil()).clamp(xStart + 1, width);
    }

    if (!hasBucket) {
      hasBucket = true;
      bucketX0 = xStart;
      bucketX1 = xEnd;
      for (var r = 0; r < rows; r++) {
        final v = processedMatrix[r][c];
        bucketMax[r] = v;
        bucketSum[r] = v;
        bucketCount[r] = 1;
      }
      continue;
    }

    if (xStart == bucketX0) {
      if (xEnd > bucketX1) bucketX1 = xEnd;
      for (var r = 0; r < rows; r++) {
        final v = processedMatrix[r][c];
        if (v > bucketMax[r]) bucketMax[r] = v;
        bucketSum[r] += v;
        bucketCount[r] += 1;
      }
      continue;
    }

    flushColumnBucket(bucketMax, bucketSum, bucketCount, bucketX0, bucketX1);

    // reset bucket
    bucketX0 = xStart;
    bucketX1 = xEnd;
    for (var r = 0; r < rows; r++) {
      final v = processedMatrix[r][c];
      bucketMax[r] = v;
      bucketSum[r] = v;
      bucketCount[r] = 1;
    }
  }

  // final flush
  if (hasBucket) {
    flushColumnBucket(bucketMax, bucketSum, bucketCount, bucketX0, bucketX1);
  }

  for (var i = 0; i < intensity.length; i++) {
    final byteValue = intensity[i];
    final rgb = _colorForNormalized(byteValue / 255.0, gammaArg);
    final offset = i * 4;
    rgba[offset] = (rgb >> 16) & 0xFF;
    rgba[offset + 1] = (rgb >> 8) & 0xFF;
    rgba[offset + 2] = rgb & 0xFF;
    rgba[offset + 3] = 0xFF;
  }

  if (debug) {
    // print a small sample of the RGBA buffer for inspection
    final sampleLen = min(64, rgba.length);
    final sample = List<int>.generate(sampleLen, (i) => rgba[i]);
    print('SPECTRO DEBUG: rgbaSample[0..${sampleLen - 1}]=${sample}');
  }

  return SpectroRgbaResult(rgba, width, height, intensity: Uint8List.fromList(intensity), gamma: gammaArg);
}

/// Convert an RGBA byte buffer into a ui.Image for painting.
Future<ui.Image> rgbaToImage(Uint8List rgba, int width, int height) async {
  final codec = await ui.instantiateImageCodec(
    rgba,
    targetWidth: width,
    targetHeight: height,
  );
  final frame = await codec.getNextFrame();
  return frame.image;
}

typedef _IntensityMapFn = double Function(num value);

_IntensityMapFn _buildIntensityMapper(List<List<num>> blocks,
  {String? intensityType,
  num inputValueMax = 255,
  num dbMin = -95,
  num dbMax = -20,
  num percentileLow = 5,
  num percentileHigh = 99,
  int maxSamples = 20000}) {
  final type = intensityType ?? 'uint8';
  final allowsDb = (type == 'magnitude' || type == 'db');

  if (!allowsDb) {
    return (num v) => normalizeIntensity(v, inputValueMax: inputValueMax);
  }

  var minDb = dbMin.toDouble();
  var maxDb = dbMax.toDouble();
  if (!minDb.isFinite) minDb = -95.0;
  if (!maxDb.isFinite || maxDb <= minDb) maxDb = minDb + 75.0;

  // If percentiles requested, collect db samples from blocks (subsample) similar to web.
  try {
    final samples = <double>[];
    for (var r = 0; r < blocks.length; r += 1) {
      final row = blocks[r];
      if (row == null || row.isEmpty) continue;
      final rows = blocks.length;
      final cols = row.length;
      final rowStep = max(1, (rows / 48).floor());
      final colStep = max(1, (cols / 48).floor());
      for (var rr = 0; rr < rows; rr += rowStep) {
        for (var cc = 0; cc < cols; cc += colStep) {
          final raw = blocks[rr][cc];
          final db = _dbFromMagnitude(raw);
          if (db.isFinite) {
            samples.add(db);
            if (samples.length >= maxSamples) break;
          }
        }
        if (samples.length >= maxSamples) break;
      }
      if (samples.length >= maxSamples) break;
    }

    if (samples.isNotEmpty) {
      samples.sort();
      final lowIdx = ((samples.length - 1) * (percentileLow / 100.0)).floor().clamp(0, samples.length - 1);
      final highIdx = ((samples.length - 1) * (percentileHigh / 100.0)).floor().clamp(0, samples.length - 1);
      final qLow = samples[lowIdx];
      final qHigh = samples[highIdx];
      if (qHigh.isFinite && qLow.isFinite && qHigh > qLow) {
        minDb = qLow;
        maxDb = qHigh;
      }
      // Emit debug info so we can compare Flutter's chosen percentiles with web
      try {
        print('SPECTRO DEBUG: intensityMapper samples=${samples.length} qLow=${qLow.toStringAsFixed(3)} qHigh=${qHigh.toStringAsFixed(3)} minDb=${minDb.toStringAsFixed(3)} maxDb=${maxDb.toStringAsFixed(3)}');
      } catch (_) {}
    }
  } catch (_) {
    // ignore and fall back to defaults
  }

  return (num v) {
    final db = _dbFromMagnitude(v);
    if (!db.isFinite) return 0.0;
    return clamp01((db - minDb) / (maxDb - minDb));
  };
}
