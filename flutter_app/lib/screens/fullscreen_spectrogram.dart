import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/device_history.dart';
import '../widgets/spectrogram_canvas.dart';

class FullscreenResult {
  final int colorMapIndex;
  final double gainDb;
  final double noiseThreshold;

  const FullscreenResult({
    required this.colorMapIndex,
    required this.gainDb,
    required this.noiseThreshold,
  });
}

class FullscreenSpectrogram extends StatefulWidget {
  final List<DeviceHistory> histories;
  final int colorMapIndex;
  final double gainDb;
  final double noiseThreshold;
  final ui.Image? seedImage;
  final List<List<double>>? seedCachedCombined;
  final int seedCachedWidth;
  final int seedCachedHeight;
  final List<double>? seedFrequencyBins;
  final int seedColCount;
  final DateTime? seedStartTime;
  final DateTime? seedEndTime;

  const FullscreenSpectrogram({
    super.key,
    required this.histories,
    required this.colorMapIndex,
    required this.gainDb,
    required this.noiseThreshold,
    this.seedImage,
    this.seedCachedCombined,
    this.seedCachedWidth = 0,
    this.seedCachedHeight = 0,
    this.seedFrequencyBins,
    this.seedColCount = 0,
    this.seedStartTime,
    this.seedEndTime,
  });

  @override
  State<FullscreenSpectrogram> createState() => _FullscreenSpectrogramState();
}

class _FullscreenSpectrogramState extends State<FullscreenSpectrogram> {
  late int _colorMapIndex;
  late double _gainDb;
  late double _noiseThreshold;
  final _canvasKey = GlobalKey<SpectrogramCanvasState>();

  @override
  void initState() {
    super.initState();
    _colorMapIndex = widget.colorMapIndex;
    _gainDb = widget.gainDb;
    _noiseThreshold = widget.noiseThreshold;
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    SystemChrome.setPreferredOrientations([
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]);
  }

  @override
  void dispose() {
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    SystemChrome.setPreferredOrientations([
      DeviceOrientation.portraitUp,
      DeviceOrientation.portraitDown,
    ]);
    super.dispose();
  }

  void _exit() {
    Navigator.of(context).pop(FullscreenResult(
      colorMapIndex: _colorMapIndex,
      gainDb: _gainDb,
      noiseThreshold: _noiseThreshold,
    ));
  }

  void _toggleColorMap() {
    setState(() {
      _colorMapIndex = (_colorMapIndex + 1) % kColorMaps.length;
    });
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    return MediaQuery(
      data: media.copyWith(
        padding: EdgeInsets.zero,
        viewPadding: EdgeInsets.zero,
        viewInsets: EdgeInsets.zero,
      ),
      child: Scaffold(
        backgroundColor: const Color(0xFF0A0A0A),
        extendBody: true,
        body: Stack(
          children: [
            Positioned.fill(
              child: SpectrogramCanvas(
                key: _canvasKey,
                histories: widget.histories,
                colorMap: kColorMaps[_colorMapIndex],
                gainDb: _gainDb,
                noiseThreshold: _noiseThreshold,
                seedImage: widget.seedImage,
                seedCachedCombined: widget.seedCachedCombined,
                seedCachedWidth: widget.seedCachedWidth,
                seedCachedHeight: widget.seedCachedHeight,
                seedFrequencyBins: widget.seedFrequencyBins,
                seedColCount: widget.seedColCount,
                seedStartTime: widget.seedStartTime,
                seedEndTime: widget.seedEndTime,
              ),
            ),
            Positioned(
              left: 0,
              right: 0,
              top: 0,
              child: SafeArea(
                top: false,
                bottom: false,
                child: Align(
                  alignment: Alignment.topCenter,
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 420),
                    child: Container(
                      margin: const EdgeInsets.fromLTRB(8, 8, 8, 0),
                      decoration: BoxDecoration(
                        color: const Color(0xAA111111),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 1),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            decoration: BoxDecoration(
                              color: const Color(0xFF111111),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Row(
                                    children: [
                                      const Icon(Icons.volume_up, size: 11, color: Colors.white70),
                                      const SizedBox(width: 2),
                                      Text(
                                        '${_gainDb.toStringAsFixed(0)} dB',
                                        style: const TextStyle(color: Colors.white70, fontSize: 8),
                                      ),
                                      Expanded(
                                        child: SliderTheme(
                                          data: SliderThemeData(trackHeight: 1, thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 3)),
                                          child: Slider(
                                            value: _gainDb,
                                            min: -24,
                                            max: 24,
                                            divisions: 48,
                                            onChanged: (v) => setState(() => _gainDb = v),
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                Expanded(
                                  child: Row(
                                    children: [
                                      const Icon(Icons.noise_aware, size: 11, color: Colors.white70),
                                      const SizedBox(width: 2),
                                      Text(
                                        _noiseThreshold.toStringAsFixed(2),
                                        style: const TextStyle(color: Colors.white70, fontSize: 8),
                                      ),
                                      Expanded(
                                        child: SliderTheme(
                                          data: SliderThemeData(trackHeight: 1, thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 3)),
                                          child: Slider(
                                            value: _noiseThreshold,
                                            min: 0.0,
                                            max: 0.5,
                                            divisions: 50,
                                            onChanged: (v) => setState(() => _noiseThreshold = v),
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 1),
                          Container(
                            decoration: BoxDecoration(
                              color: const Color(0xFF111111),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 1),
                            child: Row(
                              children: [
                                Expanded(child: _fsBtn(Icons.palette, null, _toggleColorMap)),
                                const SizedBox(width: 1),
                                Expanded(child: _fsBtn(Icons.arrow_left, null, () => _canvasKey.currentState?.panLeft())),
                                const SizedBox(width: 1),
                                Expanded(child: _fsBtn(Icons.zoom_in, null, () => _canvasKey.currentState?.zoomIn())),
                                const SizedBox(width: 1),
                                Expanded(child: _fsBtn(Icons.zoom_out, null, () => _canvasKey.currentState?.zoomOut())),
                                const SizedBox(width: 1),
                                Expanded(child: _fsBtn(Icons.arrow_right, null, () => _canvasKey.currentState?.panRight())),
                                const SizedBox(width: 1),
                                Expanded(child: _fsBtn(Icons.fit_screen, null, () => _canvasKey.currentState?.fitToScreen())),
                                const SizedBox(width: 1),
                                Expanded(child: _fsBtn(Icons.fullscreen_exit, null, _exit)),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _fsBtn(IconData icon, String? label, VoidCallback onTap) {
    return Material(
      color: Colors.white12,
      borderRadius: BorderRadius.circular(4),
      child: InkWell(
        borderRadius: BorderRadius.circular(4),
        onTap: onTap,
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, color: Colors.white70, size: 18),
                if (label != null) ...[
                  const SizedBox(height: 2),
                  Text(label, style: const TextStyle(color: Colors.white70, fontSize: 8)),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
