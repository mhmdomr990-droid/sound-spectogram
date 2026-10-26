import 'package:flutter/material.dart';

import '../models/target_link_state.dart';
import '../services/api_client.dart';
import '../services/target_link_service.dart';

class TargetLinkButton extends StatefulWidget {
  final int? selectedDeviceId;
  final String? selectedDeviceName;
  final ApiClient api;

  const TargetLinkButton({
    super.key,
    required this.selectedDeviceId,
    required this.selectedDeviceName,
    required this.api,
  });

  @override
  State<TargetLinkButton> createState() => _TargetLinkButtonState();
}

class _TargetLinkButtonState extends State<TargetLinkButton> {
  late final TargetLinkService _service;

  bool _loaded = false;
  bool _enabled = false;
  bool _busy = false;
  final Map<int, TargetDeviceState> _byDevice = {};
  LastPushState? _lastPush;

  @override
  void initState() {
    super.initState();
    _service = TargetLinkService(widget.api);
    _load();
  }

  @override
  void didUpdateWidget(covariant TargetLinkButton oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selectedDeviceId != widget.selectedDeviceId) {
      _load();
    }
  }

  Future<void> _load() async {
    if (!mounted) return;
    try {
      final state = await _service.loadTargets();
      if (!mounted) return;
      setState(() {
        _loaded = true;
        _enabled = state.enabled;
        _byDevice.clear();
        _byDevice.addAll(state.byDevice);
        _lastPush = state.lastPush;
      });
    } catch (_) {
      if (mounted) {
        setState(() => _loaded = true);
      }
    }
  }

  Future<void> _onPressed() async {
    final deviceId = widget.selectedDeviceId;
    if (deviceId == null || _busy) return;

    final current = _byDevice[deviceId];
    final active = current?.targetDetected ?? false;

    if (active) {
      final confirm = await _showConfirmDialog(
        title: 'تأكيد إلغاء الهدف',
        message:
            'هل تريد إلغاء الهدف المعروض على الجهاز ${widget.selectedDeviceName ?? 'المحدد'}؟',
        confirmText: 'نعم، ألغِ الهدف',
      );
      if (confirm != true) return;
    } else {
      final values = await _showTargetDialog();
      if (values == null) return;
      final targetCount = values['targetCount'] as int;
      final confidence = values['confidence'] as int;
      if (targetCount <= 0 || confidence <= 0) return;

      setState(() => _busy = true);
      try {
        await _service.sendStart(
          deviceId: deviceId,
          targetCount: targetCount,
          confidence: confidence,
        );
        await _load();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                'تم إرسال اكتشاف الهدف للجهاز ${widget.selectedDeviceName ?? deviceId}',
              ),
              behavior: SnackBarBehavior.floating,
              backgroundColor: Colors.green,
            ),
          );
        }
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('فشل إرسال هدف جديد'),
              backgroundColor: Colors.red,
            ),
          );
        }
      } finally {
        if (mounted) setState(() => _busy = false);
      }
      return;
    }

    setState(() => _busy = true);
    try {
      await _service.sendEnd(deviceId: deviceId);
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'تم إرسال إلغاء الهدف للجهاز ${widget.selectedDeviceName ?? deviceId}',
            ),
            behavior: SnackBarBehavior.floating,
            backgroundColor: Colors.orange,
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('فشل إرسال إلغاء الهدف'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<Map<String, int>?> _showTargetDialog() async {
    final countController = TextEditingController(text: '1');
    final confidenceController = TextEditingController(text: '100');
    final result = await showDialog<Map<String, int>>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('تأكيد اكتشاف هدف'),
          content: SizedBox(
            width: 300,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: countController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'عدد الأهداف المكتشفة',
                    hintText: '1 إلى 99',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: confidenceController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'نسبة الثقة',
                    hintText: '1 إلى 100',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () {
                final count = int.tryParse(countController.text);
                final conf = int.tryParse(confidenceController.text);
                final safeCount = (count ?? 1).clamp(1, 99);
                final safeConf = (conf ?? 100).clamp(1, 100);
                Navigator.pop(context, {
                  'targetCount': safeCount,
                  'confidence': safeConf,
                });
              },
              child: const Text('إرسال'),
            ),
          ],
        );
      },
    );

    return result;
  }

  Future<bool?> _showConfirmDialog({
    required String title,
    required String message,
    required String confirmText,
  }) async {
    return showDialog<bool>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(confirmText),
            ),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final deviceId = widget.selectedDeviceId;
    if (!_loaded || !_enabled || deviceId == null) {
      return const SizedBox.shrink();
    }

    final current = _byDevice[deviceId];
    final active = current?.targetDetected ?? false;
    final dotColor = _lastPush == null
        ? Colors.grey
        : (_lastPush!.ok ? Colors.green : Colors.red);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6),
      child: FilledButton.icon(
        onPressed: _busy ? null : _onPressed,
        style: FilledButton.styleFrom(
          backgroundColor: active
              ? Colors.red.shade600
              : Colors.orange.shade700,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        ),
        icon: Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
        ),
        label: Text(active ? 'إلغاء الهدف' : 'اكتشاف هدف'),
      ),
    );
  }
}
