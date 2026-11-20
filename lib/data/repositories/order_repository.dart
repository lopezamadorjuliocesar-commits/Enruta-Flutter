import 'package:sqflite/sqflite.dart';

import '../../core/utils/dates.dart';
import '../../core/utils/ids.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../domain/errors.dart';
import '../../domain/rules/credit_rules.dart';
import '../db/app_database.dart';
import '../db/mappers.dart';
import '../db/queries.dart';

class CartLine {
  const CartLine(this.product, this.qty);
  final Product product;
  final int qty;
  int get totalCents => product.priceCents * qty;
}

/// Pedidos (cliente y preventa), carrito persistente y asignación local a jornadas.
class OrderRepository {
  OrderRepository(this._d);
  final AppDatabase _d;
  Database get _db => _d.db;

  static const _orderSelect = '''
    SELECT o.*, c.name AS customer_name, a.line AS addr_line, a.city AS addr_city
    FROM orders o JOIN customers c ON c.id = o.customer_id JOIN addresses a ON a.id = o.address_id''';

  Order _fromRow(Row r, {List<OrderItem> items = const [], List<OrderEvent> events = const []}) => Order(
        id: r['id']! as String,
        folio: r['folio']! as String,
        customerId: r['customer_id']! as String,
        customerName: r['customer_name']! as String,
        addressId: r['address_id']! as String,
        addressText: [r['addr_line'], r['addr_city']].where((e) => (e as String?)?.isNotEmpty ?? false).join(', '),
        source: byName(OrderSource.values, r['source']),
        status: byName(OrderStatus.values, r['status']),
        notes: r['notes']! as String,
        totalCents: r['total_cents']! as int,
        createdAt: fromMs(r['created_at']! as int),
        workdayId: r['workday_id'] as String?,
        stopId: r['stop_id'] as String?,
        items: items,
        events: events,
      );

  Future<List<Order>> ordersForCustomer(String customerId) async {
    final r = await _db.rawQuery('$_orderSelect WHERE o.customer_id = ? ORDER BY o.created_at DESC', [customerId]);
    return [for (final e in r) _fromRow(e, items: await orderItems(_db, e['id']! as String))];
  }

  Future<Order?> orderById(String id) async {
    final r = await _db.rawQuery('$_orderSelect WHERE o.id = ?', [id]);
    if (r.isEmpty) return null;
    final ev = await _db.query('order_events', where: 'order_id = ?', whereArgs: [id], orderBy: 'created_at');
    return _fromRow(r.first,
        items: await orderItems(_db, id),
        events: [
          for (final e in ev) OrderEvent(byName(OrderStatus.values, e['status']), e['note']! as String, fromMs(e['created_at']! as int))
        ]);
  }

  /// Pedidos recibidos que aún no tienen jornada (para planeación local).
  Future<List<Order>> unassignedOrders(String companyId) async {
    final r = await _db.rawQuery("$_orderSelect WHERE o.company_id = ? AND o.status = 'submitted' ORDER BY o.created_at", [companyId]);
    return [for (final e in r) _fromRow(e, items: await orderItems(_db, e['id']! as String))];
  }

  Future<List<Order>> ordersForWorkday(String workdayId) async {
    final r = await _db.rawQuery('$_orderSelect WHERE o.workday_id = ? ORDER BY o.created_at', [workdayId]);
    return [for (final e in r) _fromRow(e, items: await orderItems(_db, e['id']! as String))];
  }

  Future<({int balance, int openOrders})> creditUsage(String customerId) async =>
      (balance: await customerBalance(_db, customerId), openOrders: await openOrdersTotal(_db, customerId));

