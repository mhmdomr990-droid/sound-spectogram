import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Combined axes painter: freq labels (left), grid (center), time labels (bottom).
/// Drawn as an overlay on top of the image — it is transparent except for text/lines.
class SpectrogramAxesPainter extends CustomPainter {
  final int colCount;
  final List<double>? frequencyBins;
  final DateTime? startTime;
  final DateTime? endTime;

  static const Color axisColor = Color(0xFFCFD7E6);
  static const Color textColor = Color(0xFFD8E2FF);
  static const Color gridColor = Color(0x29CFD7E6);

  SpectrogramAxesPainter({
    required this.colCount,
    this.frequencyBins,
    this.startTime,
    this.endTime,
  });

  @override
  void paint(Canvas canvas, Size size) {
    const left = 32.0;
    const topPad = 0.0;
    const bottomPad = 20.0;
    final plotW = math.max(10.0, size.width - left - 2);
    final plotH = math.max(10.0, size.height - topPad - bottomPad);

    // --- Grid lines ---
    final gridPaint = Paint()..color = gridColor..strokeWidth = 1;
    final xTicks = _chooseTicks(plotW, 4, 8);
    for (var tx = 0; tx <= xTicks; tx++) {
      final x = left + (tx / xTicks * plotW).roundToDouble();
      canvas.drawLine(Offset(x, topPad), Offset(x, topPad + plotH), gridPaint);
    }
    const yTicks = 5;
    for (var ty = 0; ty <= yTicks; ty++) {
      final y = topPad + (ty / yTicks * plotH).roundToDouble();
      canvas.drawLine(Offset(left, y), Offset(left + plotW, y), gridPaint);
    }

    // --- L-shaped border ---
    final bp = Paint()..color = axisColor..strokeWidth = 1.2..style = PaintingStyle.stroke;
    final border = Path()
      ..moveTo(left, topPad)
      ..lineTo(left, topPad + plotH)
      ..lineTo(left + plotW, topPad + plotH);
    canvas.drawPath(border, bp);

    // --- Y-axis: freq labels (left of image) ---
    final freqTp = TextPainter(textDirection: TextDirection.rtl);
    for (var ly = 0; ly <= yTicks; ly++) {
      final yFrac = ly / yTicks;
      final yPos = topPad + (yFrac * plotH).roundToDouble();
      final label = _freqLabel(yFrac);
      freqTp
        ..text = TextSpan(
          text: label,
          style: const TextStyle(color: textColor, fontSize: 8, fontFamily: 'sans-serif'),
        )
        ..layout();
      freqTp.paint(canvas, Offset(left - 2 - freqTp.width, yPos - freqTp.height / 2));
    }

    // --- X-axis: time labels (below image) ---
    final st = startTime, et = endTime;
    final totalMs = (st != null && et != null)
        ? math.max(1, et.millisecondsSinceEpoch - st.millisecondsSinceEpoch).toDouble()
        : 1.0;
    final startMs = st?.millisecondsSinceEpoch.toDouble() ?? 0;
    final withDate = totalMs > 24 * 60 * 60 * 1000;

    final timeTp = TextPainter(textDirection: TextDirection.ltr);
    for (var lx = 0; lx <= xTicks; lx++) {
      final lf = lx / xTicks;
      final labelX = left + (lf * plotW).roundToDouble();
      timeTp
        ..text = TextSpan(
          text: _formatTime(startMs + lf * totalMs, withDate),
          style: const TextStyle(color: textColor, fontSize: 8, fontFamily: 'sans-serif'),
        )
        ..layout();
      timeTp.paint(canvas, Offset(labelX - timeTp.width / 2, topPad + plotH + 4));
    }

    // --- X-axis title ---
    final title = TextPainter(textDirection: TextDirection.ltr)
      ..text = const TextSpan(
        text: 'الزمن',
        style: TextStyle(color: axisColor, fontSize: 7, fontFamily: 'sans-serif'),
      )
      ..layout();
    title.paint(canvas, Offset(left + plotW / 2 - title.width / 2, topPad + plotH + 14));
  }

  int _chooseTicks(double widthPx, int minTicks, int maxTicks) {
    return math.max(minTicks, math.min(maxTicks, (widthPx / 120).floor())).toInt();
  }

  String _freqLabel(double yFrac) {
    final bins = frequencyBins;
    if (bins != null && bins.isNotEmpty) {
      final rowIdx = (yFrac * (bins.length - 1)).round().clamp(0, bins.length - 1);
      return '${bins[rowIdx].round()}';
    }
    return '${(24000 - yFrac * 24000).round()}';
  }

  String _formatTime(double ms, bool withDate) {
    final dt = DateTime.fromMillisecondsSinceEpoch(ms.round());
    final hh = dt.hour.toString().padLeft(2, '0');
    final mm = dt.minute.toString().padLeft(2, '0');
    if (withDate) {
      return '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')} $hh:$mm';
    }
    return '$hh:$mm';
  }

  @override
  bool shouldRepaint(covariant SpectrogramAxesPainter o) =>
      o.colCount != colCount ||
      o.frequencyBins != frequencyBins ||
      o.startTime != startTime ||
      o.endTime != endTime;
}
