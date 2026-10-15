import 'dart:convert';
import 'dart:typed_data';

import 'package:archive/archive.dart';

/// Shared ZLib inflater — avoids reallocation per packet.
final _sharedZLibDecoder = ZLibDecoder();

const List<int> _pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/// Decodes an 8-bit grayscale PNG (mode L, non-interlaced) into rows of pixel
/// values 0..255. Row 0 is the TOP row of the picture. CPU port of the
/// server's `decodeGrayPng` (src/utils/png-gray.ts). Returns null when the
/// bytes are not a usable 8-bit grayscale PNG.
List<List<double>>? decodeGrayPng(Uint8List png) {
  if (png.length < 33) return null;
  for (var i = 0; i < 8; i++) {
    if (png[i] != _pngSignature[i]) return null;
  }
  final ihdrLen = _u32(png, 8);
  if (ihdrLen != 13) return null;
  if (png[12] != 0x49 || png[13] != 0x48 || png[14] != 0x44 || png[15] != 0x52) {
    return null; // "IHDR"
  }
  final width = _u32(png, 16);
  final height = _u32(png, 20);
  final bitDepth = png[24];
  final colorType = png[25];
  final interlace = png[28];
  if (colorType != 0 || bitDepth != 8 || interlace != 0) return null;
  if (width <= 0 || height <= 0 || width * height > 50000000) return null;

  // Concatenate every IDAT chunk.
  final idat = BytesBuilder(copy: false);
  var pos = 8;
  while (pos + 8 <= png.length) {
    final len = _u32(png, pos);
    final typeStart = pos + 4;
    final isIdat = png[typeStart] == 0x49 &&
        png[typeStart + 1] == 0x44 &&
        png[typeStart + 2] == 0x41 &&
        png[typeStart + 3] == 0x54;
    final isIend = png[typeStart] == 0x49 &&
        png[typeStart + 1] == 0x45 &&
        png[typeStart + 2] == 0x4e &&
        png[typeStart + 3] == 0x44;
    final start = pos + 8;
    if (isIdat) {
      final end = start + len;
      if (end > png.length) return null;
      idat.add(Uint8List.sublistView(png, start, end));
    } else if (isIend) {
      break;
    }
    pos = start + len + 4;
    if (pos <= 8) break; // overflow guard
  }

  Uint8List raw;
  try {
    raw = Uint8List.fromList(_sharedZLibDecoder.decodeBytes(idat.takeBytes()));
  } catch (_) {
    return null;
  }

  final stride = width + 1;
  if (raw.length < stride * height) return null;

  // Unfilter each scanline (PNG filters 0-4) into a flat pixel buffer.
  final out = Uint8List(width * height);
  for (var y = 0; y < height; y++) {
    final filter = raw[y * stride];
    final src = y * stride + 1;
    final dst = y * width;
    final up = dst - width;
    for (var x = 0; x < width; x++) {
      final v = raw[src + x];
      final a = x > 0 ? out[dst + x - 1] : 0;
      final b = y > 0 ? out[up + x] : 0;
      int p;
      switch (filter) {
        case 0:
          p = v;
        case 1:
          p = v + a;
        case 2:
          p = v + b;
        case 3:
          p = v + ((a + b) >> 1);
        case 4:
          final c = x > 0 && y > 0 ? out[up + x - 1] : 0;
          final pa = (b - c).abs();
          final pb = (a - c).abs();
          final pc = (a + b - 2 * c).abs();
          p = v + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c));
        default:
          return null; // unknown filter
      }
      out[dst + x] = p & 255;
    }
  }

  return List<List<double>>.generate(height, (y) {
    final base = y * width;
    return List<double>.generate(width, (x) => out[base + x].toDouble());
  });
}

int _u32(Uint8List b, int i) =>
    (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3];

/// Decodes a `png-gray-v1` payload object (as broadcast/stored by the server):
/// {format, rows, cols, payload (base64 PNG), freqRange, freqScale, rowOrder}.
/// Returns the pixel rows (row 0 = top of picture, already reordered per
/// rowOrder) or null on failure.
List<List<double>>? decodePngGrayPayload(Map<String, dynamic> payload) {
  final raw = payload['payload'];
  if (raw is! String || raw.isEmpty) return null;
  final text = raw
      .replaceFirst(RegExp(r'^data:image/png;base64,', caseSensitive: false), '')
      .replaceAll(RegExp(r'\s+'), '');
  Uint8List bytes;
  try {
    bytes = base64Decode(text);
  } catch (_) {
    return null;
  }
  final rows = decodeGrayPng(bytes);
  if (rows == null) return null;
  if (payload['rowOrder'] == 'descending') {
    return rows.reversed.toList();
  }
  return rows;
}
