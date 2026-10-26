class TargetDeviceState {
  final int deviceId;
  final bool targetDetected;
  final int? targetCount;
  final int? confidence;
  final String? since;
  final String? by;

  const TargetDeviceState({
    required this.deviceId,
    required this.targetDetected,
    this.targetCount,
    this.confidence,
    this.since,
    this.by,
  });

  factory TargetDeviceState.fromJson(Map<String, dynamic> json) {
    return TargetDeviceState(
      deviceId: int.tryParse('${json['deviceId']}') ?? 0,
      targetDetected: json['targetDetected'] == true,
      targetCount: json['targetCount'] is int
          ? json['targetCount'] as int
          : null,
      confidence: json['confidence'] is int ? json['confidence'] as int : null,
      since: json['since']?.toString(),
      by: json['by']?.toString(),
    );
  }
}

class LastPushState {
  final bool ok;
  final String action;
  final String? at;
  final String? deviceName;
  final String? message;

  const LastPushState({
    required this.ok,
    required this.action,
    this.at,
    this.deviceName,
    this.message,
  });

  factory LastPushState.fromJson(Map<String, dynamic> json) {
    return LastPushState(
      ok: json['ok'] == true,
      action: (json['action'] ?? 'start').toString(),
      at: json['at']?.toString(),
      deviceName: json['deviceName']?.toString(),
      message: json['message']?.toString(),
    );
  }
}

class TargetLinkState {
  final bool enabled;
  final bool loaded;
  final Map<int, TargetDeviceState> byDevice;
  final LastPushState? lastPush;

  const TargetLinkState({
    required this.enabled,
    required this.loaded,
    required this.byDevice,
    this.lastPush,
  });

  factory TargetLinkState.fromJson(Map<String, dynamic> json) {
    final devices = (json['devices'] as List? ?? const [])
        .map(
          (e) =>
              TargetDeviceState.fromJson(Map<String, dynamic>.from(e as Map)),
        )
        .toList();

    final byDevice = <int, TargetDeviceState>{};
    for (final device in devices) {
      byDevice[device.deviceId] = device;
    }

    return TargetLinkState(
      enabled: json['enabled'] == true,
      loaded: true,
      byDevice: byDevice,
      lastPush: json['lastPush'] != null
          ? LastPushState.fromJson(
              Map<String, dynamic>.from(json['lastPush'] as Map),
            )
          : null,
    );
  }
}
