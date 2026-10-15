import 'package:flutter_test/flutter_test.dart';
import 'package:spectro_phone/utils/colormaps.dart';
import 'package:spectro_phone/utils/spectro.dart';

void main() {
  test('magma maps low intensity to first stop', () {
    final stops = colorMapStops('magma');
    final rgb = colorFromStops(stops, 0.0);
    expect([(rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF], [0, 0, 4]);
    expect(colorFromStops(stops, -1.0), colorFromStops(stops, 0.0));
  });

  test('magma maps high intensity to last stop', () {
    final stops = colorMapStops('magma');
    final rgb = colorFromStops(stops, 1.0);
    expect([(rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF], [252, 253, 191]);
    expect(colorFromStops(stops, 2.0), colorFromStops(stops, 1.0));
  });

  test('magma interpolates between stops', () {
    final stops = colorMapStops('magma');
    final rgb = colorFromStops(stops, 0.5);
    expect([(rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF], [129, 37, 129]);
  });

  test('gray maps black to white', () {
    final stops = colorMapStops('gray');
    expect(colorFromStops(stops, 0.0) & 0xFFFFFF, 0x000000);
    expect(colorFromStops(stops, 1.0) & 0xFFFFFF, 0xFFFFFF);
  });

  test('normalizeIntensity handles 0-255 and 0-1 ranges', () {
    expect(normalizeIntensity(0.5), 0.5);
    expect(normalizeIntensity(128), closeTo(128 / 255, 1e-9));
    expect(normalizeIntensity(300), 1.0);
  });

  test('effectiveGamma follows web formula', () {
    expect(effectiveGammaOf(1.0, 0), 1.0);
    expect(effectiveGammaOf(1.0, 10), closeTo(0.35, 1e-9));
    expect(effectiveGammaOf(2.0, 5), closeTo(2.0 * (1 - 0.65 * 0.5), 1e-9));
  });

  test('buildPaletteLut produces 256 opaque entries', () {
    final lut = buildPaletteLut('sonic', 1.0);
    expect(lut.length, 256);
    for (final c in lut) {
      expect((c >> 24) & 0xFF, 0xFF);
    }
  });

  test('sonic buildRgba returns taller sub-row plane', () {
    // 16 rows x 32 cols matrix with a clear peak row.
    final m = List.generate(16, (r) => List<num>.generate(32, (c) => r == 8 ? 200.0 : 10.0));
    final out = buildRgba(
      m,
      width: 32,
      height: 16,
      colorMap: 'sonic',
      dstHeight: 128, // sonicScale = 128/16 = 8
    );
    expect(out.height, 16 * 8);
    expect(out.intensity, isNotNull);
    // Peak row r=8 → y = (15-8)*8 + 3.5 ≈ 59..60 — must be non-zero there.
    final intensity = out.intensity!;
    var peakHit = 0;
    for (var y = 55; y <= 64; y++) {
      for (var x = 0; x < 32; x++) {
        if (intensity[y * 32 + x] > 0) peakHit++;
      }
    }
    expect(peakHit, greaterThan(0));
  });

  test('processSonicMatrix finds peaks in a clean matrix', () {
    final m = List.generate(32, (r) => List<num>.generate(40, (c) => r == 10 ? 220.0 : 5.0));
    final peaks = processSonicMatrix(m, intensityType: 'uint8');
    expect(peaks.rows, isNotEmpty);
    expect(peaks.rows.any((r) => (r - 10).abs() <= 1), isTrue);
  });
}
