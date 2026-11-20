import '../errors.dart';

class ClosingInput {
  const ClosingInput({
    required this.cashExpectedCents,
    required this.cashDeclaredCents,
    required this.toleranceCents,
    required this.inventoryDiffs,
    required this.pendingStops,
    required this.justification,
    required this.exceptionalReason,
    required this.startKm,
    required this.endKm,
  });
  final int cashExpectedCents, cashDeclaredCents, toleranceCents, inventoryDiffs, pendingStops, startKm;
  final int? endKm;
  final String justification, exceptionalReason;

  /// Positivo = sobrante; negativo = faltante.
  int get cashDiffCents => cashDeclaredCents - cashExpectedCents;
  bool get overTolerance => cashDiffCents.abs() > toleranceCents;
  bool get needsJustification => overTolerance || inventoryDiffs > 0;
  bool get needsExceptional => pendingStops > 0;
}

const minJustification = 10;

/// Reglas del corte: tolerancia de efectivo, diferencias de inventario,
/// paradas pendientes (cierre excepcional) y kilometraje final.
List<String> closingProblems(ClosingInput i) => [
      if (i.endKm == null) 'Captura el kilometraje final.',
      if (i.endKm != null && i.endKm! < i.startKm) 'El kilometraje final no puede ser menor al inicial (${i.startKm}).',
      if (i.cashDeclaredCents < 0) 'El efectivo declarado no puede ser negativo.',
      if (i.needsJustification && i.justification.trim().length < minJustification)
        'Justifica las diferencias (mín. $minJustification caracteres).',
      if (i.needsExceptional && i.exceptionalReason.trim().length < minJustification)
        'Hay ${i.pendingStops} parada(s) pendiente(s): resuélvelas o justifica un cierre excepcional.',
    ];

void validateClosing(ClosingInput i) {
  final p = closingProblems(i);
  if (p.isNotEmpty) throw DomainException('closing.invalid', p.first);
}
