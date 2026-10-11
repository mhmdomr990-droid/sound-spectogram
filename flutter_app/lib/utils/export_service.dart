import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:get/get.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../models/device_history.dart';

/// PNG snapshot export: capture the framed spectrogram as-is, then share it
/// with a caption (device + date + range start/end times).
class ExportService {
  ExportService._();

  static void _snack(String message, {bool error = false}) {
    try {
      Get.snackbar(
        error ? 'خطأ' : 'تم',
        message,
        backgroundColor: error ? Colors.redAccent : const Color(0xDD222222),
        colorText: Colors.white,
        snackPosition: SnackPosition.BOTTOM,
        duration: const Duration(seconds: 3),
      );
    } catch (_) {}
  }

  static String _pad(int n) => n.toString().padLeft(2, '0');
  static String _stamp(DateTime t) =>
      '${t.year}${_pad(t.month)}${_pad(t.day)}_${_pad(t.hour)}${_pad(t.minute)}${_pad(t.second)}';
  static String _date(DateTime t) =>
      '${t.year}-${_pad(t.month)}-${_pad(t.day)}';
  static String _time(DateTime t) => '${_pad(t.hour)}:${_pad(t.minute)}';
  static String _human(DateTime t) => '${_date(t)} ${_time(t)}';

  /// Device + date + range start/end times.
  static String captionFor(
      String deviceName, List<DeviceHistory> histories, DateTime now) {
    DateTime? start;
    DateTime? end;
    for (final h in histories) {
      final s =
          (h.startTime != null ? DateTime.tryParse(h.startTime!) : null) ??
              DateTime.tryParse(h.timestamp);
      final e = h.endTime != null ? DateTime.tryParse(h.endTime!) : null;
      if (s != null && (start == null || s.isBefore(start))) start = s;
      if (e != null && (end == null || e.isAfter(end))) end = e;
    }
    if (start == null || end == null) {
      return '$deviceName — ${_human(now)}';
    }
    final sameDay = start.year == end.year &&
        start.month == end.month &&
        start.day == end.day;
    return sameDay
        ? '$deviceName — ${_date(start)} — ${_time(start)} → ${_time(end)}'
        : '$deviceName — ${_human(start)} → ${_human(end)}';
  }

  /// Captures [boundaryKey]'s current frame as-is (no overlay), saves PNG
  /// and opens the share sheet with a descriptive caption.
  static Future<void> exportPng(
    GlobalKey boundaryKey, {
    required double devicePixelRatio,
    required String deviceName,
    List<DeviceHistory> histories = const [],
  }) async {
    try {
      final boundary = boundaryKey.currentContext?.findRenderObject()
          as RenderRepaintBoundary?;
      if (boundary == null) {
        _snack('تعذّر تصدير اللقطة (الإطار غير جاهز)', error: true);
        return;
      }
      final captured = await boundary.toImage(pixelRatio: devicePixelRatio);
      final bytes = await captured.toByteData(format: ui.ImageByteFormat.png);
      captured.dispose();
      if (bytes == null) {
        _snack('تعذّر تحويل اللقطة إلى PNG', error: true);
        return;
      }

      final now = DateTime.now();
      final caption = captionFor(deviceName, histories, now);
      final dir = await getTemporaryDirectory();
      final file = File(
          '${dir.path}/spectrogram_${_sanitize(deviceName)}_${_stamp(now)}.png');
      await file.writeAsBytes(bytes.buffer.asUint8List());

      await SharePlus.instance.share(ShareParams(
        text: caption,
        files: [XFile(file.path, mimeType: 'image/png')],
      ));
      _snack('تم تجهيز اللقطة للمشاركة');
    } catch (e) {
      _snack('تعذّر التصدير: $e', error: true);
    }
  }

  static String _sanitize(String s) {
    final cleaned = s.replaceAll(RegExp(r'[^A-Za-z0-9\-]+'), '_');
    return cleaned.isEmpty ? 'device' : cleaned;
  }
}
