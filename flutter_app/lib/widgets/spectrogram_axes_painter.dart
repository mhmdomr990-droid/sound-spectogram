import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Draws frequency (Y) and time (X) axes around the spectrogram plot area,
/// matching the web dashboard layout.
class SpectrogramAxesPainter extends CustomPainter {
  final int rowCount;
  final int colCount;
  final List<double>? frequencyBins;
  final DateTime? startTime;
  final DateTime? endTime;

  static const Color axisColor = Color(0xFFCFD7E6);
  static const Color textColor = Color(0xFFD8E2FF);
  static const Color gridColor = Color(0x29CFD7E6);
  static const Color bgColor = Color(0xFF140D28);

  SpectrogramAxesPainter({
    required this.rowCount,
    required this.colCount,
    this.frequencyBins,
    this.startTime,
    this.endTime,
  });

  @override
  void paint(Canvas canvas, Size size) {
    const left = 32.0;
    const imageTop = 16.0;
    final plotW = math.max(10.0, size.width - left - 2);
    final plotH = math.max(10.0, size.height - imageTop - 24);
    final plotBottom = imageTop + plotH;
    final plotRight = left + plotW;

    // --- Grid lines ---
    final gridPaint = Paint()
      ..color = gridColor
      ..strokeWidth = 1;

    final xTicks = _chooseTicks(plotW, 4, 8);
    for (var tx = 0; tx <= xTicks; tx++) {
      final xFrac = tx / xTicks;
      final x = left + (xFrac * plotW).roundToDouble();
      canvas.drawLine(Offset(x, imageTop), Offset(x, plotBottom), gridPaint);
    }

    const yTicks = 5;
    for (var ty = 0; ty <= yTicks; ty++) {
      final yFrac = ty / yTicks;
      final y = imageTop + (yFrac * plotH).roundToDouble();
      canvas.drawLine(Offset(left, y), Offset(plotRight, y), gridPaint);
    }

    // --- L-shaped axis border ---
    final borderPaint = Paint()
      ..color = axisColor
      ..strokeWidth = 1.2
      ..style = PaintingStyle.stroke;
    final borderPath = Path()
      ..moveTo(left, imageTop)
      ..lineTo(left, plotBottom)
      ..lineTo(plotRight, plotBottom);
    canvas.drawPath(borderPath, borderPaint);

    // --- Y-axis: frequency labels ---
    final freqLabelPainter = TextPainter(textDirection: TextDirection.rtl);
    for (var ly = 0; ly <= yTicks; ly++) {
      final yFrac = ly / yTicks;
      final yPos = imageTop + (yFrac * plotH).roundToDouble();
      final label = _freqLabel(yFrac);
      freqLabelPainter
        ..text = TextSpan(
          text: label,
          style: const TextStyle(
            color: textColor,
            fontSize: 8,
            fontFamily: 'sans-serif',
          ),
        )
        ..layout();
      freqLabelPainter.paint(
        canvas,
        Offset(left - 2 - freqLabelPainter.width, yPos - freqLabelPainter.height / 2),
      );
    }

    // --- Y-axis title (rotated) ---
    canvas.save();
    canvas.translate(6, imageTop + plotH / 2);
    canvas.rotate(-math.pi / 2);
    final hasFreq = frequencyBins != null && frequencyBins!.isNotEmpty;
    final yTitlePainter = TextPainter(textDirection: TextDirection.rtl)
      ..text = TextSpan(
        text: hasFreq ? 'التردد (Hz)' : 'نطاقات التردد',
        style: const TextStyle(
          color: textColor,
          fontSize: 10,
          fontFamily: 'sans-serif',
        ),
      )
      ..layout();
    yTitlePainter.paint(canvas, Offset(-yTitlePainter.width / 2, -yTitlePainter.height / 2));
    canvas.restore();

    // --- X-axis: time labels ---
    final withDate = _totalRangeMs() > 24 * 60 * 60 * 1000;
    final timeLabelPainter = TextPainter(textDirection: TextDirection.ltr);
    for (var lx = 0; lx <= xTicks; lx++) {
      final lf = lx / xTicks;
      final labelMs = _startMs() + lf * _totalRangeMs();
      final labelX = left + (lf * plotW).roundToDouble();
      final label = _formatTime(labelMs, withDate);
      timeLabelPainter
        ..text = TextSpan(
          text: label,
          style: const TextStyle(
            color: textColor,
            fontSize: 8,
            fontFamily: 'sans-serif',
          ),
        )
        ..layout();
      timeLabelPainter.paint(
        canvas,
        Offset(labelX - timeLabelPainter.width / 2, plotBottom + 2),
      );
    }

    // --- X-axis title ---
    final xTitlePainter = TextPainter(textDirection: TextDirection.ltr)
      ..text = const TextSpan(
        text: 'الزمن',
        style: TextStyle(
          color: axisColor,
          fontSize: 7,
          fontFamily: 'sans-serif',
        ),
      )
      ..layout();
    xTitlePainter.paint(
      canvas,
      Offset(left + plotW / 2 - xTitlePainter.width / 2, plotBottom + 14),
    );
  }

  int _chooseTicks(double widthPx, int minTicks, int maxTicks) {
    final byWidth = (widthPx / 120).floor();
    return math.max(minTicks, math.min(maxTicks, byWidth)).toInt();
  }

  String _freqLabel(double yFrac) {
    final bins = frequencyBins;
    if (bins != null && bins.isNotEmpty) {
      // Top of spectrogram = high frequency, bottom = low frequency
      final rowIdx = (yFrac * (bins.length - 1)).round().clamp(0, bins.length - 1);
      final hz = bins[rowIdx];
      return '${hz.round()}';
    }
    // Fallback: assume 0-24000 Hz range
    final maxFreq = 24000.0;
    final minFreq = 0.0;
    final hz = maxFreq - yFrac * (maxFreq - minFreq);
    return '${hz.round()} Hz';
  }

  double _startMs() {
    final st = startTime;
    if (st != null) return st.millisecondsSinceEpoch.toDouble();
    return 0;
  }

  double _totalRangeMs() {
    final st = startTime;
    final et = endTime;
    if (st != null && et != null) {
      final ms = et.millisecondsSinceEpoch - st.millisecondsSinceEpoch;
      return ms > 0 ? ms.toDouble() : 1;
    }
    return 1;
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
  bool shouldRepaint(covariant SpectrogramAxesPainter oldDelegate) {
    return oldDelegate.rowCount != rowCount ||
        oldDelegate.colCount != colCount ||
        oldDelegate.startTime != startTime ||
        oldDelegate.endTime != endTime;
  }
}
