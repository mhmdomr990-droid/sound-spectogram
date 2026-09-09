import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

class DeviceIdService {
  static const _key = 'device_id';
  final FlutterSecureStorage _storage;

  const DeviceIdService({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  Future<String> getOrCreate() async {
    final existing = await _storage.read(key: _key);
    if (existing != null) return existing;
    final newId = const Uuid().v4();
    await _storage.write(key: _key, value: newId);
    return newId;
  }
}
