/// Colour maps ported from the web dashboard's `spectrogram.js`
/// (COLOR_MAP_STOPS). Every stop is [position 0..1, r 0..255, g 0..255,
/// b 0..255]. "sonic" is the Sonic Visualiser Sunset look and is the app
/// default (matching web defaults 2026-10-sonic).
library;

import 'dart:math' as math;

/// Default map name (matches web DEFAULT_COLOR_MAP = "sonic").
const String kDefaultColorMap = 'sonic';

class ColorStop {
  final double p;
  final int r;
  final int g;
  final int b;

  const ColorStop(this.p, this.r, this.g, this.b);
}

const List<ColorStop> _magma = [
  ColorStop(0.0, 0, 0, 4),
  ColorStop(0.16, 28, 16, 68),
  ColorStop(0.33, 79, 18, 123),
  ColorStop(0.5, 129, 37, 129),
  ColorStop(0.66, 181, 54, 122),
  ColorStop(0.83, 229, 80, 100),
  ColorStop(1.0, 252, 253, 191),
];

const List<ColorStop> _sunset = [
  ColorStop(0.0, 15, 16, 50),
  ColorStop(0.2, 45, 24, 105),
  ColorStop(0.4, 98, 33, 135),
  ColorStop(0.6, 170, 52, 112),
  ColorStop(0.8, 235, 96, 70),
  ColorStop(1.0, 255, 190, 92),
];

// Exact "Sunset" of Sonic Visualiser (ColourMapper.cpp): black -> blue ->
// red -> yellow. Also used by "sonic".
const List<ColorStop> _svsunset = [
  ColorStop(0.0, 0, 0, 0),
  ColorStop(0.24, 0, 0, 220),
  ColorStop(0.2775, 23, 0, 255),
  ColorStop(0.5556, 192, 0, 0),
  ColorStop(0.64, 243, 0, 0),
  ColorStop(0.6602, 255, 14, 0),
  ColorStop(1.0, 255, 255, 0),
];

const List<ColorStop> _green = [
  ColorStop(0.0, 0, 0, 0),
  ColorStop(0.25, 0, 42, 10),
  ColorStop(0.5, 0, 120, 30),
  ColorStop(0.72, 44, 200, 60),
  ColorStop(0.88, 180, 240, 80),
  ColorStop(1.0, 255, 255, 200),
];

const List<ColorStop> _viridis = [
  ColorStop(0.0, 68, 1, 84),
  ColorStop(0.125, 72, 40, 120),
  ColorStop(0.25, 62, 73, 137),
  ColorStop(0.375, 49, 104, 142),
  ColorStop(0.5, 38, 130, 142),
  ColorStop(0.625, 31, 158, 137),
  ColorStop(0.75, 53, 183, 121),
  ColorStop(0.875, 110, 206, 88),
  ColorStop(1.0, 253, 231, 37),
];

const List<ColorStop> _inferno = [
  ColorStop(0.0, 0, 0, 4),
  ColorStop(0.125, 27, 12, 65),
  ColorStop(0.25, 74, 12, 107),
  ColorStop(0.375, 120, 28, 109),
  ColorStop(0.5, 165, 44, 96),
  ColorStop(0.625, 207, 68, 70),
  ColorStop(0.75, 237, 105, 37),
  ColorStop(0.875, 251, 155, 6),
  ColorStop(1.0, 252, 255, 164),
];

const List<ColorStop> _turbo = [
  ColorStop(0.0, 48, 18, 59),
  ColorStop(0.13, 68, 84, 196),
  ColorStop(0.25, 68, 144, 254),
  ColorStop(0.38, 31, 200, 222),
  ColorStop(0.5, 41, 239, 162),
  ColorStop(0.63, 125, 255, 86),
  ColorStop(0.75, 193, 243, 52),
  ColorStop(0.85, 241, 202, 58),
  ColorStop(0.92, 254, 146, 42),
  ColorStop(0.97, 228, 70, 10),
  ColorStop(1.0, 160, 26, 3),
];

const List<ColorStop> _highgain = [
  ColorStop(0.0, 0, 0, 0),
  ColorStop(0.04, 26, 10, 80),
  ColorStop(0.1, 60, 30, 154),
  ColorStop(0.2, 30, 100, 220),
  ColorStop(0.32, 0, 180, 200),
  ColorStop(0.46, 60, 220, 100),
  ColorStop(0.62, 200, 240, 50),
  ColorStop(0.8, 255, 200, 50),
  ColorStop(1.0, 255, 255, 255),
];

const List<ColorStop> _cherry = [
  ColorStop(0.0, 0, 0, 0),
  ColorStop(0.3, 74, 0, 16),
  ColorStop(0.55, 176, 16, 42),
  ColorStop(0.8, 255, 90, 112),
  ColorStop(1.0, 255, 230, 234),
];

const List<ColorStop> _ice = [
  ColorStop(0.0, 0, 0, 0),
  ColorStop(0.3, 6, 42, 90),
  ColorStop(0.6, 30, 120, 200),
  ColorStop(0.85, 140, 210, 255),
  ColorStop(1.0, 255, 255, 255),
];

