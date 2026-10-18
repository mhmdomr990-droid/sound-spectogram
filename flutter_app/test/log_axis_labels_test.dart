import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:spectro_phone/utils/log_axis.dart';

/// Device-style ready-made log picture: [n] rows evenly spaced on a log axis
/// over [lo]..[hi] Hz — the same bin centres the web decodePngPacket builds.
List<double> _logBins(double lo, double hi, int n) {
  final ratio = math.log(hi / lo);
  return [
    for (var k = 0; k < n; k++) lo * math.exp(ratio * (k + 0.5) / n),
  ];
}

void main() {
  test('analyzeRowScale: device log picture is "log", raw spectrum "linear"', () {
    // Ready-made picture — 1270 log-spaced rows 54..500 Hz (web comment).
    expect(analyzeRowScale(_logBins(54, 500, 1270)), 'log');
    // Raw linear spectrum 0..500 Hz.
    final linear = [for (var i = 0; i <= 512; i++) 500.0 * i / 512];
    expect(analyzeRowScale(linear), 'linear');
    // Linear bins > 0 Hz are still "linear" (log deviation too large).
    final linearPos = [for (var i = 0; i <= 512; i++) 54.0 + (500.0 - 54) * i / 512];
    expect(analyzeRowScale(linearPos), 'linear');
    // Degenerate inputs.
    expect(analyzeRowScale(const [54]), 'linear');
    expect(analyzeRowScale(const [54, 500]), 'linear');
  });

  test('pureLog10Axis: position round-trip and identity warp semantics', () {
    final axis = pureLog10Axis(54, 500);
    expect(axis.pureLog10, isTrue);
    expect(axis.topLinear, isTrue, reason: 'a warp with this axis must not stretch');
    expect(frequencyToPosition(axis, 54), 0);
    expect(frequencyToPosition(axis, 500), closeTo(1, 1e-9));
    // Midpoint on a log axis is the geometric mean.
    expect(frequencyToPosition(axis, math.sqrt(54 * 500)), closeTo(0.5, 1e-9));
    for (final f in const [54.0, 100.0, 200.0, 375.0, 500.0]) {
      final p = frequencyToPosition(axis, f);
      expect(positionToFrequency(axis, p), closeTo(f, 1e-6));
    }
  });

  test('adaptive log10 labels reproduce the web sequence for 54..500 Hz', () {
    final axis = pureLog10Axis(54, 500);
    final values = adaptiveLog10LabelValues(
      minHz: axis.minHz,
      maxHz: axis.maxHz,
      plotHeight: 800,
      positionOf: (hz) => frequencyToPosition(axis, hz),
    );
    // Web screenshot numbering: minHz, then adaptive round steps, maxHz last.
    expect(values.map((v) => v.round()).toList(), [
      54, 60, 70, 80, 90, 100, 110, 120, 140, 160, 180, 200, 220, 250, 300,
      350, 400, 450, 500,
    ]);
  });

  test('adaptive log10 labels: short axes stay readable', () {
    final axis = pureLog10Axis(54, 500);
    final values = adaptiveLog10LabelValues(
      minHz: axis.minHz,
      maxHz: axis.maxHz,
      plotHeight: 60,
      positionOf: (hz) => frequencyToPosition(axis, hz),
    );
    expect(values.first, 54);
    expect(values.last, 500);
    expect(values.length, lessThanOrEqualTo(6));
  });
}
