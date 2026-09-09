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
      body: Center(
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
