import '../entities.dart';
import '../errors.dart';

/// Crédito disponible = límite − saldo − pedidos activos no entregados.
int availableCredit({required int limitCents, required int balanceCents, required int openOrdersCents}) =>
    limitCents - balanceCents - openOrdersCents;

/// Regla: clientes con crédito no pueden exceder el disponible.
/// Clientes de contado (límite 0) pagan contra entrega: no se valida crédito.
void checkCredit(Customer c, {required int balanceCents, required int openOrdersCents, required int orderTotalCents}) {
  if (orderTotalCents <= 0) throw const DomainException('order.empty', 'Agrega al menos un producto.');
  if (!c.hasCredit) return;
  final avail = availableCredit(limitCents: c.creditLimitCents, balanceCents: balanceCents, openOrdersCents: openOrdersCents);
  if (orderTotalCents > avail) {
    throw const DomainException('order.credit', 'El pedido excede el crédito disponible.');
  }
}

void checkQuantities(Map<String, int> qty) {
  if (qty.values.any((q) => q < 0 || q > 999)) {
    throw const DomainException('order.qty', 'Cantidades válidas: 1 a 999 por producto.');
  }
  if (qty.values.every((q) => q == 0)) throw const DomainException('order.empty', 'Agrega al menos un producto.');
}
