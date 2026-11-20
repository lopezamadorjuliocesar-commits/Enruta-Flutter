import '../enums.dart';
import '../errors.dart';

class DeliveryLineInput {
  const DeliveryLineInput({required this.productId, required this.orderedQty, required this.deliveredQty, required this.unitPriceCents, this.reason});
  final String productId;
  final int orderedQty, deliveredQty, unitPriceCents;
  final String? reason;
  bool get hasDiff => deliveredQty != orderedQty;
  int get totalCents => deliveredQty * unitPriceCents;

  DeliveryLineInput copyWith({int? deliveredQty, String? reason, bool clearReason = false}) => DeliveryLineInput(
        productId: productId,
        orderedQty: orderedQty,
        deliveredQty: deliveredQty ?? this.deliveredQty,
        unitPriceCents: unitPriceCents,
        reason: clearReason ? null : (reason ?? this.reason),
      );

  Map<String, Object?> toJson() =>
      {'product_id': productId, 'ordered': orderedQty, 'delivered': deliveredQty, 'price': unitPriceCents, 'reason': reason};
  factory DeliveryLineInput.fromJson(Map<String, Object?> j) => DeliveryLineInput(
      productId: j['product_id']! as String,
      orderedQty: j['ordered']! as int,
      deliveredQty: j['delivered']! as int,
      unitPriceCents: j['price']! as int,
      reason: j['reason'] as String?);
}

class ReturnInput {
  const ReturnInput({required this.productId, required this.qty, required this.reason, required this.condition, required this.unitPriceCents});
  final String productId, reason;
  final int qty, unitPriceCents;
  final ItemCondition condition;
  int get creditCents => qty * unitPriceCents;

  Map<String, Object?> toJson() =>
      {'product_id': productId, 'qty': qty, 'reason': reason, 'condition': condition.name, 'price': unitPriceCents};
  factory ReturnInput.fromJson(Map<String, Object?> j) => ReturnInput(
      productId: j['product_id']! as String,
      qty: j['qty']! as int,
      reason: j['reason']! as String,
      condition: byName(ItemCondition.values, j['condition']),
      unitPriceCents: j['price']! as int);
}

const minPhotos = 1;
const maxPhotos = 3;

/// Reglas de la entrega, aplicadas también en el repositorio (no solo en la UI).
void validateDeliveryLines(List<DeliveryLineInput> lines, List<ReturnInput> returns, Map<String, int> available) {
  if (lines.isEmpty) throw const DomainException('delivery.empty', 'La entrega no tiene productos.');
  if (lines.any((l) => l.deliveredQty < 0)) throw const DomainException('delivery.negative', 'Cantidad negativa no permitida.');
  if (lines.every((l) => l.deliveredQty == 0)) {
    throw const DomainException('delivery.zero', 'No se entrega ningún producto: registra una no entrega.');
  }
  for (final l in lines) {
    if (l.hasDiff && (l.reason == null || l.reason!.trim().isEmpty)) {
      throw const DomainException('delivery.reason', 'Indica el motivo de cada diferencia.');
    }
  }
  final need = <String, int>{};
  for (final l in lines) {
    need[l.productId] = (need[l.productId] ?? 0) + l.deliveredQty;
  }
  for (final e in need.entries) {
    final have = available[e.key] ?? 0;
    if (e.value > have) {
      throw DomainException('delivery.stock', 'Existencia insuficiente en la unidad: se requieren ${e.value} y hay $have.');
    }
  }
  for (final r in returns) {
    if (r.qty <= 0) throw const DomainException('return.qty', 'La devolución debe tener cantidad mayor a cero.');
    if (r.reason.trim().isEmpty) throw const DomainException('return.reason', 'Indica el motivo de la devolución.');
  }
}

void validateEvidence({required int photos, required bool hasSignature, required String receiver}) {
  if (photos < minPhotos) throw const DomainException('evidence.photo', 'Toma al menos una fotografía.');
  if (photos > maxPhotos) throw const DomainException('evidence.photo', 'Máximo $maxPhotos fotografías.');
  if (!hasSignature) throw const DomainException('evidence.signature', 'Falta la firma de quien recibe.');
  if (receiver.trim().length < 3) throw const DomainException('evidence.receiver', 'Captura el nombre de quien recibe.');
}

StopStatus outcomeFor(List<DeliveryLineInput> lines) =>
    lines.any((l) => l.deliveredQty < l.orderedQty) ? StopStatus.partial : StopStatus.delivered;
