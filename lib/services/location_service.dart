import 'dart:async';

import 'package:geolocator/geolocator.dart';

import '../domain/location_fix.dart';

/// Ubicación del dispositivo con resultado honesto: actual, última conocida
/// (con su antigüedad) o no disponible. Nunca bloquea indefinidamente.
abstract interface class LocationService {
  Future<LocationFix> capture({bool request = true, Duration timeout = const Duration(seconds: 10)});
  Stream<LocationFix> watch({int distanceFilterMeters = 50});
}

class GeolocatorLocationService implements LocationService {
  const GeolocatorLocationService();

  LocationFix _fromPosition(Position p, FixKind kind) => LocationFix(
        kind: kind,
        capturedAt: DateTime.now(),
        latitude: p.latitude,
        longitude: p.longitude,
        accuracyMeters: p.accuracy.isFinite && p.accuracy > 0 ? p.accuracy : null,
        positionAt: p.timestamp.toLocal(),
      );

  Future<LocationFix?> _lastKnown() async {
    try {
      final p = await Geolocator.getLastKnownPosition();
      return p == null ? null : _fromPosition(p, FixKind.lastKnown);
    } on Exception {
      return null;
    }
  }

  @override
  Future<LocationFix> capture({bool request = true, Duration timeout = const Duration(seconds: 10)}) async {
    final now = DateTime.now();
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        return await _lastKnown() ?? LocationFix.unavailable(now, 'GPS desactivado');
      }
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied && request) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied) return LocationFix.unavailable(now, 'Permiso de ubicación denegado');
      if (perm == LocationPermission.deniedForever) {
        return LocationFix.unavailable(now, 'Permiso de ubicación denegado permanentemente');
      }
      final p = await Geolocator.getCurrentPosition(
        locationSettings: LocationSettings(accuracy: LocationAccuracy.high, timeLimit: timeout),
      );
      // Algunas plataformas devuelven una posición en caché: se clasifica por antigüedad real.
      final fix = _fromPosition(p, FixKind.current);
      if ((fix.age ?? Duration.zero) > const Duration(minutes: 2)) {
        return _fromPosition(p, FixKind.lastKnown);
      }
      return fix;
    } on TimeoutException {
      return await _lastKnown() ?? LocationFix.unavailable(now, 'Sin señal GPS');
    } on Exception catch (_) {
      return await _lastKnown() ?? LocationFix.unavailable(now, 'Ubicación no disponible');
    }
  }

  @override
  Stream<LocationFix> watch({int distanceFilterMeters = 50}) => Geolocator.getPositionStream(
        locationSettings: LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: distanceFilterMeters),
      ).map((p) => _fromPosition(p, FixKind.current));
}
