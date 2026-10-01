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

/// Blend weight of the brightest sample where the axis COMPRESSES several
/// source rows into one output pixel (web `PEAK_WEIGHT`): 0 = pure average
/// (cleanest background, dimmer thin lines), 1 = strongest sample only. 0.5 is
/// the web default.
const double kLogPeakWeight = 0.5;

/// Smooth blend used by the web shader to fade between plain sampling and the
/// pooled (average+peak) result over footprint 1..2 source pixels.
double _smoothstep(double edge0, double edge1, double x) {
  if (edge0 == edge1) return x < edge0 ? 0.0 : 1.0;
  var t = (x - edge0) / (edge1 - edge0);
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return t * t * (3.0 - 2.0 * t);
}

/// Vertical warp over the raw INTENSITY plane (0..255 per pixel) — CPU port of
/// the web GL fragment shader geometry (`log-spectrogram.js`), with all
/// sampling/pooling done on intensity so the gain LUT can be applied AFTER
/// the warp (gain changes then cost only a 0.8M-pixel lookup + decode).
///
/// The axis mapping matches the shader; sampling:
///  * Where the axis EXPANDS (footprint <= 1 source pixel) every destination
///    pixel is a plain bilinear sample of the source — exactly like the linear
///    view, so thin lines stay smooth instead of becoming hard bands.
///  * Where the axis COMPRESSES (footprint > 1) 12 evenly spaced bilinear
///    samples are pooled as `mix(average, brightest, kLogPeakWeight)` and
///    blended with the center sample by `smoothstep(1, 2, footprint)`, so
///    signals are never averaged away while the noise floor stays soft.
///
/// "Brightest" compares intensity directly — equivalent to the shader's luma
/// pick because the magma palette is luminance-monotonic.
///
/// Image row 0 is the TOP of the picture (= highest frequency, matching
/// `LOW_FREQUENCY_AT_TOP = false`). Sampling is clamped to the image edges
/// (web: `CLAMP_TO_EDGE` + `LINEAR` filtering).
Uint8List warpSpectrogramIntensity(
    Uint8List src, int width, int height, LogAxis axis) {
  if (width <= 0 || height <= 0 || src.length < width * height) {
    return src;
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

  final out = Uint8List(w * h);

  // Bilinear geometry for one sample position: two source rows + weight.
  // Reused for the center sample and the 12 compression taps.
  final row0 = Int32List(13);
  final row1 = Int32List(13);
  final rowT = Float64List(13);
  void setup(int i, double srcRow) {
    var a = srcRow.floor();
    if (a < 0) a = 0;
    if (a > h - 1) a = h - 1;
    var b = a + 1;
    if (b > h - 1) b = h - 1;
    var t = srcRow - a;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    row0[i] = a;
    row1[i] = b;
    rowT[i] = t;
  }

  for (var y = 0; y < h; y++) {
    final ya = mapRow(y.toDouble());
    final yb = mapRow((y + 1).toDouble());
    final yc = mapRow(y + 0.5);
    final footprint = (yb - ya).abs();
    final destRowBase = y * w;

    if (footprint <= 1.0) {
      // Web: footprintPx <= 1.0 -> plain smooth (bilinear) center sample.
      setup(12, yc);
      final a = row0[12] * w;
      final b = row1[12] * w;
      final t = rowT[12];
      if (t == 0.0) {
        // Integer source row — straight copy.
        out.setRange(destRowBase, destRowBase + w, src, a);
      } else {
        final inv = 1.0 - t;
        for (var x = 0; x < w; x++) {
          out[destRowBase + x] =
              _clamp255(src[a + x] * inv + src[b + x] * t);
        }
      }
      continue;
    }

    // Compression: 12 evenly spaced bilinear taps over [ya, yb] (web:
    // mix(ya, yb, (i + 0.5) / 12)) plus the bilinear center sample.
    for (var i = 0; i < 12; i++) {
      setup(i, ya + (yb - ya) * ((i + 0.5) / 12.0));
    }
    setup(12, yc);

    final c0 = row0[12] * w;
    final c1 = row1[12] * w;
    final ct = rowT[12];
    final cinv = 1.0 - ct;

    // Per-row constant (footprint does not depend on x).
    final wBlend = _smoothstep(1.0, 2.0, footprint);
    final peak = kLogPeakWeight;
    const invPeak = 1.0 - kLogPeakWeight;

    for (var x = 0; x < w; x++) {
      // Center sample (bilinear).
      final center = src[c0 + x] * cinv + src[c1 + x] * ct;

      // Pool: sum of the 12 taps (average) and the brightest sample, with the
      // center as the initial `best` — exactly like the shader.
      var sum = 0.0;
      var best = center;
      for (var i = 0; i < 12; i++) {
        final v = src[row0[i] * w + x] * (1.0 - rowT[i]) +
            src[row1[i] * w + x] * rowT[i];
        sum += v;
        if (v > best) best = v;
      }

      // pooled = mix(sum / 12, best, PEAK_WEIGHT)
      final pooled = (sum / 12.0) * invPeak + best * peak;
      // out = mix(center, pooled, smoothstep(1, 2, footprint))
      out[destRowBase + x] = _clamp255(center + (pooled - center) * wBlend);
    }
  }

  return out;
}

int _clamp255(double v) {
  final r = v.round();
  if (r < 0) return 0;
  if (r > 255) return 255;
  return r;
}
