import 'package:sqflite/sqflite.dart';

import '../../core/utils/ids.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import 'mappers.dart';

/// Consultas compartidas entre repositorios (aceptan transacción o base).

Future<int> customerBalance(DatabaseExecutor ex, String customerId) async {
  final r = await ex.rawQuery('SELECT COALESCE(SUM(balance_cents),0) AS b FROM receivables WHERE customer_id = ?', [customerId]);
  return (r.first['b'] as num).toInt();
}

Future<int> openOrdersTotal(DatabaseExecutor ex, String customerId, {String? excludeOrderId}) async {
  final r = await ex.rawQuery(
      "SELECT COALESCE(SUM(total_cents),0) AS t FROM orders WHERE customer_id = ? AND status IN ('submitted','assigned','inRoute') AND id <> ?",
      [customerId, excludeOrderId ?? '']);
  return (r.first['t'] as num).toInt();
}

Future<void> addOrderEvent(DatabaseExecutor ex, String orderId, OrderStatus status, String note, int atMs) => ex.insert('order_events', {
      'id': newId(),
      'order_id': orderId,
      'status': status.name,
      'note': note,
      'created_at': atMs,
    });

/// Existencia disponible en la unidad por producto (movimientos de inventario).
Future<Map<String, int>> availableStock(DatabaseExecutor ex, String workdayId) async {
  final r = await ex.rawQuery('''
    SELECT product_id,
      SUM(CASE type WHEN 'load' THEN qty WHEN 'delivery' THEN -qty WHEN 'returnSellable' THEN qty ELSE 0 END) AS avail
    FROM inventory_movements WHERE workday_id = ? GROUP BY product_id''', [workdayId]);
  return {for (final e in r) e['product_id']! as String: (e['avail'] as num).toInt()};
}

Future<Map<String, Product>> productsByIds(DatabaseExecutor ex, Iterable<String> ids) async {
  final list = ids.toSet().toList();
  if (list.isEmpty) return {};
  final r = await ex.query('products', where: 'id IN (${List.filled(list.length, '?').join(',')})', whereArgs: list);
  return {for (final p in r.map(productFromRow)) p.id: p};
}

Future<List<OrderItem>> orderItems(DatabaseExecutor ex, String orderId) async {
  final r = await ex.rawQuery('''
    SELECT oi.id AS oi_id, oi.qty, oi.unit_price_cents, ${cols('p', 'p_', productCols)}
    FROM order_items oi JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ? ORDER BY p.name''', [orderId]);
  return [
    for (final e in r)
      OrderItem(
          id: e['oi_id']! as String,
          product: productFromRow(e, prefix: 'p_'),
          qty: e['qty']! as int,
          unitPriceCents: e['unit_price_cents']! as int)
  ];
}
