import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/device_history.dart';
import '../utils/spectro.dart';
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

  const FullscreenSpectrogram({
    super.key,
    required this.histories,
    required this.colorMapIndex,
    required this.gainDb,
    required this.noiseThreshold,
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
    return Scaffold(
      backgroundColor: const Color(0xFF0A0A0A),
      body: Column(
        children: [
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(4),
              child: SpectrogramCanvas(
                key: _canvasKey,
                histories: widget.histories,
                colorMap: kColorMaps[_colorMapIndex],
                gainDb: _gainDb,
                noiseThreshold: _noiseThreshold,
              ),
            ),
          ),
          Container(
            color: const Color(0xFF111111),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            child: Row(
              children: [
                Expanded(
                  child: Row(
                    children: [
                      const Icon(Icons.volume_up, size: 14, color: Colors.white70),
                      const SizedBox(width: 4),
                      Text(
                        'الكسب: ${_gainDb.toStringAsFixed(0)} dB',
                        style: const TextStyle(color: Colors.white70, fontSize: 11),
                      ),
                      Expanded(
                        child: SliderTheme(
                          data: SliderThemeData(trackHeight: 2, thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6)),
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
                const SizedBox(width: 12),
                Expanded(
                  child: Row(
                    children: [
                      const Icon(Icons.noise_aware, size: 14, color: Colors.white70),
                      const SizedBox(width: 4),
                      Text(
                        'الضوضاء: ${_noiseThreshold.toStringAsFixed(2)}',
                        style: const TextStyle(color: Colors.white70, fontSize: 11),
                      ),
                      Expanded(
                        child: SliderTheme(
                          data: SliderThemeData(trackHeight: 2, thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6)),
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
          Container(
            color: const Color(0xFF111111),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _fsBtn(Icons.palette, 'الألوان', _toggleColorMap),
                const SizedBox(width: 8),
                _fsBtn(Icons.zoom_in, null, () => _canvasKey.currentState?.zoomIn()),
                const SizedBox(width: 8),
                _fsBtn(Icons.zoom_out, null, () => _canvasKey.currentState?.zoomOut()),
                const SizedBox(width: 8),
                _fsBtn(Icons.fit_screen, null, () => _canvasKey.currentState?.fitToScreen()),
                const SizedBox(width: 8),
                _fsBtn(Icons.fullscreen_exit, 'خروج', _exit),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _fsBtn(IconData icon, String? label, VoidCallback onTap) {
    return Material(
      color: Colors.white12,
      borderRadius: BorderRadius.circular(6),
      child: InkWell(
        borderRadius: BorderRadius.circular(6),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: Colors.white70, size: 18),
              if (label != null) ...[
                const SizedBox(width: 4),
                Text(label, style: const TextStyle(color: Colors.white70, fontSize: 11)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
