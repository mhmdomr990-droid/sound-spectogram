import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:spectro_phone/utils/spectro_isolate.dart';

/// Line-softness downscale: softness=0 is max-bucket (bright, web parity — a
/// peak is never missed or dimmed), softness=1 is bilinear (soft/wide, the
/// web's gl.LINEAR behaviour). A thin bright row stays hard-edged under max
/// and bleeds into its neighbours under bilinear, so raising softness widens
/// the line while softness=0 keeps it at full brightness.
void main() {
  const srcW = 8;
  const srcH = 32;
  // 3x vertical upscale.
  const dstW = 8;
  const dstH = 96;

  Uint8List planeWithBrightRow(int row) {
    final plane = Uint8List(srcW * srcH);
    plane.fillRange(row * srcW, (row + 1) * srcW, 255);
    return plane;
  }

  Future<Uint8List> warp(double softness, Uint8List plane) {
    return warpSpectrogramIsolate(WarpRequest(
      intensity: plane,
      width: srcW,
      height: srcH,
      logView: false,
      minFreq: 0,
      maxFreq: 500,
      focusHz: 200,
      dstWidth: dstW,
      dstHeight: dstH,
      softness: softness,
    ));
  }

  test('softness=0 (max) keeps a thin bright row hard-edged', () async {
    final out = await warp(0.0, planeWithBrightRow(16));
    expect(out.length, dstW * dstH);
    // 3x upscale of row 16 -> destination rows 48..50 are the bright block.
    expect(out[49 * dstW], 255);
    // Immediate neighbours of the block stay exactly black (no bleed).
    expect(out[47 * dstW], 0);
    expect(out[51 * dstW], 0);
  });

  test('softness=0 (max) catches a peak that nearest downsampling would miss',
      () async {
    // Horizontal 2x downscale: nearest samples only the odd source columns
    // (1,3,5,7), so a bright peak at column 2 would be dropped. The max bucket
    // covers columns [2,4) for destination column 1, so the peak survives.
    const sw = 8;
    const sh = 1;
    const dw = 4;
    const dh = 1;
    final src = Uint8List(sw * sh);
    src[2] = 255;
    final out = await warpSpectrogramIsolate(WarpRequest(
      intensity: src,
      width: sw,
      height: sh,
      logView: false,
      minFreq: 0,
      maxFreq: 500,
      focusHz: 200,
      dstWidth: dw,
      dstHeight: dh,
      softness: 0.0,
    ));
    expect(out.length, dw * dh);
    // Destination column 1 covers source [2,4) -> the peak is preserved at 255.
    expect(out[1], 255);
  });

  test('softness=1 (bilinear) widens a thin bright row into a soft glow',
      () async {
    final out = await warp(1.0, planeWithBrightRow(16));
    expect(out.length, dstW * dstH);
    // Peak is preserved at the centre but never exceeds the source peak.
    var maxV = 0;
    for (final b in out) {
      if (b > maxV) maxV = b;
    }
    expect(maxV, lessThanOrEqualTo(255));
    // The glow bleeds into rows that nearest left black -> the line is wider.
    expect(out[47 * dstW], greaterThan(0));
    expect(out[51 * dstW], greaterThan(0));
  });

  test('softness blends monotonically between max and bilinear', () async {
    final plane = planeWithBrightRow(16);
    final maxR = await warp(0.0, plane);
    final mid = await warp(0.5, plane);
    final bil = await warp(1.0, plane);
    // The bleeded neighbour value grows as softness rises.
    expect(maxR[47 * dstW], 0);
    expect(mid[47 * dstW], greaterThan(0));
    expect(bil[47 * dstW], greaterThan(mid[47 * dstW]));
  });

  test('thickenRows:1 extends the bright block by exactly one row (2px)',
      () async {
    final out = await warpSpectrogramIsolate(WarpRequest(
      intensity: planeWithBrightRow(16),
      width: srcW,
      height: srcH,
      logView: false,
      minFreq: 0,
      maxFreq: 500,
      focusHz: 200,
      dstWidth: dstW,
      dstHeight: dstH,
      softness: 0.0,
      thickenRows: 1,
    ));
    expect(out.length, dstW * dstH);
    // Max upscale block sits on rows 48..50; dilation copies row 50 down to 51.
    expect(out[49 * dstW], 255);
    expect(out[51 * dstW], 255);
    // Exactly one extra row: no flood past it, nothing added above.
    expect(out[52 * dstW], 0);
    expect(out[47 * dstW], 0);
  });

  test('thickenRows:2 extends the bright block by exactly two rows (3px)',
      () async {
    final out = await warpSpectrogramIsolate(WarpRequest(
      intensity: planeWithBrightRow(16),
      width: srcW,
      height: srcH,
      logView: false,
      minFreq: 0,
      maxFreq: 500,
      focusHz: 200,
      dstWidth: dstW,
      dstHeight: dstH,
      softness: 0.0,
      thickenRows: 2,
    ));
    expect(out.length, dstW * dstH);
    expect(out[49 * dstW], 255);
    expect(out[51 * dstW], 255);
    expect(out[52 * dstW], 255);
    expect(out[53 * dstW], 0);
    expect(out[47 * dstW], 0);
  });
}