  /// Crea un pedido con precios vigentes del catálogo. Idempotente por [idempotencyKey]:
  /// repetir la llamada devuelve el mismo pedido sin duplicarlo.
  Future<String> createOrder({
    required Customer customer,
    required String addressId,
    required Map<String, int> quantities,
    required OrderSource source,
    required String createdBy,
    required String idempotencyKey,
    String notes = '',
    String? clearCartOfUser,
  }) async {
    final existing = await _db.query('orders', columns: ['id'], where: 'idempotency_key = ?', whereArgs: [idempotencyKey]);
    if (existing.isNotEmpty) return existing.first['id']! as String;
    final qty = {for (final e in quantities.entries) if (e.value != 0) e.key: e.value};
    checkQuantities(qty.isEmpty ? quantities : qty);
    final id = newId();
    await _d.tx((t) async {
      final addr = await t.query('addresses', where: 'id = ? AND customer_id = ?', whereArgs: [addressId, customer.id]);
      if (addr.isEmpty) throw const DomainException('order.address', 'Selecciona un domicilio de entrega válido.');
      final products = await productsByIds(t, qty.keys);
      if (products.length != qty.length || products.values.any((p) => !p.active)) {
        throw const DomainException('order.product', 'Hay productos que ya no están disponibles.');
      }
      final total = qty.entries.fold<int>(0, (a, e) => a + products[e.key]!.priceCents * e.value);
      checkCredit(customer,
          balanceCents: await customerBalance(t, customer.id),
          openOrdersCents: await openOrdersTotal(t, customer.id),
          orderTotalCents: total);
      final folio = await AppDatabase.nextFolio(t, 'PED');
      await t.insert('orders', {
        'id': id,
        'company_id': customer.companyId,
        'folio': folio,
        'customer_id': customer.id,
        'address_id': addressId,
        'source': source.name,
        'status': OrderStatus.submitted.name,
        'notes': notes.trim(),
        'total_cents': total,
        'created_by': createdBy,
        'created_at': _d.nowMs(),
        'idempotency_key': idempotencyKey,
      });
      for (final e in qty.entries) {
        await t.insert('order_items', {
          'id': newId(),
          'order_id': id,
          'product_id': e.key,
          'qty': e.value,
          'unit_price_cents': products[e.key]!.priceCents,
        });
      }
      await addOrderEvent(t, id, OrderStatus.submitted,
          source == OrderSource.presale ? 'Preventa capturada en ruta' : 'Pedido recibido', _d.nowMs());
      if (clearCartOfUser != null) await t.delete('cart_items', where: 'user_id = ?', whereArgs: [clearCartOfUser]);
      await _d.log(t, createdBy, 'order.create', 'order', id, {'folio': folio, 'total': total});
      await _d.enqueue(t, entity: 'order', type: 'order.create', idempotencyKey: 'order:$idempotencyKey', payload: {
        'order_id': id,
        'folio': folio,
        'customer_id': customer.id,
        'address_id': addressId,
        'source': source.name,
        'notes': notes.trim(),
        'items': [for (final e in qty.entries) {'product_id': e.key, 'qty': e.value, 'unit_price_cents': products[e.key]!.priceCents}],
        'total_cents': total,
      });
    });
    return id;
  }

  Future<void> cancelOrder(String orderId, String actorId) async {
    await _d.tx((t) async {
      final n = await t.update('orders', {'status': OrderStatus.cancelled.name},
          where: 'id = ? AND status = ?', whereArgs: [orderId, OrderStatus.submitted.name]);
      if (n == 0) {
        throw const DomainException('order.cancel', 'Solo se pueden cancelar pedidos que aún no se programan para reparto.');
      }
      await addOrderEvent(t, orderId, OrderStatus.cancelled, 'Cancelado por el cliente', _d.nowMs());
      await _d.log(t, actorId, 'order.cancel', 'order', orderId);
      await _d.enqueue(t,
          entity: 'order', type: 'order.cancel', idempotencyKey: 'order.cancel:$orderId', payload: {'order_id': orderId}, dependsOn: null);
    });
  }

  // ───────── Carrito persistente ─────────

  Future<List<CartLine>> cart(String userId) async {
    final r = await _db.rawQuery('''
      SELECT ci.qty, ${cols('p', 'p_', productCols)} FROM cart_items ci JOIN products p ON p.id = ci.product_id
      WHERE ci.user_id = ? ORDER BY p.name''', [userId]);
    return [for (final e in r) CartLine(productFromRow(e, prefix: 'p_'), e['qty']! as int)];
  }

  Future<void> setCartQty(String userId, String productId, int qty) async {
    if (qty < 0 || qty > 999) throw const DomainException('cart.qty', 'Cantidad válida: 0 a 999.');
    await _d.tx((t) async {
      if (qty == 0) {
        await t.delete('cart_items', where: 'user_id = ? AND product_id = ?', whereArgs: [userId, productId]);
      } else {
        await t.insert('cart_items', {'user_id': userId, 'product_id': productId, 'qty': qty},
            conflictAlgorithm: ConflictAlgorithm.replace);
      }
    });
  }

  Future<void> clearCart(String userId) => _d.tx((t) => t.delete('cart_items', where: 'user_id = ?', whereArgs: [userId]));

  Future<String?> cartNotes(String userId) => _d.getSetting('cart.notes.$userId');
  Future<void> setCartNotes(String userId, String notes) => _d.setSetting('cart.notes.$userId', notes);

  // ───────── Planeación local (asignación a jornada) ─────────

