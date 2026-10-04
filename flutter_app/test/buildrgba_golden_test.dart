import 'dart:io';
import 'dart:math';
import 'package:flutter_test/flutter_test.dart';
import 'package:spectro_phone/utils/spectro.dart' as spectro;

String _goldenPath() =>
    '${Directory.current.path}/test/.golden_buildrgba';

String fnv1aHex(List<int> bytes) {
  var h = 0xcbf29ce484222325;
  for (final b in bytes) {
    h ^= b;
    h = (h * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF;
  }
  return h.toRadixString(16).padLeft(16, '0');
}

List<List<num>> makeMatrix(int rows, int cols, int seed, {double maxV = 255}) {
  final rnd = Random(seed);
  final m = List.generate(rows, (_) => List<num>.filled(cols, 0));
  for (var r = 0; r < rows; r++) {
    final band = (maxV * 0.3) + ((r * 13) % (maxV * 0.2));
    for (var c = 0; c < cols; c++) {
      final v = rnd.nextDouble() < 0.35
          ? band + rnd.nextDouble() * (maxV * 0.25)
          : rnd.nextDouble() * (maxV * 0.12);
      m[r][c] = v > maxV ? maxV : v;
    }
  }
  return m;
}

void main() {
  test('buildRgba golden hashes', () {
    final cases = <String, Map<String, Object?>>{
      'c1-uint8-on': {
        'm': makeMatrix(48, 200, 1),
        'width': 200,
        'height': 48,
        'intensityType': 'uint8',
      },
      'c2-iso-off': {
        'm': makeMatrix(48, 200, 2),
        'width': 200,
        'height': 48,
        'intensityType': 'uint8',
        'iso': false,
      },
      'c3-morph-off': {
        'm': makeMatrix(48, 200, 3),
        'width': 200,
        'height': 48,
        'intensityType': 'uint8',
        'morph': false,
      },
      'c4-magnitude-infer': {
        'm': makeMatrix(48, 200, 4, maxV: 800),
        'width': 200,
        'height': 48,
      },
      'c5-normalized': {
        'm': makeMatrix(48, 200, 5, maxV: 1),
        'width': 200,
        'height': 48,
        'intensityType': 'normalized',
      },
      'c6-db': {
        'm': makeMatrix(48, 200, 6, maxV: 1),
        'width': 200,
        'height': 48,
        'intensityType': 'db',
        'dbMin': -100,
        'dbMax': -10,
      },
      'c7-params-times': {
        'm': makeMatrix(256, 1500, 7),
        'width': 1024,
        'height': 256,
        'intensityType': 'uint8',
        'gamma': 1.6,
        'gainDb': 6.0,
        'noiseThreshold': 0.05,
        'neighborhoodSize': 5,
        'minActiveNeighbors': 2,
        'bg': 0xFF000000,
        'start': '2026-10-01T14:44:23.000Z',
        'end': '2026-10-01T14:58:23.000Z',
        'floorPct': 90,
      },
      'c8-medium-times': {
        'm': makeMatrix(513, 4096, 8),
        'width': 4096,
        'height': 513,
        'intensityType': 'uint8',
        'start': '2026-10-01T14:44:23.000Z',
        'end': '2026-10-01T14:58:23.000Z',
      },
      'c9-large': {
        'm': makeMatrix(513, 13132, 9),
        'width': 4096,
        'height': 513,
        'intensityType': 'uint8',
        'start': '2026-10-01T14:44:23.000Z',
        'end': '2026-10-01T14:58:23.000Z',
      },
      'c10-width888': {
        'm': makeMatrix(64, 800, 10),
        'width': 888,
        'height': 64,
        'intensityType': 'uint8',
      },
      'c11-noisezero': {
        'm': makeMatrix(64, 400, 11),
        'width': 400,
        'height': 64,
        'intensityType': 'uint8',
        'noiseThreshold': 0.0,
        'floorPct': 0,
        'iso': false,
        'morph': false,
      },
    };

    final results = <String, String>{};
    cases.forEach((label, cfg) {
      final out = spectro.buildRgba(
        cfg['m'] as List<List<num>>,
        width: cfg['width'] as int,
        height: cfg['height'] as int,
        gamma: (cfg['gamma'] as num?) ?? 1.0,
        noiseThreshold: (cfg['noiseThreshold'] as num?) ?? 0.0,
        noiseFloorPercentile: (cfg['floorPct'] as int?) ?? 72,
        isolatedPixelRemovalEnabled: (cfg['iso'] as bool?) ?? true,
        morphologyEnabled: (cfg['morph'] as bool?) ?? true,
        neighborhoodSize: (cfg['neighborhoodSize'] as int?) ?? 3,
        minActiveNeighbors: (cfg['minActiveNeighbors'] as int?) ?? 1,
        intensityType: cfg['intensityType'] as String?,
        dbMin: (cfg['dbMin'] as num?) ?? -95,
        dbMax: (cfg['dbMax'] as num?) ?? -20,
        gainDb: (cfg['gainDb'] as num?) ?? 0.0,
        backgroundColor: (cfg['bg'] as int?) ?? 0xFF111026,
        startTimeIso: cfg['start'] as String?,
        endTimeIso: cfg['end'] as String?,
      );
      final buf = <int>[];
      buf.addAll(out.rgba);
      buf.addAll([out.width & 0xFF, (out.width >> 8) & 0xFF]);
      buf.addAll([out.height & 0xFF, (out.height >> 8) & 0xFF]);
      results[label] = fnv1aHex(buf);
      // ignore: avoid_print
      print('GOLDEN $label ${results[label]}');
    });

    final path = _goldenPath();
    final file = File(path);
    if (!file.existsSync()) {
      final sb = StringBuffer();
      results.forEach((k, v) => sb.writeln('$k $v'));
      file.writeAsStringSync(sb.toString());
      // ignore: avoid_print
      print('GOLDEN_FILE_WRITTEN $path');
    } else {
      final existing = <String, String>{};
      for (final line in file.readAsLinesSync()) {
        final parts = line.trim().split(' ');
        if (parts.length == 2) existing[parts[0]] = parts[1];
      }
      results.forEach((k, v) {
        expect(existing[k], v, reason: 'golden mismatch for $k');
      });
      // ignore: avoid_print
      print('GOLDEN_FILE_MATCHED ${results.length} cases');
    }
  }, timeout: const Timeout(Duration(minutes: 5)));
}
