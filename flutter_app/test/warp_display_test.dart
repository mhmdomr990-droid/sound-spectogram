import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:spectro_phone/utils/log_axis.dart';

void main() {
  test('warp at display resolution keeps content visible', () {
    const w = 888;
    const h = 922;
    final plane = Uint8List(w * h * 4);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        final i = (y * w + x) * 4;
        plane[i] = (x * 255) ~/ w;
        plane[i + 1] = (y * 255) ~/ h;
        plane[i + 2] = 40;
        plane[i + 3] = 255;
      }
    }
    final axis = buildLogAxis(0, 500, 200);
    final out = warpSpectrogramVertical(plane, w, h, axis);
    expect(out.length, w * h * 4);
    var sum = 0;
    var alphaBad = 0;
    var nonzero = 0;
    for (var i = 0; i < out.length; i += 4) {
      if (out[i + 3] != 255) alphaBad++;
      final s = out[i] + out[i + 1] + out[i + 2];
      sum += s;
      if (s > 0) nonzero++;
    }
    final avg = sum / (w * h * 3);
    // Vertical-only warp: R (x-gradient) and B are preserved; G (y-gradient)
    // must still span the full range, so the output average stays high.
    // ignore: avoid_print
    print('avg=$avg alphaBad=$alphaBad nonzero=$nonzero/${w * h}');
    final gTop = out[(0 * w + (w ~/ 2)) * 4 + 1];
    final gBottom = out[((h - 1) * w + (w ~/ 2)) * 4 + 1];
    // ignore: avoid_print
    print('gTop=$gTop gBottom=$gBottom');
    expect(alphaBad, 0);
    expect(avg, greaterThan(90));
    expect(gBottom, greaterThan(200));
    expect(gTop, lessThan(50));
  });
}
