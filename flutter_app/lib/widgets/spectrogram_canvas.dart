import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../models/device_history.dart';
import '../utils/spectro.dart';
import '../utils/spectro_isolate.dart';

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
  State<SpectrogramCanvas> createState() => _SpectrogramCanvasState();
}

class _SpectrogramCanvasState extends State<SpectrogramCanvas> {
  ui.Image? _image;
  int _generation = 0;

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
        oldWidget.noiseThreshold != widget.noiseThreshold ||
        oldWidget.width != widget.width ||
        oldWidget.height != widget.height) {
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

    final width = widget.width ?? 1200;
    final height = widget.height ?? 500;

    // Build per-block normalized matrices (matches web: each block processed independently).
    final blocks = <List<List<double>>>[];
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
    }

    ui.Image? image;
    try {
      image = await SpectroIsolate.render(
        blocks: blocks,
        colorMap: widget.colorMap ?? kColorMapMagma,
        gainDb: widget.gainDb,
        noiseThreshold: widget.noiseThreshold,
        width: width,
        height: height,
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
      return SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: RawImage(
          image: img,
          width: constraints.maxWidth,
          height: constraints.maxHeight,
          fit: BoxFit.contain,
          filterQuality: FilterQuality.medium,
        ),
      );
    });
  }
}
