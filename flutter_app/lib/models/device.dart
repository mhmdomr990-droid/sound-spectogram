class Device {
  final int id;
  final String name;
  final String? description;
  final double? minFrequency;
  final double? maxFrequency;

  const Device({
    required this.id,
    required this.name,
    this.description,
    this.minFrequency,
    this.maxFrequency,
  });

  factory Device.fromJson(Map<String, dynamic> json) {
    return Device(
      id: (json['id'] as num).toInt(),
      name: json['name'] as String,
      description: json['description'] as String?,
      minFrequency: (json['minFrequency'] as num?)?.toDouble(),
      maxFrequency: (json['maxFrequency'] as num?)?.toDouble(),
    );
  }
}