const List<ColorStop> _gray = [
  ColorStop(0.0, 0, 0, 0),
  ColorStop(1.0, 255, 255, 255),
];

const List<ColorStop> _cividis = [
  ColorStop(0.0, 0, 34, 78),
  ColorStop(0.25, 53, 69, 108),
  ColorStop(0.5, 124, 123, 120),
  ColorStop(0.75, 195, 179, 105),
  ColorStop(1.0, 254, 232, 56),
];

/// All selectable maps: key -> stops. "sonic" shares SV Sunset (web:
/// COLOR_MAP_STOPS.sonic = COLOR_MAP_STOPS.svsunset).
const Map<String, List<ColorStop>> kColorMaps = {
  'magma': _magma,
  'sunset': _sunset,
  'svsunset': _svsunset,
  'sonic': _svsunset,
  'green': _green,
  'viridis': _viridis,
  'inferno': _inferno,
  'turbo': _turbo,
  'highgain': _highgain,
  'cherry': _cherry,
  'ice': _ice,
  'gray': _gray,
  'cividis': _cividis,
};

/// Display labels for the picker.
const Map<String, String> kColorMapLabels = {
  'sonic': 'Sonic',
  'magma': 'Magma',
  'sunset': 'Sunset',
  'svsunset': 'SV Sunset',
  'viridis': 'Viridis',
  'inferno': 'Inferno',
  'turbo': 'Turbo',
  'highgain': 'High Gain',
  'green': 'أخضر',
  'cherry': 'Cherry',
  'ice': 'Ice',
  'gray': 'رمادي',
  'cividis': 'Cividis',
};

/// Pick order for the UI (default first).
const List<String> kColorMapOrder = [
  'sonic', 'magma', 'sunset', 'svsunset', 'viridis', 'inferno', 'turbo',
  'highgain', 'green', 'cherry', 'ice', 'gray', 'cividis',
];

/// Is this the Sonic drawing mode (peak-lines instead of filled columns)?
bool isSonicColorMap(String? name) =>
    (name ?? kDefaultColorMap).toLowerCase() == 'sonic';

List<ColorStop> colorMapStops(String? name) =>
    kColorMaps[(name ?? kDefaultColorMap).toLowerCase()] ??
    kColorMaps[kDefaultColorMap]!;

/// Builds a 256-entry palette LUT (0xAARRGGBB per byte) for [name] with the
/// given gamma — the same construction the web does for its 256-colour
/// palette texture. Cheap: only 256 interpolations per change.
List<int> buildPaletteLut(String? name, double gamma) {
  final stops = colorMapStops(name);
  final g = gamma > 0 ? gamma : 1.0;
  final lut = List<int>.filled(256, 0xFF000000);
  for (var i = 0; i < 256; i++) {
    final v = math.pow(i / 255.0, g).toDouble();
    lut[i] = colorFromStops(stops, v);
  }
  return lut;
}

/// Interpolates [stops] at position [v] (clamped 0..1) into 0xAARRGGBB.
int colorFromStops(List<ColorStop> stops, double v) {
  double vv = v.isNaN ? 0 : v;
  if (vv < 0) vv = 0;
  if (vv > 1) vv = 1;
  for (var i = 0; i < stops.length - 1; i++) {
    final a = stops[i];
    final b = stops[i + 1];
    if (vv >= a.p && vv <= b.p) {
      final denom = (b.p - a.p).abs() < 1e-9 ? 1.0 : (b.p - a.p);
      final t = (vv - a.p) / denom;
      final r = _lerp(a.r, b.r, t);
      final g = _lerp(a.g, b.g, t);
      final bl = _lerp(a.b, b.b, t);
      return (0xFF << 24) | (r << 16) | (g << 8) | bl;
    }
  }
  final last = stops[stops.length - 1];
  return (0xFF << 24) | (last.r << 16) | (last.g << 8) | last.b;
}

int _lerp(int a, int b, double t) {
  final v = a + (b - a) * t;
  final r = v.round();
  if (r < 0) return 0;
  if (r > 255) return 255;
  return r;
}

// ---------------------------------------------------------------------------
// [noise-level] Web effectiveGamma = gamma * (1 - 0.65 * noiseRelease), where
// noiseRelease = clamp(round(noiseLevel) / 10, 0, 1). The weak values are
// lifted in the colour table only (strong lines unchanged) — costs nothing
// per pixel, only the 256-colour palette changes.
// ---------------------------------------------------------------------------

/// Web `noiseRelease()`: 0..1 share of the noise filter that is released.
double noiseReleaseOf(num noiseLevel) {
  final level = noiseLevel.round();
  if (level <= 0) return 0;
  if (level >= 10) return 1;
  return level / 10;
}

/// Web `effectiveGamma()`.
double effectiveGammaOf(num gamma, num noiseLevel) {
  var g = gamma.toDouble();
  if (!g.isFinite || g <= 0) g = 1.0;
  return g * (1 - 0.65 * noiseReleaseOf(noiseLevel));
}
