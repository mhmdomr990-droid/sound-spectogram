import 'package:flutter_foreground_task/flutter_foreground_task.dart';

class AppForegroundService {
  static bool _running = false;

  static bool get isRunning => _running;

  static Future<void> init() async {
    FlutterForegroundTask.init(
      androidNotificationOptions: AndroidNotificationOptions(
        channelId: 'spectro_foreground',
        channelName: 'مراقبة الأصوات',
        channelDescription: 'يُبقي التطبيق نشطاً لرصد الأهداف',
        channelImportance: NotificationChannelImportance.LOW,
        onlyAlertOnce: true,
      ),
      iosNotificationOptions: const IOSNotificationOptions(
        showNotification: false,
        playSound: false,
      ),
      foregroundTaskOptions: ForegroundTaskOptions(
        eventAction: ForegroundTaskEventAction.nothing(),
        autoRunOnBoot: false,
        allowWakeLock: true,
      ),
    );
  }

  static Future<void> start() async {
    if (_running) return;

    final isRunning = await FlutterForegroundTask.isRunningService;
    if (isRunning) {
      _running = true;
      return;
    }

    final result = await FlutterForegroundTask.startService(
      serviceId: 1,
      notificationTitle: 'Sound Spectogram',
      notificationText: 'مراقبة نشطة — جاري رصد الأهداف',
      notificationIcon: null,
      notificationInitialRoute: '/',
      callback: _serviceCallback,
    );

    _running = result is ServiceRequestSuccess;
  }

  static Future<void> stop() async {
    if (!_running) return;
    await FlutterForegroundTask.stopService();
    _running = false;
  }
}

@pragma('vm:entry-point')
void _serviceCallback() {
  FlutterForegroundTask.setTaskHandler(_DummyTaskHandler());
}

class _DummyTaskHandler extends TaskHandler {
  @override
  Future<void> onStart(DateTime timestamp, TaskStarter starter) async {}

  @override
  void onRepeatEvent(DateTime timestamp) {}

  @override
  Future<void> onDestroy(DateTime timestamp) async {}
}
