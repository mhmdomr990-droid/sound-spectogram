import 'dart:math';

import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../controllers/auth_controller.dart';
import '../services/api_client.dart';
import '../services/device_id_service.dart';

class LoginScreen extends StatelessWidget {
  const LoginScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = Get.find<AuthController>();
    final usernameCtrl = TextEditingController(text: controller.savedUsername.value);
    final passwordCtrl = TextEditingController(text: controller.savedPassword.value);
    final serverCtrl = TextEditingController();
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          const Positioned.fill(child: _SpectrogramBackground()),
          Positioned.fill(
            child: Container(color: Colors.black.withOpacity(0.55)),
          ),
          Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.graphic_eq, size: 72, color: scheme.primary),
                    const SizedBox(height: 12),
                    Text(
                      'Sound Spectogram',
                      style: TextStyle(
                        color: scheme.primary,
                        fontSize: 24,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 4,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Sound Spectogram',
                      style: TextStyle(color: Colors.white38, fontSize: 13),
                    ),
                    const SizedBox(height: 32),
                    TextField(
                      controller: usernameCtrl,
                      style: const TextStyle(color: Colors.white),
                      decoration: _inputDeco(context, 'Username', Icons.person),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: passwordCtrl,
                      obscureText: true,
                      style: const TextStyle(color: Colors.white),
                      decoration: _inputDeco(context, 'Password', Icons.lock),
                      onSubmitted: (_) => _loginWithDeviceId(controller, usernameCtrl, passwordCtrl, serverCtrl),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: serverCtrl,
                      style: const TextStyle(color: Colors.white),
                      decoration: _inputDeco(
                        context,
                        'Server URL (optional)',
                        Icons.dns,
                      ).copyWith(
                        hintText: Get.find<ApiClient>().baseUrl,
                        hintStyle: const TextStyle(color: Colors.white24),
                      ),
                    ),
                    Obx(() => controller.error.value.isNotEmpty
                        ? Padding(
                            padding: const EdgeInsets.only(top: 12),
                            child: Text(controller.error.value, style: const TextStyle(color: Colors.redAccent, fontSize: 13)),
                          )
                        : const SizedBox.shrink()),
                    const SizedBox(height: 24),
                    SizedBox(
                      width: double.infinity,
                      height: 48,
                      child: Obx(() => FilledButton(
                        onPressed: controller.isLoading.value
                            ? null
                            : () => _loginWithDeviceId(controller, usernameCtrl, passwordCtrl, serverCtrl),
                        child: controller.isLoading.value
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Text('LOGIN', style: TextStyle(letterSpacing: 3)),
                      )),
                    ),
                    const SizedBox(height: 10),
                    SizedBox(
                      width: double.infinity,
                      height: 44,
                      child: Obx(() => OutlinedButton(
                        onPressed: controller.isLoading.value
                            ? null
                            : () async {
                                await controller.login(
                                  username: usernameCtrl.text,
                                  password: passwordCtrl.text,
                                  serverUrl: serverCtrl.text.trim(),
                                );
                                if (controller.isLoggedIn.value) {
                                  Get.offAllNamed('/dashboard');
                                }
                              },
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Colors.orange,
                          side: const BorderSide(color: Colors.orange),
                        ),
                        child: const Text('DEV LOGIN', style: TextStyle(letterSpacing: 2)),
                      )),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      Get.find<ApiClient>().baseUrl,
                      style: const TextStyle(color: Colors.white24, fontSize: 12),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _loginWithDeviceId(
    AuthController controller,
    TextEditingController usernameCtrl,
    TextEditingController passwordCtrl,
    TextEditingController serverCtrl,
  ) async {
    final deviceId = await const DeviceIdService().getOrCreate();
    await controller.login(
      username: usernameCtrl.text,
      password: passwordCtrl.text,
      serverUrl: serverCtrl.text.trim(),
      deviceId: deviceId,
    );
    if (controller.isLoggedIn.value) {
      Get.offAllNamed('/dashboard');
    }
  }

  InputDecoration _inputDeco(BuildContext context, String label, IconData icon) {
    return InputDecoration(
      labelText: label,
      labelStyle: const TextStyle(color: Colors.white38),
      prefixIcon: Icon(icon, color: Colors.white38),
      enabledBorder: const UnderlineInputBorder(
        borderSide: BorderSide(color: Colors.white24),
      ),
      focusedBorder: UnderlineInputBorder(
        borderSide: BorderSide(color: Theme.of(context).colorScheme.primary),
      ),
    );
  }
}

class _SpectrogramBackground extends StatefulWidget {
  const _SpectrogramBackground();

  @override
  State<_SpectrogramBackground> createState() => _SpectrogramBackgroundState();
}

class _SpectrogramBackgroundState extends State<_SpectrogramBackground>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final List<_SpectrogramColumn> _columns;
  final _random = Random(42);

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 60),
    )..repeat();

    _columns = List.generate(50, (_) => _generateColumn());
  }

  _SpectrogramColumn _generateColumn() {
    return _SpectrogramColumn(
      x: _random.nextDouble(),
      width: 2.0 + _random.nextDouble() * 6.0,
      heightFraction: 0.15 + _random.nextDouble() * 0.85,
      colorIndex: _random.nextDouble(),
      speed: 0.8 + _random.nextDouble() * 1.5,
      yPhase: _random.nextDouble() * pi * 2,
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        return CustomPaint(
          painter: _SpectrogramPainter(
            columns: _columns,
            progress: _controller.value,
          ),
          size: Size.infinite,
        );
      },
    );
  }
}

class _SpectrogramColumn {
  final double x;
  final double width;
  final double heightFraction;
  final double colorIndex;
  final double speed;
  final double yPhase;

  const _SpectrogramColumn({
    required this.x,
    required this.width,
    required this.heightFraction,
    required this.colorIndex,
    required this.speed,
    required this.yPhase,
  });
}

class _SpectrogramPainter extends CustomPainter {
  final List<_SpectrogramColumn> columns;
  final double progress;

  _SpectrogramPainter({required this.columns, required this.progress});

  static const _magmaColors = [
    Color(0xFF000004),
    Color(0xFF160B39),
    Color(0xFF420A68),
    Color(0xFF6A176E),
    Color(0xFF932667),
    Color(0xFFBC3754),
    Color(0xFFDD513A),
    Color(0xFFF37819),
    Color(0xFFFCA50A),
    Color(0xFFF6D746),
    Color(0xFFFFFDAF),
  ];

  Color _magmaColor(double t) {
    t = t.clamp(0.0, 1.0);
    final idx = t * (_magmaColors.length - 1);
    final i = idx.floor().clamp(0, _magmaColors.length - 2);
    final frac = idx - i;
    final c1 = _magmaColors[i];
    final c2 = _magmaColors[i + 1];
    return Color.lerp(c1, c2, frac)!;
  }

  @override
  void paint(Canvas canvas, Size size) {
    for (final col in columns) {
      final scrollOffset = (progress * col.speed) % 1.0;
      var normX = (col.x - scrollOffset) % 1.0;
      if (normX < 0) normX += 1.0;

      final px = normX * size.width;
      final maxH = col.heightFraction * size.height;
      final h = maxH * (0.5 + 0.5 * sin(progress * pi * 4 * col.speed + col.yPhase));
      final top = size.height - h;

      final paint = Paint()
        ..color = _magmaColor(col.colorIndex).withOpacity(0.15)
        ..style = PaintingStyle.fill;

      canvas.drawRect(
        Rect.fromLTWH(px - col.width / 2, top, col.width, h),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(_SpectrogramPainter oldDelegate) =>
      oldDelegate.progress != progress;
}
