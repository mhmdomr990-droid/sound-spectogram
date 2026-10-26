import 'package:flutter_test/flutter_test.dart';
import 'package:spectro_phone/models/target_link_state.dart';

void main() {
  test('TargetLinkState parses web payload', () {
    final state = TargetLinkState.fromJson({
      'enabled': true,
      'devices': [
        {
          'deviceId': 12,
          'targetDetected': true,
          'targetCount': 2,
          'confidence': 92,
          'since': '2026-10-26T10:05:00Z',
          'by': 'operator-1',
        },
      ],
      'lastPush': {
        'ok': true,
        'action': 'start',
        'deviceName': 'Device 12',
        'message': 'OK',
      },
    });

    expect(state.enabled, isTrue);
    expect(state.byDevice[12]?.targetDetected, isTrue);
    expect(state.byDevice[12]?.targetCount, 2);
    expect(state.byDevice[12]?.confidence, 92);
    expect(state.lastPush?.action, 'start');
  });
}
