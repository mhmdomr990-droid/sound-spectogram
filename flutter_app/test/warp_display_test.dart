import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:spectro_phone/utils/log_axis.dart';

void main() {
  test('warp at display resolution keeps content visible', () {
    const w = 888;
    const h = 922;
    final plane = Uint8List(w * h);
    for (var y = 0; y < h; y++) {
      plane.fillRange(y * w, (y + 1) * w, (y * 255) ~/ h);
    }
    final axis = buildLogAxis(0, 500, 200);
    final out = warpSpectrogramIntensity(plane, w, h, axis);
    expect(out.length, w * h);
    var sum = 0;
    var nonzero = 0;
    for (final b in out) {
      sum += b;
      if (b > 0) nonzero++;
    }
    final avg = sum / (w * h);
    final gTop = out[w ~/ 2];
    final gBottom = out[(h - 1) * w + (w ~/ 2)];
    // ignore: avoid_print
    print('avg=$avg nonzero=$nonzero/${w * h} gTop=$gTop gBottom=$gBottom');
    // Vertical-only warp of a y-gradient: intensity values must survive and
    // the full range must still be present (no black screen).
    expect(nonzero, greaterThan(w * h ~/ 2));
    expect(avg, greaterThan(90));
    expect(gBottom, greaterThan(200));
    expect(gTop, lessThan(50));
  });
}