  /// Regla explícita: solo se asignan pedidos “recibidos” a una jornada en
  /// estado “planeada” (antes de confirmar la carga). Crea una parada y suma
  /// las partidas a la carga esperada.
  Future<void> assignToWorkday(String orderId, String workdayId, String actorId) async {
    await _d.tx((t) async {
      final w = await t.query('workdays', where: 'id = ?', whereArgs: [workdayId]);
      if (w.isEmpty || w.first['status'] != WorkdayStatus.planned.name) {
        throw const DomainException('assign.workday', 'Solo se asignan pedidos a jornadas planeadas (antes de confirmar carga).');
      }
      final o = await t.query('orders', where: 'id = ?', whereArgs: [orderId]);
      if (o.isEmpty || o.first['status'] != OrderStatus.submitted.name) {
        throw const DomainException('assign.order', 'El pedido ya no está disponible para asignar.');
      }
      if (o.first['company_id'] != w.first['company_id']) throw const DomainException('assign.company', 'Empresa distinta.');
      final seqRow = await t.rawQuery('SELECT COALESCE(MAX(seq),0) AS m FROM stops WHERE workday_id = ?', [workdayId]);
      final stopId = newId();
      await t.insert('stops', {
        'id': stopId,
        'workday_id': workdayId,
        'customer_id': o.first['customer_id'],
        'address_id': o.first['address_id'],
        'order_id': orderId,
        'seq': (seqRow.first['m'] as num).toInt() + 1,
        'status': StopStatus.pending.name,
      });
      for (final i in await orderItems(t, orderId)) {
        final upd = await t.rawUpdate(
            'UPDATE load_lines SET expected_qty = expected_qty + ? WHERE workday_id = ? AND product_id = ?', [i.qty, workdayId, i.product.id]);
        if (upd == 0) {
          await t.insert('load_lines', {'id': newId(), 'workday_id': workdayId, 'product_id': i.product.id, 'expected_qty': i.qty});
        }
      }
      await t.update('orders', {'status': OrderStatus.assigned.name, 'workday_id': workdayId, 'stop_id': stopId},
          where: 'id = ?', whereArgs: [orderId]);
      await addOrderEvent(t, orderId, OrderStatus.assigned, 'Programado en ruta ${w.first['route_code']} (${w.first['service_date']})', _d.nowMs());
      await _d.log(t, actorId, 'order.assign', 'order', orderId, {'workday': workdayId});
      await _d.enqueue(t,
          entity: 'order',
          type: 'order.assign',
          idempotencyKey: 'order.assign:$orderId:$workdayId',
          payload: {'order_id': orderId, 'workday_id': workdayId, 'stop_id': stopId},
          dependsOn: 'order:${o.first['idempotency_key']}');
    });
  }

  /// Revierte la asignación mientras la jornada siga planeada.
  Future<void> unassign(String orderId, String actorId) async {
    await _d.tx((t) async {
      final o = await t.query('orders', where: 'id = ?', whereArgs: [orderId]);
      if (o.isEmpty || o.first['status'] != OrderStatus.assigned.name) {
        throw const DomainException('unassign.order', 'El pedido no está programado.');
      }
      final workdayId = o.first['workday_id']! as String;
      final w = await t.query('workdays', where: 'id = ?', whereArgs: [workdayId]);
      if (w.first['status'] != WorkdayStatus.planned.name) {
        throw const DomainException('unassign.workday', 'La carga ya fue confirmada: no se puede quitar el pedido.');
      }
      for (final i in await orderItems(t, orderId)) {
        await t.rawUpdate('UPDATE load_lines SET expected_qty = expected_qty - ?, counted_qty = NULL, reason = NULL WHERE workday_id = ? AND product_id = ?',
            [i.qty, workdayId, i.product.id]);
      }
      await t.delete('load_lines', where: 'workday_id = ? AND expected_qty <= 0', whereArgs: [workdayId]);
      await t.delete('stops', where: 'id = ?', whereArgs: [o.first['stop_id']]);
      await t.update('orders', {'status': OrderStatus.submitted.name, 'workday_id': null, 'stop_id': null}, where: 'id = ?', whereArgs: [orderId]);
      await addOrderEvent(t, orderId, OrderStatus.submitted, 'Retirado de la ruta; pendiente de programar', _d.nowMs());
      await _d.log(t, actorId, 'order.unassign', 'order', orderId);
      await _d.enqueue(t,
          entity: 'order',
          type: 'order.unassign',
          idempotencyKey: 'order.unassign:$orderId:${_d.nowMs()}',
          payload: {'order_id': orderId, 'workday_id': workdayId});
    });
  }
}
