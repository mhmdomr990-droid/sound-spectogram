import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../models/device_history.dart';
import '../utils/spectro.dart';
import '../utils/spectro_isolate.dart';
import 'spectrogram_axes_painter.dart';

/// Displays a batch of history packets as a scrollable spectrogram image.
///
/// Packets are normalized to [0, 1], truncated vertically to a shared row
/// (frequency) count, and concatenated left-to-right along the time axis so
/// that a multi-packet time range renders like the web dashboard.
class SpectrogramCanvas extends StatefulWidget {
  final List<DeviceHistory> histories;
  final List<List<double>>? colorMap;
  final double gainDb;
  final double noiseThreshold;
  final int? width;
  final int? height;

  const SpectrogramCanvas({
    super.key,
    this.histories = const [],
    this.colorMap,
    this.gainDb = 0.0,
    this.noiseThreshold = 0.06,
    this.width,
    this.height,
  });

  @override
  State<SpectrogramCanvas> createState() => SpectrogramCanvasState();
}

class SpectrogramCanvasState extends State<SpectrogramCanvas> {
  ui.Image? _image;
  int _generation = 0;
  List<double>? _frequencyBins;
  DateTime? _startTime;
  DateTime? _endTime;
  int _colCount = 0;
  double _zoomLevel = 1.0;

  void zoomIn() => setState(() => _zoomLevel = (_zoomLevel * 1.5).clamp(0.05, 4.0));
  void zoomOut() => setState(() => _zoomLevel = (_zoomLevel / 1.5).clamp(0.05, 4.0));
  void fitToScreen() {
    final w = context.size?.width ?? 400;
    final nativeHeight = (w - 34) * 0.43;
    final nativeWidth = nativeHeight * 1.5;
    final fitZoom = (w - 34) / nativeWidth;
    setState(() => _zoomLevel = fitZoom.clamp(0.05, 4.0));
  }

  @override
  void initState() {
    super.initState();
    _render();
  }

  @override
  void didUpdateWidget(covariant SpectrogramCanvas oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.histories, widget.histories) ||
        oldWidget.colorMap != widget.colorMap ||
        oldWidget.gainDb != widget.gainDb ||
        oldWidget.noiseThreshold != widget.noiseThreshold) {
      _render();
    }
  }

  Future<void> _render() async {
    final gen = ++_generation;
    final histories = widget.histories.where((h) => h.data.isNotEmpty).toList();

    if (histories.isEmpty) {
      if (mounted && _image != null) {
        setState(() => _image = null);
      }
      return;
    }

    // Build per-block normalized matrices (matches web: each block processed independently).
    final blocks = <List<List<double>>>[];
    List<double>? firstBins;
    DateTime? earliest;
    DateTime? latest;
    int maxRows = 0;
    int totalCols = 0;
    for (final history in histories) {
      final range = history.intensityRange;
      final data = history.data;
      final type = history.intensityType;
      final min = range[0];
      final max = range[1];
      final block = <List<double>>[];
      for (var r = 0; r < data.length; r++) {
        final row = data[r];
        final normalizedRow = <double>[];
        for (var c = 0; c < row.length; c++) {
          normalizedRow.add(DeviceHistory.normalizeValue(row[c], type, min, max));
        }
        block.add(normalizedRow);
      }
      blocks.add(block);
      if (data.length > maxRows) maxRows = data.length;
      totalCols += block.isNotEmpty ? block[0].length : 0;
      if (firstBins == null && history.frequencyBins != null && history.frequencyBins!.isNotEmpty) {
        firstBins = history.frequencyBins;
      }
      final st = history.startTime ?? history.timestamp;
      final et = history.endTime ?? history.timestamp;
      if (st.isNotEmpty) {
        final dt = DateTime.tryParse(st);
        if (dt != null && (earliest == null || dt.isBefore(earliest))) earliest = dt;
      }
      if (et.isNotEmpty) {
        final dt = DateTime.tryParse(et);
        if (dt != null && (latest == null || dt.isAfter(latest))) latest = dt;
      }
    }
    _frequencyBins = firstBins;
    _startTime = earliest;
    _endTime = latest;
    _colCount = totalCols;

    ui.Image? image;
    try {
      image = await SpectroIsolate.render(
        blocks: blocks,
        colorMap: widget.colorMap ?? kColorMapMagma,
        gainDb: widget.gainDb,
        noiseThreshold: widget.noiseThreshold,
        width: totalCols,
        height: maxRows,
      );
    } catch (_) {
      image = null;
    }

    if (!mounted || gen != _generation) {
      image?.dispose();
      return;
    }
    setState(() => _image = image);
  }

  @override
  void dispose() {
    _image?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final img = _image;
    if (img == null) {
      return Container(
        color: const Color(0xFF140D28),
        alignment: Alignment.center,
        child: const Text(
          'لا توجد بيانات',
          style: TextStyle(color: Colors.white38, fontSize: 14),
        ),
      );
    }
    return LayoutBuilder(builder: (context, constraints) {
      final imageAreaHeight = constraints.maxHeight - 24;
      final nativeHeight = imageAreaHeight > 0 ? imageAreaHeight : 400.0;
      final aspectRatio = img.width / img.height;
      final nativeWidth = nativeHeight * aspectRatio;
      final displayWidth = nativeWidth * _zoomLevel;
      final displayHeight = nativeHeight * _zoomLevel;

      return Container(
        color: const Color(0xFF140D28),
        child: Stack(
          children: [
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: SizedBox(
                width: math.max(constraints.maxWidth, displayWidth + 34),
                height: constraints.maxHeight,
                child: Stack(
                  children: [
                    Positioned(
                      left: 32,
                      top: 0,
                      width: displayWidth,
                      height: displayHeight,
                      child: RawImage(
                        image: img,
                        fit: BoxFit.fill,
                        filterQuality: FilterQuality.medium,
                      ),
                    ),
                    Positioned.fill(
                      child: CustomPaint(
                        painter: SpectrogramAxesPainter(
                          colCount: _colCount,
                          frequencyBins: _frequencyBins,
                          startTime: _startTime,
                          endTime: _endTime,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Positioned(
              top: 8,
              right: 8,
              child: Column(
                children: [
                  _zoomBtn(Icons.add, () => zoomIn()),
                  const SizedBox(height: 4),
                  _zoomBtn(Icons.remove, () => zoomOut()),
                  const SizedBox(height: 4),
                  _zoomBtn(Icons.fit_screen, () => fitToScreen()),
                ],
              ),
            ),
          ],
        ),
      );
    });
  }

  Widget _zoomBtn(IconData icon, VoidCallback onTap) {
    return Material(
      color: Colors.black54,
      shape: const CircleBorder(),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Icon(icon, color: Colors.white70, size: 20),
        ),
      ),
    );
  }
}
