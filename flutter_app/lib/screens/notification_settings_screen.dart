import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/telegram_service.dart';

class NotificationSettingsScreen extends StatefulWidget {
  const NotificationSettingsScreen({super.key});

  @override
  State<NotificationSettingsScreen> createState() => _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState extends State<NotificationSettingsScreen> {
  final _tokenController = TextEditingController();
  final _channelController = TextEditingController();
  final _inviteLinkController = TextEditingController();
  bool _enabled = false;
  bool _loading = false;
  bool _testing = false;
  String? _testResult;
  bool _showAdmin = false;

  @override
  void initState() {
    super.initState();
    _loadConfig();
  }

  Future<void> _loadConfig() async {
    final token = await TelegramService.getToken();
    final channel = await TelegramService.getChannel();
    final invite = await TelegramService.getInviteLink();
    final enabled = await TelegramService.isEnabled();
    if (!mounted) return;
    setState(() {
      _tokenController.text = token ?? '';
      _channelController.text = channel ?? '';
      _inviteLinkController.text = invite ?? '';
      _enabled = enabled;
    });
  }

  Future<void> _save() async {
    setState(() => _loading = true);
    await TelegramService.saveConfig(
      token: _tokenController.text.trim(),
      channel: _channelController.text.trim(),
      inviteLink: _inviteLinkController.text.trim(),
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
      channel: _channelController.text.trim(),
      inviteLink: _inviteLinkController.text.trim(),
      enabled: _enabled,
    );
    final ok = await TelegramService.sendTestMessage();
    if (!mounted) return;
    setState(() {
      _testing = false;
      _testResult = ok ? 'Test message sent to channel!' : 'Failed. Check Token & Channel.';
    });
  }

  void _openChannel() async {
    final invite = _inviteLinkController.text.trim();
    if (invite.isNotEmpty) {
      final url = Uri.parse(invite);
      if (await canLaunchUrl(url)) {
        await launchUrl(url, mode: LaunchMode.externalApplication);
      }
      return;
    }
    final channel = _channelController.text.trim();
    if (channel.isEmpty) return;
    final username = channel.startsWith('@') ? channel.substring(1) : channel;
    final url = Uri.parse('https://t.me/$username');
    if (await canLaunchUrl(url)) {
      await launchUrl(url, mode: LaunchMode.externalApplication);
    }
  }

  @override
  void dispose() {
    _tokenController.dispose();
    _channelController.dispose();
    _inviteLinkController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A0A0A),
      appBar: AppBar(
        title: const Text('Notifications'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          SwitchListTile(
            title: const Text('Enable Telegram Alerts', style: TextStyle(color: Colors.white)),
            subtitle: const Text('Send alerts to Telegram channel when AI detects a sound', style: TextStyle(color: Colors.white38, fontSize: 12)),
            value: _enabled,
            onChanged: (v) => setState(() => _enabled = v),
            activeColor: const Color(0xFF21A366),
          ),

          const SizedBox(height: 24),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFF1A1A2E),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.telegram, color: Color(0xFF0088CC), size: 28),
                    SizedBox(width: 10),
                    Text('Telegram Channel', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
                  ],
                ),
                const SizedBox(height: 12),
                const Text(
                  'Join our Telegram channel to receive real-time alerts when AI detects a sound.',
                  style: TextStyle(color: Colors.white54, fontSize: 13),
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: _enabled ? _openChannel : null,
                    icon: const Icon(Icons.open_in_new, size: 18),
                    label: const Text('Join Channel'),
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF0088CC),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 32),
          GestureDetector(
            onTap: () => setState(() => _showAdmin = !_showAdmin),
            child: Row(
              children: [
                Icon(_showAdmin ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down, color: Colors.white24, size: 18),
                const Text('Admin Settings', style: TextStyle(color: Colors.white24, fontSize: 12)),
              ],
            ),
          ),

          if (_showAdmin) ...[
            const SizedBox(height: 16),
            TextField(
              controller: _tokenController,
              style: const TextStyle(color: Colors.white),
              obscureText: true,
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
              controller: _channelController,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(
                labelText: 'Channel (public or private ID)',
                labelStyle: TextStyle(color: Colors.white38),
                hintText: '@ChannelName or -1001234567890',
                hintStyle: TextStyle(color: Colors.white12),
                border: OutlineInputBorder(),
                enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
                focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF21A366))),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _inviteLinkController,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(
                labelText: 'Invite Link (optional, for private channels)',
                labelStyle: TextStyle(color: Colors.white38),
                hintText: 'https://t.me/+invite_hash',
                hintStyle: TextStyle(color: Colors.white12),
                border: OutlineInputBorder(),
                enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
                focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF21A366))),
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Public: enter @ChannelName above\nPrivate: enter numeric chat ID + invite link',
              style: TextStyle(color: Colors.white24, fontSize: 11),
            ),
            const SizedBox(height: 20),
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
                  color: _testResult!.contains('sent') ? Colors.greenAccent : Colors.redAccent,
                  fontSize: 13,
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ],
        ],
      ),
    );
  }
}
