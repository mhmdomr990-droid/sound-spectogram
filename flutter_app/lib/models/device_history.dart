import 'dart:convert';

import 'package:archive/archive.dart';

/// Shared stateless GZipDecoder instance — avoids reallocation per call.
final _sharedGZipDecoder = GZipDecoder();

/// AI status values matching the server's `AiStatus` enum.
enum AiStatus {
  possible(0),
  detected(1),
  notDetected(2);

  final int code;
  const AiStatus(this.code);

  static AiStatus fromCode(num? code) {
    switch (code?.toInt()) {
      case 1:
        return AiStatus.detected;
      case 2:
        return AiStatus.notDetected;
      default:
        return AiStatus.possible;
    }
  }
}

class DeviceHistory {
  final int id;
  final int deviceId;
  final String timestamp;
  final String? startTime;
  final String? endTime;

  /// 2D intensity matrix. Rows are frequency bins, columns are time samples.
  final List<List<double>> data;

  /// Frequency bins (Hz) for each row, if provided by the server.
  final List<double>? frequencyBins;

  final String? intensityType;
  final AiStatus aiStatus;
  final double? confidence;

  /// Cached intensity range — computed once during construction.
  final List<double> intensityRange;

  const DeviceHistory({
    required this.id,
    required this.deviceId,
    required this.timestamp,
    this.startTime,
    this.endTime,
    required this.data,
    this.frequencyBins,
    this.intensityType,
    this.aiStatus = AiStatus.possible,
    this.confidence,
    required this.intensityRange,
  });

  /// Number of time columns in the matrix.
  int get width => data.isEmpty ? 0 : data.first.length;

  /// Number of frequency rows in the matrix.
  int get height => data.length;

  /// Computes the intensity range [min, max] from a 2D matrix.
  static List<double> _computeIntensityRange(List<List<double>> data) {
    if (data.isEmpty) {
      return const [0, 1];
    }
    double min = double.infinity;
    double max = double.negativeInfinity;
    for (final row in data) {
      for (final v in row) {
        if (v.isNaN || v.isInfinite) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!min.isFinite || !max.isFinite) {
      return const [0, 1];
    }
    return [min, max];
  }

  /// Decodes an intensity matrix value to the [0, 1] range expected by the
  /// color map renderer, matching the web `normalizeScalarByType`:
  /// - `db`: fixed mapping over [-95, -20] dB (not the observed range).
  /// - `uint8`: divide by 255.
  /// - `normalized`: already in [0, 1].
  /// - anything else: `normalizeIntensity` (<= 1 kept, > 1 divided by 255).
  static double normalizeValue(double raw, String? intensityType, double min, double max) {
    const dbMin = -95.0;
    const dbMax = -20.0;
    if (intensityType == 'db') {
      if (dbMax <= dbMin) {
        return 0;
      }
      return ((raw - dbMin) / (dbMax - dbMin)).clamp(0.0, 1.0);
    }

    if (intensityType == 'uint8') {
      return (raw / 255.0).clamp(0.0, 1.0);
    }

    if (intensityType == 'normalized') {
      return raw.clamp(0.0, 1.0);
    }

    // 'magnitude' and unknown: match web normalizeIntensity semantics.
    final n = raw.isNaN || raw.isInfinite ? 0.0 : raw;
    if (n <= 1) {
      return n.clamp(0.0, 1.0);
    }
    return (n / 255.0).clamp(0.0, 1.0);
  }

  /// Decodes a matrix payload that may be a plain 2D array or a
  /// `gzip-base64-json-v1` compressed object.
  static List<List<double>> decodeMatrixPayload(dynamic payload) {
    if (payload is List) {
      return _matrixFromList(payload);
    }
    if (payload is Map<String, dynamic>) {
      final format = payload['format'];
      if (format == 'gzip-base64-json-v1') {
        final raw = payload['payload'] as String;
        final bytes = base64Decode(raw);
        final inflated = _sharedGZipDecoder.decodeBytes(bytes);
        final decoded = jsonDecode(utf8.decode(inflated));
        return _matrixFromList(decoded);
      }
      if (payload['data'] != null) {
        return _matrixFromList(payload['data']);
      }
    }
    return const [];
  }

  static List<List<double>> _matrixFromList(dynamic list) {
    if (list is! List || list.isEmpty) {
      return const [];
    }
    final rows = list.length;
    return List<List<double>>.generate(rows, (r) {
      final row = list[r];
      if (row is! List || row.isEmpty) {
        return const [];
      }
      final cols = row.length;
      return List<double>.generate(cols, (c) {
        final v = row[c];
        return (v is num) ? v.toDouble() : 0.0;
      });
    });
  }

  static double? _parseConfidence(dynamic value) {
    if (value == null) return null;
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }

  factory DeviceHistory.fromJson(Map<String, dynamic> json) {
    final data = decodeMatrixPayload(json['data']);
    final binsRaw = json['frequencyBins'];
    List<double>? bins;
    if (binsRaw is List) {
      bins = binsRaw.map((e) => (e is num) ? e.toDouble() : 0.0).toList();
    }

    return DeviceHistory(
      id: (json['id'] as num?)?.toInt() ?? 0,
      deviceId: (json['deviceId'] as num?)?.toInt() ?? 0,
      timestamp: json['timestamp'] as String? ?? '',
      startTime: json['startTime'] as String?,
      endTime: json['endTime'] as String?,
      data: data,
      frequencyBins: bins,
      intensityType: json['intensityType'] as String? ?? json['intensity_type'] as String?,
      aiStatus: AiStatus.fromCode(json['aiStatus'] as num? ?? json['ai_status'] as num?),
      confidence: _parseConfidence(json['confidence']),
      intensityRange: _computeIntensityRange(data),
    );
  }
}
