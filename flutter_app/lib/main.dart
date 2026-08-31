import 'package:flutter/material.dart';

import 'screens/dashboard_screen.dart';
import 'screens/login_screen.dart';
import 'services/api_client.dart';
import 'services/auth_service.dart';
import 'services/socket_service.dart';

/// Server base URL. The emulator reaches the host machine via 10.0.2.2.
const String kServerBaseUrl = 'http://192.168.1.8:3111';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final auth = AuthService();
  await auth.load();
  final api = ApiClient(kServerBaseUrl, auth);
  final socket = SocketService();
  runApp(SpectroApp(auth: auth, api: api, socket: socket));
}

class SpectroApp extends StatefulWidget {
  final AuthService auth;
  final ApiClient api;
  final SocketService socket;

  const SpectroApp({
    super.key,
    required this.auth,
    required this.api,
    required this.socket,
  });

  @override
  State<SpectroApp> createState() => _SpectroAppState();
}

class _SpectroAppState extends State<SpectroApp> {
  @override
  void dispose() {
    widget.socket.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Spectro Phone',
      debugShowCheckedModeBanner: false,
      theme: _theme(),
      initialRoute: widget.auth.isLoggedIn ? '/dashboard' : '/login',
      routes: {
        '/login': (_) => LoginScreen(
              baseUrl: kServerBaseUrl,
              api: widget.api,
              auth: widget.auth,
            ),
        '/dashboard': (_) => DashboardScreen(
              api: widget.api,
              auth: widget.auth,
              socket: widget.socket,
            ),
      },
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
