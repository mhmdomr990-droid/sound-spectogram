import '../models/target_link_state.dart';
import 'api_client.dart';

class TargetLinkService {
  final ApiClient api;

  const TargetLinkService(this.api);

  Future<TargetLinkState> loadTargets() async {
    final raw = await api.get('/api/target-link/targets');
    final body = raw is Map ? raw.cast<String, dynamic>() : <String, dynamic>{};
    return TargetLinkState.fromJson(body);
  }

  Future<TargetLinkState> sendStart({
    required int deviceId,
    required int targetCount,
    required int confidence,
  }) async {
    final raw = await api.post(
      '/api/target-link/targets',
      body: {
        'deviceId': deviceId,
        'action': 'start',
        'targetCount': targetCount,
        'confidence': confidence,
      },
    );
    final body = raw is Map ? raw.cast<String, dynamic>() : <String, dynamic>{};
    return TargetLinkState.fromJson(body);
  }

  Future<TargetLinkState> sendEnd({required int deviceId}) async {
    final raw = await api.post(
      '/api/target-link/targets',
      body: {'deviceId': deviceId, 'action': 'end'},
    );
    final body = raw is Map ? raw.cast<String, dynamic>() : <String, dynamic>{};
    return TargetLinkState.fromJson(body);
  }
}
