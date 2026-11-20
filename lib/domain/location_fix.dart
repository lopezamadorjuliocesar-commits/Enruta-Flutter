import '../core/utils/dates.dart';

enum FixKind {
  current('Ubicación actual'),
  lastKnown('Última ubicación conocida'),
  unavailable('Ubicación no disponible');

  const FixKind(this.label);
  final String label;
}

/// Ubicación obtenida para evidencia o llegada. Nunca usa precisión infinita:
/// si no hay dato, los campos son null y [kind] lo indica.
class LocationFix {
  const LocationFix({
    required this.kind,
    required this.capturedAt,
    this.latitude,
    this.longitude,
    this.accuracyMeters,
    this.positionAt,
    this.reason,
  });

  const LocationFix.unavailable(this.capturedAt, this.reason)
      : kind = FixKind.unavailable,
        latitude = null,
        longitude = null,
        accuracyMeters = null,
        positionAt = null;

  final FixKind kind;
  final DateTime capturedAt;
  final double? latitude, longitude, accuracyMeters;

  /// Momento en que el sistema obtuvo la posición (puede ser antiguo).
  final DateTime? positionAt;
  final String? reason;

  bool get hasPosition => latitude != null && longitude != null;
  Duration? get age => positionAt == null ? null : capturedAt.difference(positionAt!);

  /// Descripción honesta: tipo, precisión y antigüedad.
  String describe() {
    if (!hasPosition) return '${kind.label}${reason == null ? '' : ' · $reason'}';
    final acc = accuracyMeters == null || !accuracyMeters!.isFinite ? 'precisión desconocida' : '±${accuracyMeters!.round()} m';
    final a = age == null ? '' : ' · ${ago(age!)}';
    return '${kind.label} · $acc$a';
  }

  Map<String, Object?> toJson() => {
        'kind': kind.name,
        'lat': latitude,
        'lng': longitude,
        'acc': accuracyMeters != null && accuracyMeters!.isFinite ? accuracyMeters : null,
        'position_at': positionAt?.toIso8601String(),
        'captured_at': capturedAt.toIso8601String(),
        'reason': reason,
      };
}
