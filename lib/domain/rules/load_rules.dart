import '../entities.dart';
import '../errors.dart';

/// Regla: no se confirma carga con productos sin contar, diferencias sin
/// motivo o kilometraje menor al odómetro registrado del vehículo.
void validateLoad(List<LoadLine> lines, {required int? startKm, required int odometerKm}) {
  if (lines.isEmpty) throw const DomainException('load.empty', 'La jornada no tiene carga asignada.');
  final pending = lines.where((l) => l.pending).length;
  if (pending > 0) throw DomainException('load.pending', 'Faltan $pending producto(s) por contar.');
  final noReason = lines.where((l) => l.hasDiff && !(l.reason?.trim().isNotEmpty ?? false)).length;
  if (noReason > 0) throw DomainException('load.reason', '$noReason diferencia(s) sin motivo.');
  if (lines.any((l) => (l.countedQty ?? 0) < 0)) throw const DomainException('load.negative', 'Cantidades negativas no permitidas.');
  if (startKm == null) throw const DomainException('load.km', 'Captura el kilometraje inicial.');
  if (startKm < odometerKm) {
    throw DomainException('load.km', 'El kilometraje ($startKm) no puede ser menor al último registrado ($odometerKm).');
  }
}
