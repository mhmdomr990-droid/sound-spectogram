import 'package:flutter_test/flutter_test.dart';
import 'package:spectro_phone/utils/spectro.dart';

void main() {
  test('magma maps low intensity to first stop', () {
    expect(colorMapToColor(kColorMapMagma, 0.0), [0, 0, 4]);
    expect(colorMapToColor(kColorMapMagma, -1.0), [0, 0, 4]);
  });

  test('magma maps high intensity to last stop', () {
    expect(colorMapToColor(kColorMapMagma, 1.0), [252, 253, 191]);
    expect(colorMapToColor(kColorMapMagma, 2.0), [252, 253, 191]);
  });

  test('magma interpolates between stops', () {
    expect(colorMapToColor(kColorMapMagma, 0.5), [129, 37, 129]);
  });

  test('grayscale maps black to white', () {
    expect(colorMapToColor(kColorMapGrayscale, 0.0), [0, 0, 0]);
    expect(colorMapToColor(kColorMapGrayscale, 1.0), [255, 255, 255]);
  });

  test('normalizeIntensity handles 0-255 and 0-1 ranges', () {
    expect(normalizeIntensity(0.5), 0.5);
    expect(normalizeIntensity(128), closeTo(128 / 255, 1e-9));
    expect(normalizeIntensity(300), 1.0);
  });
}
