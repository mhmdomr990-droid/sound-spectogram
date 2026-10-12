import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'controllers/auth_controller.dart';
import 'controllers/dashboard_controller.dart';
import 'screens/dashboard_screen.dart';
import 'screens/login_screen.dart';
import 'services/api_client.dart';
import 'services/auth_service.dart';
import 'services/foreground_service.dart';
import 'services/notification_service.dart';
import 'services/socket_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
  ]);

  await NotificationService.init();
  await AppForegroundService.init();

  final prefs = await SharedPreferences.getInstance();
  final savedServer = prefs.getString('saved_server_url') ?? '';

  final auth = AuthService();
  await auth.load();
  final api = ApiClient(savedServer, auth);
  final socket = SocketService();

  // Idle logout: if 48h (testing: 10 min) passed since the last app exit,
  // clear the full session BEFORE the foreground service can start.
  await AuthController.enforceIdleLogoutOnLaunch(auth);

  if (auth.isLoggedIn && NotificationService.enabled) {
    await AppForegroundService.start();
  }

  Get.put<AuthService>(auth);
  Get.put<ApiClient>(api);
  Get.put<SocketService>(socket);
  Get.put(AuthController(auth, api));
  Get.lazyPut(() => DashboardController(
        Get.find<ApiClient>(),
        Get.find<AuthService>(),
        Get.find<SocketService>(),
      ), fenix: true);

  runApp(const SpectroApp());
}

class SpectroApp extends StatefulWidget {
  const SpectroApp({super.key});

  @override
  State<SpectroApp> createState() => _SpectroAppState();
}

class _SpectroAppState extends State<SpectroApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Stamp "last exit" on background and on return so continuous foreground
    // use is never treated as an exit.
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.resumed) {
      AuthController.stampExit();
    }
  }

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
