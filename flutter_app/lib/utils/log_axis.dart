import 'dart:math' as math;
import 'dart:typed_data';

/// Focus + logarithmic frequency axis — direct port of the web dashboard's
/// `log-spectrogram.js` (FOCUS_SHARE / solveLogScale / buildAxis) and of the
/// peak-preserving vertical warp fragment shader, plus the candidate tick
/// values from `log-frequency-labels.js`.
///
/// Axis definition (bottom = low frequency, top = high frequency, same as the
/// linear view):
///   - From min frequency up to the FOCUS frequency the axis is LINEAR and
///     takes [kLogFocusShare] of the plot height.
///   - Above the focus the axis is LOGARITHMIC, compressed into the remaining
///     height with a slope-matched curve (or plain linear fallback when no
///     compression is possible with the chosen focus).
class LogAxis {
  final double minHz;
  final double maxHz;
  final double focusHz;
  final double share;
  final double k2;
  final double dHz;
  final bool topLinear;

  /// focusFrac = (focusHz - minHz) / range, precomputed for the warp.
  final double focusFrac;

  /// k2 / range, precomputed for the warp.
  final double k2Frac;

  /// log(1 + dHz / k2), precomputed for the warp.
  final double logD;

  const LogAxis({
    required this.minHz,
    required this.maxHz,
    required this.focusHz,
    required this.share,
    required this.k2,
    required this.dHz,
    required this.topLinear,
    required this.focusFrac,
    required this.k2Frac,
    required this.logD,
  });

  @override
  bool operator ==(Object other) =>
      other is LogAxis &&
      other.minHz == minHz &&
      other.maxHz == maxHz &&
      other.focusHz == focusHz &&
      other.share == share &&
      other.k2 == k2 &&
      other.dHz == dHz &&
      other.topLinear == topLinear;

  @override
  int get hashCode => Object.hash(minHz, maxHz, focusHz, share, k2, dHz, topLinear);
}

/// FOCUS_SHARE of the plot height is dedicated to min..focus (matches web).
const double kLogFocusShare = 0.75;

/// Default focus frequency (matches web DEFAULT_FOCUS_HZ).
const double kLogDefaultFocusHz = 200.0;

/// Candidate tick values (matches web CANDIDATE_VALUES in
/// log-frequency-labels.js).
const List<double> kLogLabelCandidates = [
  0, 10, 20, 50, 75, 100, 125, 150, 175, 200, 250, 300, 400, 500, 600, 800,
  1000, 1500, 2000, 3000, 4000, 5000, 8000, 10000, 20000,
];

