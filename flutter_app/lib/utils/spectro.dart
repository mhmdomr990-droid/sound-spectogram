import 'dart:math';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'colormaps.dart';

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

// Intensity modes resolved once per pass (was: toLowerCase + string
// comparisons re-run for every matrix cell).
const int _normModeNormalizeIntensity = -1; // null or unrecognized type
const int _normModeNormalized = 0;
const int _normModeUint8 = 1;
const int _normModeDb = 2;
const int _normModeMagnitude = 3;

int _normModeOf(String? intensityType) {
  if (intensityType == null) return _normModeNormalizeIntensity;
  final type = intensityType.toLowerCase();
  if (type == 'normalized') return _normModeNormalized;
  if (type == 'uint8') return _normModeUint8;
  if (type == 'db') return _normModeDb;
  if (type == 'magnitude') return _normModeMagnitude;
  return _normModeNormalizeIntensity;
}

double _normalizeScalarByMode(num value, int mode, num inputValueMax, num dbMin, num dbMax) {
  final n = value.toDouble();
  if (mode == _normModeNormalized) return clamp01(n);
  if (mode == _normModeUint8) return clamp01(n / 255.0);
  if (mode == _normModeDb) {
    var minDb = dbMin.toDouble();
    var maxDb = dbMax.toDouble();
    if (!minDb.isFinite) minDb = -95.0;
    if (!maxDb.isFinite || maxDb <= minDb) maxDb = minDb + 75.0;
    return clamp01((n - minDb) / (maxDb - minDb));
  }
  if (mode == _normModeMagnitude) {
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
  // Equivalent to the connected-component scan it replaces: a component has
  // size 1 iff its cell has no active 8-neighbour. Removing a zero-neighbour
  // cell cannot change any other cell's neighbour count (it was nobody's
  // neighbour), so no cascades occur and a single in-place pass yields the
  // same result as the BFS.
  for (var row = 0; row < rows; row++) {
    for (var col = 0; col < cols; col++) {
      if (!mask[row][col]) continue;
      var hasNeighbor = false;
      for (var dr = -1; dr <= 1 && !hasNeighbor; dr++) {
        for (var dc = -1; dc <= 1; dc++) {
          if (dr == 0 && dc == 0) continue;
          final rr = row + dr;
          final cc = col + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          if (mask[rr][cc]) {
            hasNeighbor = true;
            break;
          }
        }
      }
      if (!hasNeighbor) mask[row][col] = false;
    }
  }
}

List<List<bool>> _bridgeThinGaps(List<List<bool>> mask) {
  final rows = mask.length;
  final cols = rows > 0 ? mask[0].length : 0;
  // Deferred writes: every decision reads the untouched original mask, and
  // writes only flip false->true, so applying them afterwards yields the same
  // result as writing into a full copy (without allocating it).
  final additions = <int>[];
  for (var row = 1; row < rows - 1; row++) {
    for (var col = 1; col < cols - 1; col++) {
      if (mask[row][col]) continue;
      final verticalBridge = mask[row - 1][col] && mask[row + 1][col];
      final horizontalBridge = mask[row][col - 1] && mask[row][col + 1];
      if (verticalBridge || horizontalBridge) additions.add(row * cols + col);
    }
  }
  for (final idx in additions) {
    mask[idx ~/ cols][idx % cols] = true;
  }
  return mask;
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
  final thresholded = List.generate(rows, (_) => Float64List(cols));
  var mask = List.generate(rows, (_) => List<bool>.filled(cols, false));
  final normMode = _normModeOf(intensityType);

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
      final normalized = _normalizeScalarByMode(matrix[r][c], normMode, inputValueMax, dbMin, dbMax);
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

  final denoised = List.generate(rows, (_) => Float64List(cols));
  for (var r2 = 0; r2 < rows; r2++) {
    for (var c2 = 0; c2 < cols; c2++) {
      final keepValue = mask[r2][c2] ? thresholded[r2][c2] : 0.0;
      denoised[r2][c2] = keepValue;
    }
  }

  return denoised;
}

// --- end processing helpers ---

// [sonic] Sparse peak extraction, ported from the web dashboard's
// processSonicMatrix (spectrogram.js). One column at a time:
//  1. keep only spectral PEAKS that stand out of the local level around them;
//  2. drop lone peaks with no peak near them (+-N bins) in the moment before
//     or after;
//  3. strength = value / loudest shown value of that moment;
//  4. remember where the peak really lies between two bins (parabola).
class SonicPeaks {
  final Int32List start; // cols+1 offsets into rows/values/offsets
  final Int32List rows;
  final Float32List values;
  final Float32List offsets;

  const SonicPeaks(this.start, this.rows, this.values, this.offsets);
}

SonicPeaks processSonicMatrix(
  List<List<num>> matrix, {
  String intensityType = 'uint8',
  num dbMin = -95,
  num dbMax = -20,
  num noiseRelease = 0,
  int rowStart = 0,
  int rowEnd = -1,
}) {
  const localBins = 6;
  const prominence = 0.03;
  const noiseFactor = 1.5;
  const silence = 0.04;
  const timeTolerance = 2;
  const dbRange = 60.0;

  final rows = matrix.length;
  final cols = rows > 0 ? matrix[0].length : 0;
  final isUint8 = intensityType == 'uint8';
  final isDb = intensityType == 'db';
  final lo = max(0, min(rows - 1, rowStart));
  final hi = max(lo, min(rows - 1, rowEnd >= 0 ? rowEnd : rows - 1));
  final tolerance = max(timeTolerance, (rows / 150).ceil());
  final release = noiseRelease.toDouble().clamp(0.0, 1.0);
  final keepFactor = pow(1 - release, 1.5).toDouble();
  final checkTime = cols >= 3 && release < 0.8;

  double normalizeScalar(num x) {
    final n = x.toDouble();
    if (!n.isFinite) return 0;
    if (isUint8) return clamp01(n / 255);
    if (intensityType == 'normalized') return clamp01(n);
    if (isDb) {
      var mn = dbMin.toDouble();
      var mx = dbMax.toDouble();
      if (!mn.isFinite) mn = -95;
      if (!mx.isFinite || mx <= mn) mx = mn + 75;
      return clamp01((n - mn) / (mx - mn));
    }
    return normalizeIntensity(n);
  }

  final vals = [Float32List(rows), Float32List(rows), Float32List(rows)];
  final cand = [Uint8List(rows), Uint8List(rows), Uint8List(rows)];
  final tops = Float32List(3);
  final prefix = Float64List(rows + 1);
  final excess = Float32List(rows);
  final start = Int32List(cols + 1);
  final outRows = <int>[];
  final outVals = <double>[];
  final outOffs = <double>[];

  void load(int c, int slot) {
    final v = vals[slot];
    final cd = cand[slot];
    for (var r = 0; r < rows; r++) {
      final line = matrix[r];
      v[r] = normalizeScalar(c < line.length ? line[c] : 0);
    }
    for (var i = 0; i < rows; i++) {
      cd[i] = 0;
    }
    var maxV = 0.0;
    for (var r = lo; r <= hi; r++) {
      if (v[r] > maxV) maxV = v[r];
    }
    tops[slot] = maxV;
    if (maxV < silence) return;
    prefix[0] = 0;
    for (var r = 0; r < rows; r++) {
      prefix[r + 1] = prefix[r] + v[r];
    }
    var wiggle = 0.0;
    for (var r = 0; r < rows; r++) {
      final a0 = r - localBins < 0 ? 0 : r - localBins;
      final a1 = r + localBins > rows - 1 ? rows - 1 : r + localBins;
      final i0 = r - 1 < 0 ? 0 : r - 1;
      final i1 = r + 1 > rows - 1 ? rows - 1 : r + 1;
      final count = a1 - a0 + 1 - (i1 - i0 + 1);
      final local =
          count > 0 ? (prefix[a1 + 1] - prefix[a0] - (prefix[i1 + 1] - prefix[i0])) / count : 0.0;
      final e = v[r] - local;
      excess[r] = e;
      if (r >= lo && r <= hi) {
        wiggle += e < 0 ? -e : e;
      }
    }
    final need = max(prominence, (noiseFactor * wiggle) / (hi - lo + 1)) * keepFactor;
    for (var r = 1; r < rows - 1; r++) {
      if ((need > 0 ? excess[r] > need : v[r] > 0) && v[r] > v[r - 1] && v[r] >= v[r + 1]) {
        cd[r] = 1;
      }
    }
  }

  bool hasNear(int slot, int row) {
    if (slot < 0) return false;
    final cd = cand[slot];
    final from = max(0, row - tolerance);
    final to = min(rows - 1, row + tolerance);
    for (var k = from; k <= to; k++) {
      if (cd[k] == 1) return true;
    }
    return false;
  }

  void finalize(int c, int prevSlot, int slot, int nextSlot) {
    start[c] = outRows.length;
    if (rows < 3) return;
    final top = tops[slot];
    if (top < silence) return;
    final v = vals[slot];
    final cd = cand[slot];
    for (var r = 1; r < rows - 1; r++) {
      if (cd[r] != 1) continue;
      if (checkTime && !hasNear(prevSlot, r) && !hasNear(nextSlot, r)) continue;
      final value = v[r];
      final strength =
          isDb ? pow(10.0, (-(top - value) * dbRange) / 20).toDouble() : value / top;
      final a = v[r - 1];
      final b = v[r + 1];
      final den = a - 2 * value + b;
      final off = den < 0 ? (0.5 * (a - b)) / den : 0.0;
      outRows.add(r);
      outVals.add(strength > 1 ? 1.0 : strength);
      outOffs.add(off > 0.5 ? 0.5 : (off < -0.5 ? -0.5 : off));
    }
  }

  for (var c = 0; c < cols; c++) {
    load(c, c % 3);
    if (c >= 1) {
      finalize(c - 1, c >= 2 ? (c - 2) % 3 : -1, (c - 1) % 3, c % 3);
    }
  }
  if (cols >= 1) {
    finalize(cols - 1, cols >= 2 ? (cols - 2) % 3 : -1, (cols - 1) % 3, -1);
  }
  start[cols] = outRows.length;
  // ignore: avoid_print
  print('[Sonic] peaks=${outRows.length} cols=$cols rows=$rows '
      'release=$release keepFactor=$keepFactor checkTime=$checkTime');

  return SonicPeaks(
    start,
    Int32List.fromList(outRows),
    Float32List.fromList(outVals),
    Float32List.fromList(outOffs),
  );
}

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
  String intensityMode = 'linear',
  num dbMin = -95,
  num dbMax = -20,
  bool debug = false,
  num gainDb = 0.0,
  String? startTimeIso,
  String? endTimeIso,
  int backgroundColor = 0xFF111026,
  String colorMap = kDefaultColorMap,
  num noiseLevel = 0,
  int dstHeight = 0,
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
  // effectiveGamma = gamma * (1 - 0.65*noiseRelease): lifts weak values in the
  // colour table only, matching the web's palette construction.
  final gammaArg = effectiveGammaOf(gamma, noiseLevel);
  final gainScale = pow(10.0, gainDb.toDouble() / 20.0).toDouble();

  // Infer intensity type when not provided (match web behavior)
  String? effectiveIntensityType = intensityType;
  if (effectiveIntensityType == null) {
    effectiveIntensityType = _inferImageIntensityType(matrix);
  }

  if (debug) {
    print('SPECTRO DEBUG: effectiveIntensityType=$effectiveIntensityType');
  }

  // [sonic] Peak-lines drawing mode: extract sparse spectral peaks and draw
  // them as thin sub-rows (up to 8 rows per bin) instead of filled columns.
  // This is the web's processSonicMatrix + drawSonicPeaks pipeline; the
  // returned intensity plane is rows*sonicScale tall and the existing
  // upscale/warp path maps it to the display resolution.
  if (isSonicColorMap(colorMap)) {
    final peaks = processSonicMatrix(
      matrix,
      intensityType: effectiveIntensityType!,
      dbMin: dbMin,
      dbMax: dbMax,
      noiseRelease: noiseReleaseOf(noiseLevel),
    );
    final sonicScale =
        dstHeight > 0 ? max(1, min(8, dstHeight ~/ rows)) : 1;
    final surfH = rows * sonicScale;
    final intensity = Uint8List(width * surfH);

    // Parse the time range once for the x mapping (same as the bucket path).
    double? rangeStartMs;
    double? rangeEndMs;
    if (startTimeIso != null && endTimeIso != null) {
      try {
        final s = DateTime.parse(startTimeIso).toUtc().millisecondsSinceEpoch.toDouble();
        final e = DateTime.parse(endTimeIso).toUtc().millisecondsSinceEpoch.toDouble();
        if (e > s) {
          rangeStartMs = s;
          rangeEndMs = e;
        }
      } catch (_) {}
    }

    for (var c = 0; c < cols; c++) {
      final k0 = peaks.start[c];
      final k1 = peaks.start[c + 1];
      if (k0 == k1) continue;
      int xStart;
      int xEnd;
      if (rangeStartMs != null && rangeEndMs != null) {
        final stepMs = (rangeEndMs - rangeStartMs) / max(1, cols);
        final timeMs = rangeStartMs + c * stepMs;
        final nextTimeMs = rangeStartMs + (c + 1) * stepMs;
        final range = max(1e-9, rangeEndMs - rangeStartMs);
        xStart = (((timeMs - rangeStartMs) / range) * width).floor().clamp(0, width - 1);
        xEnd = (((nextTimeMs - rangeStartMs) / range) * width).ceil().clamp(xStart + 1, width);
      } else {
        xStart = ((c * width) / cols).floor().clamp(0, width - 1);
        xEnd = ((((c + 1) * width) / cols).ceil()).clamp(xStart + 1, width);
      }
      for (var k = k0; k < k1; k++) {
        var byteValue = (peaks.values[k] * gainScale * 255).round();
        if (byteValue <= 0) continue;
        if (byteValue > 255) byteValue = 255;
        final y = ((rows - 1 - peaks.rows[k] - peaks.offsets[k]) * sonicScale +
                (sonicScale - 1) / 2)
            .round();
        if (y < 0 || y >= surfH) continue;
        final rowOffset = y * width;
        for (var x = xStart; x < xEnd && x < width; x++) {
          if (intensity[rowOffset + x] < byteValue) {
            intensity[rowOffset + x] = byteValue;
          }
        }
      }
    }

    final paletteLut = buildPaletteLut(colorMap, gammaArg);
    final sonicRgba = Uint8List(width * surfH * 4);
    for (var i = 0; i < intensity.length; i++) {
      final rgb = paletteLut[intensity[i]];
      final offset = i * 4;
      sonicRgba[offset] = (rgb >> 16) & 0xFF;
      sonicRgba[offset + 1] = (rgb >> 8) & 0xFF;
      sonicRgba[offset + 2] = rgb & 0xFF;
      sonicRgba[offset + 3] = 0xFF;
    }
    return SpectroRgbaResult(sonicRgba, width, surfH,
        intensity: intensity, gamma: gammaArg);
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
        intensityType: effectiveIntensityType,
        intensityMode: intensityMode,
        dbMin: dbMin, dbMax: dbMax);

    // helper matching web's aggregateBucketValue behaviour (supports 'hybrid').
    double _aggregateBucketValue(double maxValue, double sumValue, int countValue, {String bucketAggregation = 'hybrid'}) {
      if (bucketAggregation == 'hybrid') {
        if (countValue <= 0) return 0.0;
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

  void flushColumnBucket(Float64List bucketMax, Float64List bucketSum, List<int> bucketCount, int xStart, int xEnd) {
    for (var r = 0; r < rows; r += fastRowStride) {
      final rowEnd = min(rows, r + fastRowStride);
      double groupedValue = 0;
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
  final bucketMax = Float64List(rows);
  final bucketSum = Float64List(rows);
  final bucketCount = List<int>.filled(rows, 0);
  var hasBucket = false;
  int bucketX0 = -1;
  int bucketX1 = -1;

  // Parse the time range once instead of DateTime.parse for every column.
  double? rangeStartMs;
  double? rangeEndMs;
  if (startTimeIso != null && endTimeIso != null) {
    try {
      final s = DateTime.parse(startTimeIso).toUtc().millisecondsSinceEpoch.toDouble();
      final e = DateTime.parse(endTimeIso).toUtc().millisecondsSinceEpoch.toDouble();
      if (e > s) {
        rangeStartMs = s;
        rangeEndMs = e;
      }
    } catch (_) {
      rangeStartMs = null;
      rangeEndMs = null;
    }
  }

  for (var c = 0; c < cols; c++) {
    // compute x mapping by dividing columns across width or using explicit time range
    int xStart;
    int xEnd;
    if (rangeStartMs != null && rangeEndMs != null) {
      final startMs = rangeStartMs;
      final endMs = rangeEndMs;
      final stepMs = (endMs - startMs) / max(1, cols);
      final timeMs = startMs + c * stepMs;
      final nextTimeMs = startMs + (c + 1) * stepMs;
      final range = max(1e-9, endMs - startMs);
      xStart = (((timeMs - startMs) / range) * width).floor().clamp(0, width - 1);
      xEnd = (((nextTimeMs - startMs) / range) * width).ceil().clamp(xStart + 1, width);
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

  // Palette lookup: use the selected colour map's 256-entry LUT (same
  // construction the web uses for its palette texture).
  final paletteLut = buildPaletteLut(colorMap, gammaArg);
  for (var i = 0; i < intensity.length; i++) {
    final rgb = paletteLut[intensity[i]];
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

typedef _IntensityMapFn = double Function(num value);

_IntensityMapFn _buildIntensityMapper(List<List<num>> blocks,
  {String? intensityType,
  String intensityMode = 'linear',
  num inputValueMax = 255,
  num dbMin = -95,
  num dbMax = -20,
  num percentileLow = 5,
  num percentileHigh = 99,
  int maxSamples = 20000}) {
  final type = intensityType ?? 'uint8';
  final allowsDb = (type == 'magnitude' || type == 'db');

  // Mirror web buildIntensityMapper (spectrogram.js:917-941): the only
  // non-linear modes are db-fixed / db-percentile, and a non-db type can never
  // use them. The web default is intensityMode "linear" (spectrogram.js:7).
  var mode = intensityMode.toLowerCase();
  if (mode != 'db-fixed' && mode != 'db-percentile') {
    mode = 'linear';
  }
  if (!allowsDb && mode != 'linear') {
    mode = 'linear';
  }

  // Web linear path (spectrogram.js:929-941): proportional v/inputValueMax for
  // EVERY intensity type, magnitude/db included. This is what keeps loud tones
  // calm (orange) instead of saturating them to yellow.
  if (mode == 'linear') {
    return (num v) => normalizeIntensity(v, inputValueMax: inputValueMax);
  }

  var minDb = dbMin.toDouble();
  var maxDb = dbMax.toDouble();
  if (!minDb.isFinite) minDb = -95.0;
  if (!maxDb.isFinite || maxDb <= minDb) maxDb = minDb + 75.0;

  // db-percentile overrides the range with the 5th/99th percentiles of sampled
  // dB values (web spectrogram.js:961-981). db-fixed keeps dbMin/dbMax as-is.
  if (mode == 'db-percentile') {
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
      }
    } catch (_) {
      // ignore and fall back to defaults
    }
  }

  return (num v) {
    final db = _dbFromMagnitude(v);
    if (!db.isFinite) return 0.0;
    return clamp01((db - minDb) / (maxDb - minDb));
  };
}
