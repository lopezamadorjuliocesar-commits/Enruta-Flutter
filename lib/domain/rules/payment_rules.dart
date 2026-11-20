import '../entities.dart';
import '../enums.dart';
import '../errors.dart';

class Allocation {
  const Allocation(this.receivableId, this.amountCents);
  final String receivableId;
  final int amountCents;
}

/// Distribuye un importe sobre documentos con saldo positivo, del vencimiento
/// más antiguo al más reciente. Devuelve aplicaciones y remanente sin aplicar.
({List<Allocation> applications, int leftover}) allocate(int amountCents, List<Receivable> docs) {
  final sorted = docs.where((d) => d.balanceCents > 0).toList()
    ..sort((a, b) {
      final c = a.dueAt.compareTo(b.dueAt);
      return c != 0 ? c : a.issuedAt.compareTo(b.issuedAt);
    });
  var rest = amountCents;
  final out = <Allocation>[];
  for (final d in sorted) {
    if (rest <= 0) break;
    final take = rest < d.balanceCents ? rest : d.balanceCents;
    out.add(Allocation(d.id, take));
    rest -= take;
  }
  return (applications: out, leftover: rest);
}

class PaymentPlan {
  const PaymentPlan({required this.appliedCents, required this.receivedCents, required this.changeCents});
  final int appliedCents, receivedCents, changeCents;
}

/// Calcula lo aplicado y el cambio.
/// - Efectivo: se aplica min(recibido, total seleccionado) y el excedente es cambio.
/// - Transferencia/tarjeta: el importe no puede exceder lo seleccionado y exige referencia.
PaymentPlan planPayment({
  required PaymentMethod method,
  required int selectedTotalCents,
  required int enteredCents,
  required String reference,
}) {
  if (selectedTotalCents <= 0) throw const DomainException('payment.docs', 'Selecciona al menos un documento con saldo.');
  if (enteredCents <= 0) throw const DomainException('payment.amount', 'Captura el importe recibido.');
  switch (method) {
    case PaymentMethod.cash:
      final applied = enteredCents < selectedTotalCents ? enteredCents : selectedTotalCents;
      return PaymentPlan(appliedCents: applied, receivedCents: enteredCents, changeCents: enteredCents - applied);
    case PaymentMethod.transfer:
    case PaymentMethod.card:
      if (enteredCents > selectedTotalCents) {
        throw const DomainException('payment.over', 'El importe excede el saldo seleccionado (no hay cambio en pagos electrónicos).');
      }
      final ref = reference.trim();
      final minLen = method == PaymentMethod.transfer ? 6 : 4;
      if (ref.length < minLen) {
        throw DomainException('payment.reference',
            method == PaymentMethod.transfer ? 'Captura la referencia o clave de rastreo (mín. 6).' : 'Captura el número de autorización (mín. 4).');
      }
      return PaymentPlan(appliedCents: enteredCents, receivedCents: enteredCents, changeCents: 0);
    case PaymentMethod.creditNote:
      throw const DomainException('payment.method', 'Método no permitido para cobro.');
  }
}
