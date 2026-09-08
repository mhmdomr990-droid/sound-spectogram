import 'package:flutter/material.dart';

import '../services/telegram_service.dart';

class NotificationSettingsScreen extends StatefulWidget {
  const NotificationSettingsScreen({super.key});

  @override
  State<NotificationSettingsScreen> createState() => _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState extends State<NotificationSettingsScreen> {
  final _tokenController = TextEditingController();
  final _chatIdController = TextEditingController();
  bool _enabled = false;
  bool _loading = false;
  bool _testing = false;
  String? _testResult;

  @override
  void initState() {
    super.initState();
    _loadConfig();
  }

  Future<void> _loadConfig() async {
    final token = await TelegramService.getToken();
    final chatId = await TelegramService.getChatId();
    final enabled = await TelegramService.isEnabled();
    if (!mounted) return;
    setState(() {
      _tokenController.text = token ?? '';
      _chatIdController.text = chatId ?? '';
      _enabled = enabled;
    });
  }

  Future<void> _save() async {
    setState(() => _loading = true);
    await TelegramService.saveConfig(
      token: _tokenController.text.trim(),
      chatId: _chatIdController.text.trim(),
      enabled: _enabled,
    );
    if (!mounted) return;
    setState(() => _loading = false);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Saved'), backgroundColor: Colors.green),
    );
  }

  Future<void> _test() async {
    setState(() {
      _testing = true;
      _testResult = null;
    });
    await TelegramService.saveConfig(
      token: _tokenController.text.trim(),
      chatId: _chatIdController.text.trim(),
      enabled: _enabled,
    );
    final ok = await TelegramService.sendTestMessage();
    if (!mounted) return;
    setState(() {
      _testing = false;
      _testResult = ok ? 'Message sent successfully!' : 'Failed to send. Check Token & Chat ID.';
    });
  }

  @override
  void dispose() {
    _tokenController.dispose();
    _chatIdController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A0A0A),
      appBar: AppBar(
        title: const Text('Telegram Notifications'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          SwitchListTile(
            title: const Text('Enable Telegram Alerts', style: TextStyle(color: Colors.white)),
            subtitle: const Text('Send alerts when AI detects a sound', style: TextStyle(color: Colors.white38, fontSize: 12)),
            value: _enabled,
            onChanged: (v) => setState(() => _enabled = v),
            activeColor: const Color(0xFF21A366),
          ),
          const SizedBox(height: 16),
          const Text('How to set up:', style: TextStyle(color: Colors.white70, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          _step('1', 'Open Telegram and search for @BotFather'),
          _step('2', 'Send /newbot and follow the instructions'),
          _step('3', 'Copy the Bot Token and paste it below'),
          _step('4', 'Open your new bot in Telegram and send /start'),
          _step('5', 'Open https://api.telegram.org/bot<TOKEN>/getUpdates'),
          _step('6', 'Find "chat":{"id": ...} and paste the Chat ID below'),
          const SizedBox(height: 24),
          TextField(
            controller: _tokenController,
            style: const TextStyle(color: Colors.white),
            decoration: const InputDecoration(
              labelText: 'Bot Token',
              labelStyle: TextStyle(color: Colors.white38),
              hintText: '123456:ABC-DEF...',
              hintStyle: TextStyle(color: Colors.white12),
              border: OutlineInputBorder(),
              enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
              focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF21A366))),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _chatIdController,
            style: const TextStyle(color: Colors.white),
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
              labelText: 'Chat ID',
              labelStyle: TextStyle(color: Colors.white38),
              hintText: '123456789',
              hintStyle: TextStyle(color: Colors.white12),
              border: OutlineInputBorder(),
              enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
              focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF21A366))),
            ),
          ),
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _testing ? null : _test,
                  icon: _testing
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.send, size: 16),
                  label: const Text('Test'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.white70,
                    side: const BorderSide(color: Colors.white24),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton(
                  onPressed: _loading ? null : _save,
                  child: _loading
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('Save'),
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFF21A366),
                  ),
                ),
              ),
            ],
          ),
          if (_testResult != null) ...[
            const SizedBox(height: 12),
            Text(
              _testResult!,
              style: TextStyle(
                color: _testResult!.contains('success') ? Colors.greenAccent : Colors.redAccent,
                fontSize: 13,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ],
      ),
    );
  }

  Widget _step(String num, String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 20,
            height: 20,
            decoration: BoxDecoration(
              color: const Color(0xFF21A366),
              borderRadius: BorderRadius.circular(10),
            ),
            alignment: Alignment.center,
            child: Text(num, style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
          ),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: const TextStyle(color: Colors.white38, fontSize: 12))),
        ],
      ),
    );
  }
}
