import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

/// Sello de evidencia: tiempo, ID de dispositivo y GPS verificado.
class EvidenceStamp {
  const EvidenceStamp({
    required this.timestamp,
    required this.deviceId,
    required this.latitude,
    required this.longitude,
    required this.accuracyMeters,
  });
  final DateTime timestamp;
  final String deviceId;
  final double latitude, longitude, accuracyMeters;

  /// GPS verificado: precisión aceptable.
  bool get verified => accuracyMeters <= 50;

  Map<String, Object?> toJson() => {
        'ts': timestamp.toIso8601String(),
        'device': deviceId,
        'lat': latitude,
        'lng': longitude,
        'acc': accuracyMeters,
      };
}

/// Punto de integración con geolocator / device_info_plus.
abstract interface class EvidenceSource {
  Future<EvidenceStamp> capture();
}

class StubEvidenceSource implements EvidenceSource {
  @override
  Future<EvidenceStamp> capture() async => EvidenceStamp(
        timestamp: DateTime.now(),
        deviceId: 'DEV-4F2A-91C0',
        latitude: 19.5438,
        longitude: -96.9102,
        accuracyMeters: 12,
      );
}

final evidenceSourceProvider = Provider<EvidenceSource>((_) => StubEvidenceSource());

/// Implementación real: GPS (geolocator) + ID de dispositivo (device_info_plus).
/// Si no hay permiso/señal GPS, devuelve la última posición conocida o
/// precisión infinita (⇒ `verified == false`) sin bloquear la operación offline.
class DeviceEvidenceSource implements EvidenceSource {
  String? _id;

  Future<String> _deviceId() async {
    if (_id != null) return _id!;
    final info = DeviceInfoPlugin();
    try {
      if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
        final a = await info.androidInfo;
        _id = 'AND-${a.id}';
      } else if (!kIsWeb && defaultTargetPlatform == TargetPlatform.iOS) {
        final i = await info.iosInfo;
        _id = 'IOS-${i.identifierForVendor ?? 'unknown'}';
      }
    } catch (_) {}
    return _id ??= 'DEV-UNKNOWN';
  }

  @override
  Future<EvidenceStamp> capture() async {
    final id = await _deviceId();
    try {
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        throw const PermissionDeniedException('location');
      }
      final pos = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
        timeLimit: const Duration(seconds: 8),
      );
      return EvidenceStamp(
        timestamp: DateTime.now(),
        deviceId: id,
        latitude: pos.latitude,
        longitude: pos.longitude,
        accuracyMeters: pos.accuracy,
      );
    } catch (_) {
      final last = await Geolocator.getLastKnownPosition().catchError((_) => null);
      return EvidenceStamp(
        timestamp: DateTime.now(),
        deviceId: id,
        latitude: last?.latitude ?? 0,
        longitude: last?.longitude ?? 0,
        accuracyMeters: last?.accuracy ?? double.infinity,
      );
    }
  }
}
