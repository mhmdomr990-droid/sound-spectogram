import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';

import 'controllers/auth_controller.dart';
import 'controllers/dashboard_controller.dart';
import 'controllers/socket_controller.dart';
import 'screens/dashboard_screen.dart';
import 'screens/login_screen.dart';
import 'services/api_client.dart';
import 'services/auth_service.dart';
import 'services/socket_service.dart';

const String kServerBaseUrl = 'http://172.20.20.92:3111';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
  ]);

  final auth = AuthService();
  await auth.load();
  final api = ApiClient(kServerBaseUrl, auth);
  final socket = SocketService();

  Get.put<AuthService>(auth);
  Get.put<ApiClient>(api);
  Get.put<SocketService>(socket);
  Get.put(AuthController(auth, api));
  Get.put(SocketController(socket));
  Get.lazyPut(() => DashboardController(
        Get.find<ApiClient>(),
        Get.find<AuthService>(),
        Get.find<SocketService>(),
      ), fenix: true);

  runApp(const SpectroApp());
}

class SpectroApp extends StatelessWidget {
  const SpectroApp({super.key});

  @override
  Widget build(BuildContext context) {
    return GetMaterialApp(
      title: 'Sound Spectogram',
      debugShowCheckedModeBanner: false,
      theme: _theme(),
      initialRoute: Get.find<AuthController>().isLoggedIn.value ? '/dashboard' : '/login',
      getPages: [
        GetPage(name: '/login', page: () => const LoginScreen()),
        GetPage(name: '/dashboard', page: () => const DashboardScreen()),
      ],
    );
  }

  ThemeData _theme() {
    const primary = Color(0xFF00E676);
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: const ColorScheme.dark(
        primary: primary,
        secondary: Color(0xFF00B0FF),
        surface: Color(0xFF111111),
      ),
      scaffoldBackgroundColor: Colors.black,
      appBarTheme: const AppBarTheme(
        backgroundColor: Color(0xFF111111),
        elevation: 0,
      ),
      textTheme: const TextTheme().apply(
        bodyColor: Colors.white,
        displayColor: Colors.white,
      ),
    );
  }
}
