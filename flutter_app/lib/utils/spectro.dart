import 'dart:math' as math;

/// Color map stops with explicit position values matching the web engine.
/// Format: `[p, r, g, b]` where `p` is in [0, 1] and rgb in 0..255.
///
/// These are the exact `COLOR_MAP_STOPS` from `src/public/js/spectrogram.js`.
final List<List<double>> kColorMapMagma = [
  [0.0, 0, 0, 4],
  [0.16, 28, 16, 68],
  [0.33, 79, 18, 123],
  [0.5, 129, 37, 129],
  [0.66, 181, 54, 122],
  [0.83, 229, 80, 100],
  [1.0, 252, 253, 191],
];

final List<List<double>> kColorMapSunset = [
  [0.0, 15, 16, 50],
  [0.2, 45, 24, 105],
  [0.4, 98, 33, 135],
  [0.6, 170, 52, 112],
  [0.8, 235, 96, 70],
  [1.0, 255, 190, 92],
];

final List<List<double>> kColorMapGrayscale = [
  [0.0, 0, 0, 0],
  [1.0, 255, 255, 255],
];

List<List<List<double>>> get kColorMaps => [kColorMapMagma, kColorMapSunset, kColorMapGrayscale];

List<String> get kColorMapNames => const ['Magma', 'Sunset', 'Grayscale'];

const double _kGamma = 1.0;

double clamp01(double v) => v < 0 ? 0 : (v > 1 ? 1 : v);

/// Matches the web `normalizeIntensity(value)`:
/// values <= 1 clamp directly; larger values are treated as 0-255 and scaled.
double normalizeIntensity(double value) {
  final n = value.isNaN || value.isInfinite ? 0.0 : value;
  if (n <= 1) {
    return clamp01(n);
  }
  return clamp01(n / 255.0);
}

/// Linearly interpolates a normalized intensity `value` (already in [0, 1])
/// against a color-map stop list, applying the gamma curve.
/// Returns `[r, g, b]` in 0..255, matching the web `valueToColor`.
List<int> colorMapToColor(List<List<double>> colorMap, double value) {
  final v = math.pow(clamp01(value), _kGamma).toDouble();

  if (colorMap.isEmpty) {
    return [0, 0, 0];
  }
  if (colorMap.length == 1) {
    return [colorMap[0][1].round(), colorMap[0][2].round(), colorMap[0][3].round()];
  }
  if (v <= colorMap.first[0]) {
    return [colorMap.first[1].round(), colorMap.first[2].round(), colorMap.first[3].round()];
  }
  if (v >= colorMap.last[0]) {
    return [colorMap.last[1].round(), colorMap.last[2].round(), colorMap.last[3].round()];
  }

  for (var i = 0; i < colorMap.length - 1; i++) {
    final a = colorMap[i];
    final b = colorMap[i + 1];
    if (v >= a[0] && v <= b[0]) {
      final span = b[0] - a[0];
      final t = span == 0 ? 0.0 : (v - a[0]) / span;
      return [
        _lerp(a[1], b[1], t).round(),
        _lerp(a[2], b[2], t).round(),
        _lerp(a[3], b[3], t).round(),
      ];
    }
  }

  return [0, 0, 0];
}

double _lerp(double a, double b, double t) => a + (b - a) * t;
