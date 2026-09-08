import 'package:flutter/material.dart';

import '../services/api_client.dart';
import '../services/auth_service.dart';

class LoginScreen extends StatefulWidget {
  final String baseUrl;
  final ApiClient api;
  final AuthService auth;

  const LoginScreen({
    super.key,
    required this.baseUrl,
    required this.api,
    required this.auth,
  });

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _username = TextEditingController(text: 'admin');
  final _password = TextEditingController(text: 'r7ZZqT79l57EOBv');
  final _server = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    _server.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    final serverUrl = _server.text.trim();
    if (serverUrl.isNotEmpty) {
      widget.api.baseUrl = serverUrl;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final json = await widget.api.post(
        '/api/auth/login',
        body: {
          'username': _username.text.trim(),
          'password': _password.text,
        },
        authRequired: false,
      ) as Map<String, dynamic>;

      final token = json['token'] as String;
      final user = AuthUser.fromJson(json['user'] as Map<String, dynamic>);
      await widget.auth.save(token: token, user: user);

      if (mounted) {
        Navigator.of(context).pushReplacementNamed('/dashboard');
      }
    } catch (e) {
      setState(() {
        _error = (e as Exception?)?.toString() ?? 'Login failed';
      });
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
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
                  controller: _username,
                  style: const TextStyle(color: Colors.white),
                  decoration: _inputDeco('Username', Icons.person),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _password,
                  obscureText: true,
                  style: const TextStyle(color: Colors.white),
                  decoration: _inputDeco('Password', Icons.lock),
                  onSubmitted: (_) => _login(),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _server,
                  style: const TextStyle(color: Colors.white),
                  decoration: _inputDeco(
                    'Server URL (optional)',
                    Icons.dns,
                  ).copyWith(
                    hintText: widget.baseUrl,
                    hintStyle: const TextStyle(color: Colors.white24),
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: const TextStyle(color: Colors.redAccent, fontSize: 13)),
                ],
                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: FilledButton(
                    onPressed: _loading ? null : _login,
                    child: _loading
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('LOGIN', style: TextStyle(letterSpacing: 3)),
                  ),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  height: 40,
                  child: OutlinedButton.icon(
                    onPressed: _loading ? null : () {
                      Navigator.of(context).pushReplacementNamed('/test');
                    },
                    icon: const Icon(Icons.science, size: 18),
                    label: const Text('دخول اختبار', style: TextStyle(fontSize: 13)),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.white54,
                      side: const BorderSide(color: Colors.white24),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  widget.baseUrl,
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

  InputDecoration _inputDeco(String label, IconData icon) {
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