/// Solve k * ln(1 + D / k) = C for k (the function is increasing in k).
/// Matches web solveLogScale.
double solveLogScale(double dHz, double target) {
  var lo = 1e-6;
  var hi = 1e9;
  for (var i = 0; i < 80; i++) {
    final mid = math.sqrt(lo * hi);
    final value = mid * math.log(1 + dHz / mid);
    if (value < target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return math.sqrt(lo * hi);
}

/// Build the axis for a min..max frequency view with the given focus.
/// Matches web buildAxis (including the 5%..90% focus clamp and the
/// plain-linear fallback when compression is impossible).
LogAxis buildLogAxis(double minHz, double maxHz, double focusHz) {
  var min = minHz;
  var max = maxHz;
  if (!(max > min)) {
    max = min + 1;
  }
  final range = max - min;
  final clampedFocus =
      focusHz.clamp(min + range * 0.05, min + range * 0.9).toDouble();
  final lowSpan = clampedFocus - min;
  final dHz = max - clampedFocus;
  var share = kLogFocusShare;
  final target = ((1 - share) / share) * lowSpan;
  var topLinear = false;
  var k2 = 1.0;

  if (target >= dHz * 0.999) {
    // No compression is possible with this focus: plain linear axis.
    topLinear = true;
    share = lowSpan / range;
  } else {
    k2 = solveLogScale(dHz, target);
  }

  final focusFrac = lowSpan / range;
  return LogAxis(
    minHz: min,
    maxHz: max,
    focusHz: clampedFocus,
    share: share,
    k2: k2,
    dHz: dHz,
    topLinear: topLinear,
    focusFrac: focusFrac,
    k2Frac: k2 / range,
    logD: topLinear ? 0.0 : math.log(1 + dHz / k2),
  );
}

/// Frequency -> 0..1 position measured from the LOW-frequency edge of the plot.
/// Matches web frequencyToPosition.
double frequencyToPosition(LogAxis axis, double frequency) {
  final f = frequency.clamp(axis.minHz, axis.maxHz).toDouble();
  double position;
  if (f <= axis.focusHz) {
    position = axis.share * ((f - axis.minHz) / (axis.focusHz - axis.minHz));
  } else if (axis.topLinear) {
    position =
        axis.share + (1 - axis.share) * ((f - axis.focusHz) / axis.dHz);
  } else {
    position = axis.share +
        (1 - axis.share) *
            (math.log(1 + (f - axis.focusHz) / axis.k2) /
                math.log(1 + axis.dHz / axis.k2));
  }
  return position.clamp(0.0, 1.0).toDouble();
}

/// Inverse of [frequencyToPosition]: 0..1 position measured from the
/// LOW-frequency edge -> frequency in Hz. Matches web positionToFrequency.
double positionToFrequency(LogAxis axis, double position) {
  final p = position.clamp(0.0, 1.0).toDouble();
  if (p <= axis.share) {
    return axis.minHz + (p / axis.share) * (axis.focusHz - axis.minHz);
  }
  final u = (p - axis.share) / (1 - axis.share);
  if (axis.topLinear) {
    return axis.focusHz + u * axis.dHz;
  }
  return axis.focusHz +
      axis.k2 * (math.exp(u * axis.logD) - 1.0);
}

/// Source position (0..1 measured from the LOW-frequency edge) for a
/// destination position `d` (also from the low edge). Mirrors the shader's
/// `srcFromLowAt`.
double _srcFromLowAt(LogAxis axis, double d) {
  if (d <= axis.share) {
    return (d / axis.share) * axis.focusFrac;
  }
  final u = (d - axis.share) / (1 - axis.share);
  if (axis.topLinear) {
    return axis.focusFrac + u * (1 - axis.focusFrac);
  }
  return axis.focusFrac + axis.k2Frac * (math.exp(u * axis.logD) - 1.0);
}

/// Peak-preserving vertical warp — CPU port of the web GL fragment shader.
///
/// Re-maps ONLY the image vertically: for every destination row the source
/// span [ya, yb] is sampled (center + up to 12 evenly spaced samples) and the
/// sample with the highest luma wins, so compressed signals are never
/// averaged away. Image row 0 is the TOP of the picture (= highest frequency,
/// matching `LOW_FREQUENCY_AT_TOP = false`).
Uint8List warpSpectrogramVertical(
    Uint8List rgba, int width, int height, LogAxis axis) {
  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) {
    return rgba;
  }
  final w = width;
  final h = height;

  // Source row (in pixels, from the top) for a destination pixel edge/center.
  double mapRow(double vy) {
    final t = (vy / h).clamp(0.0, 1.0).toDouble();
    final destFromLow = 1.0 - t;
    final srcFromLow = _srcFromLowAt(axis, destFromLow).clamp(0.0, 1.0);
    // lowAtTop = false -> source measured from the top = 1 - srcFromLow.
    return (1.0 - srcFromLow) * h;
  }

  final out = Uint8List(rgba.length);
  final sampleRows = <int>[];

  for (var y = 0; y < h; y++) {
    final ya = mapRow(y.toDouble());
    final yb = mapRow((y + 1).toDouble());
    final yc = mapRow(y + 0.5);

    sampleRows.clear();
    final lo = ya < yb ? ya : yb;
    final hi = ya < yb ? yb : ya;
    final startRow = lo.floor().clamp(0, h - 1);
    final endRow = hi.ceil().clamp(0, h - 1);
    if (endRow - startRow <= 12) {
      // Cover every source row the destination row maps onto, so the peak
      // (brightest row) is never skipped.
      for (var r = startRow; r <= endRow; r++) {
        if (!sampleRows.contains(r)) sampleRows.add(r);
      }
    } else {
      // Wide spans: the shader's 12 evenly spaced samples + both edges.
      if (!sampleRows.contains(startRow)) sampleRows.add(startRow);
      if (!sampleRows.contains(endRow)) sampleRows.add(endRow);
      final centerRow = yc.round().clamp(0, h - 1);
      if (!sampleRows.contains(centerRow)) sampleRows.add(centerRow);
      for (var i = 0; i < 12; i++) {
        final f = (i + 0.5) / 12.0;
        final row = (lo + (hi - lo) * f).round().clamp(0, h - 1);
        if (!sampleRows.contains(row)) sampleRows.add(row);
      }
    }

    final destRowBase = y * w * 4;
    if (sampleRows.length == 1) {
      // Expansion region: direct row copy.
      final srcBase = sampleRows.first * w * 4;
      out.setRange(destRowBase, destRowBase + w * 4, rgba, srcBase);
      continue;
    }

    for (var x = 0; x < w; x++) {
      var bestLuma = -1;
      var bestOff = sampleRows.first * w * 4 + x * 4;
      for (var s = 0; s < sampleRows.length; s++) {
        final off = sampleRows[s] * w * 4 + x * 4;
        final luma = 299 * rgba[off] + 587 * rgba[off + 1] + 114 * rgba[off + 2];
        if (luma > bestLuma) {
          bestLuma = luma;
          bestOff = off;
        }
      }
      final dst = destRowBase + x * 4;
      out[dst] = rgba[bestOff];
      out[dst + 1] = rgba[bestOff + 1];
      out[dst + 2] = rgba[bestOff + 2];
      out[dst + 3] = rgba[bestOff + 3];
    }
  }

  return out;
}
