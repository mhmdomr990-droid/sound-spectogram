import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/device_history.dart';
import '../utils/spectro.dart';
import '../widgets/spectrogram_canvas.dart';

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
  @override
  void initState() {
    super.initState();
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A0A0A),
      body: Stack(
        children: [
          Padding(
            padding: const EdgeInsets.all(4),
            child: SpectrogramCanvas(
              histories: widget.histories,
              colorMap: kColorMaps[widget.colorMapIndex],
              gainDb: widget.gainDb,
              noiseThreshold: widget.noiseThreshold,
            ),
          ),
          Positioned(
            top: 8,
            right: 8,
            child: Material(
              color: Colors.black54,
              shape: const CircleBorder(),
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: () => Navigator.of(context).pop(),
                child: const Padding(
                  padding: EdgeInsets.all(10),
                  child: Icon(Icons.fullscreen_exit, color: Colors.white70, size: 24),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
