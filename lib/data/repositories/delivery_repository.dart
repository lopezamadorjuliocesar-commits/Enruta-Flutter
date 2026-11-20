import 'dart:convert';
import 'dart:typed_data';

import 'package:sqflite/sqflite.dart';

import '../../core/utils/dates.dart';
import '../../core/utils/ids.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../domain/errors.dart';
import '../../domain/location_fix.dart';
import '../../domain/rules/delivery_rules.dart';
import '../db/app_database.dart';
import '../db/mappers.dart';
import '../db/queries.dart';
import 'evidence_repository.dart';
import 'finance_repository.dart';

/// Borrador persistente de una entrega (sobrevive a reinicios de la app).
class DeliveryDraft {
  const DeliveryDraft({this.lines = const [], this.returns = const [], this.receiver = '', this.notes = ''});
  final List<DeliveryLineInput> lines;
  final List<ReturnInput> returns;
  final String receiver, notes;

  int get totalCents => lines.fold(0, (a, l) => a + l.totalCents);
  int get returnsCreditCents => returns.fold(0, (a, r) => a + r.creditCents);
  bool get linesResolved => lines.every((l) => !l.hasDiff || (l.reason?.trim().isNotEmpty ?? false));

  DeliveryDraft copyWith({List<DeliveryLineInput>? lines, List<ReturnInput>? returns, String? receiver, String? notes}) =>
      DeliveryDraft(lines: lines ?? this.lines, returns: returns ?? this.returns, receiver: receiver ?? this.receiver, notes: notes ?? this.notes);

  String encode() => jsonEncode({
        'lines': [for (final l in lines) l.toJson()],
        'returns': [for (final r in returns) r.toJson()],
        'receiver': receiver,
        'notes': notes,
      });

  factory DeliveryDraft.decode(String s) {
    final j = jsonDecode(s) as Map<String, dynamic>;
    return DeliveryDraft(
      lines: [for (final l in j['lines'] as List) DeliveryLineInput.fromJson(Map<String, Object?>.from(l as Map))],
      returns: [for (final r in j['returns'] as List) ReturnInput.fromJson(Map<String, Object?>.from(r as Map))],
      receiver: j['receiver'] as String? ?? '',
      notes: j['notes'] as String? ?? '',
    );
  }
}

/// Clave de borrador de evidencias por parada (independiente de la “parada actual”).
String deliveryDraftKey(String stopId) => 'delivery:$stopId';
String failureDraftKey(String stopId) => 'failed:$stopId';

class DeliveryRepository {
  DeliveryRepository(this._d, this._evidence);
  final AppDatabase _d;
  final EvidenceRepository _evidence;
  Database get _db => _d.db;

  // ───────── Borradores ─────────

  /// Borrador guardado, o uno nuevo construido a partir del pedido de la parada.
  Future<DeliveryDraft> loadDraft(String stopId) async {
    final r = await _db.query('delivery_drafts', where: 'stop_id = ?', whereArgs: [stopId]);
    if (r.isNotEmpty) return DeliveryDraft.decode(r.first['payload']! as String);
    final s = await _db.query('stops', columns: ['order_id'], where: 'id = ?', whereArgs: [stopId]);
    final orderId = s.isEmpty ? null : s.first['order_id'] as String?;
    if (orderId == null) return const DeliveryDraft();
    final items = await orderItems(_db, orderId);
    return DeliveryDraft(lines: [
      for (final i in items) DeliveryLineInput(productId: i.product.id, orderedQty: i.qty, deliveredQty: i.qty, unitPriceCents: i.unitPriceCents)
    ]);
  }

  Future<bool> hasDraft(String stopId) async =>
      (await _db.query('delivery_drafts', columns: ['stop_id'], where: 'stop_id = ?', whereArgs: [stopId])).isNotEmpty;

  /// Guarda el borrador solo mientras la parada siga pendiente (una pantalla
  /// que se cierra después de confirmar no debe recrear un borrador obsoleto).
  Future<void> saveDraft(String stopId, DeliveryDraft draft) => _d.tx((t) async {
        final s = await t.query('stops', columns: ['status'], where: 'id = ?', whereArgs: [stopId]);
        if (s.isEmpty || s.first['status'] != StopStatus.pending.name) return;
        await t.insert('delivery_drafts', {'stop_id': stopId, 'payload': draft.encode(), 'updated_at': _d.nowMs()},
            conflictAlgorithm: ConflictAlgorithm.replace);
      });

  Future<void> discardDraft(String stopId) async {
    await _d.tx((t) => t.delete('delivery_drafts', where: 'stop_id = ?', whereArgs: [stopId]));
    await _evidence.discardDrafts(deliveryDraftKey(stopId));
  }

  // ───────── Confirmación ─────────

  Future<Map<String, Object?>> _openStop(DatabaseExecutor ex, String stopId) async {
    final s = await ex.rawQuery('''
      SELECT s.*, w.status AS w_status, c.payment_terms_days FROM stops s
      JOIN workdays w ON w.id = s.workday_id JOIN customers c ON c.id = s.customer_id WHERE s.id = ?''', [stopId]);
    if (s.isEmpty) throw const DomainException('stop.none', 'Parada no encontrada.');
    if (s.first['w_status'] != WorkdayStatus.inRoute.name) throw const DomainException('stop.workday', 'La jornada no está en ruta.');
    if (s.first['status'] != StopStatus.pending.name) throw const DomainException('stop.closed', 'La parada ya fue atendida.');
    return s.first;
  }

  Future<String?> deliveryIdForStop(String stopId) async {
    final r = await _db.query('deliveries', columns: ['id'], where: 'stop_id = ?', whereArgs: [stopId]);
    return r.isEmpty ? null : r.first['id']! as String;
  }

  /// Confirma la entrega de forma atómica: entrega, partidas, devoluciones,
  /// movimientos de inventario, documento por cobrar, nota de crédito, estado
  /// de parada y pedido, evidencias y operación de sincronización.
  /// Idempotente: una parada solo puede tener una entrega.
  Future<String> confirmDelivery({
    required String stopId,
    required DeliveryDraft draft,
    required Uint8List? signaturePng,
    required LocationFix fix,
    required String deviceId,
    required String actorId,
  }) async {
    final already = await deliveryIdForStop(stopId);
    if (already != null) return already;
    final stop = await _openStop(_db, stopId);
    final workdayId = stop['workday_id']! as String;
    validateDeliveryLines(draft.lines, draft.returns, await availableStock(_db, workdayId));
    final photos = await _evidence.drafts(deliveryDraftKey(stopId));
    validateEvidence(
        photos: photos.where((f) => f.kind == EvidenceKind.photo).length,
        hasSignature: signaturePng != null && signaturePng.isNotEmpty,
        receiver: draft.receiver);
    final sigPath = await _evidence.files.writeBytes(signaturePng!, ext: '.png');
    final id = newId();
    try {
      await _d.tx((t) async {
        if ((await t.query('deliveries', columns: ['id'], where: 'stop_id = ?', whereArgs: [stopId])).isNotEmpty) {
          throw const _AlreadyDone();
        }
        await _openStop(t, stopId);
        // Revalida existencias dentro de la transacción.
        validateDeliveryLines(draft.lines, draft.returns, await availableStock(t, workdayId));
        final outcome = outcomeFor(draft.lines);
        final folio = await AppDatabase.nextFolio(t, 'ENT');
        final customerId = stop['customer_id']! as String;
        final orderId = stop['order_id'] as String?;
        final now = _d.nowMs();
        await t.insert('deliveries', {
          'id': id,
          'folio': folio,
          'stop_id': stopId,
          'order_id': orderId,
          'workday_id': workdayId,
          'customer_id': customerId,
          'outcome': outcome.name,
          'total_cents': draft.totalCents,
          'returns_credit_cents': draft.returnsCreditCents,
          'receiver_name': draft.receiver.trim(),
          'notes': draft.notes.trim(),
          'fix': encodeFix(fix),
          'device_id': deviceId,
          'created_by': actorId,
          'confirmed_at': now,
        });
        final perProduct = <String, int>{};
        for (final l in draft.lines) {
          await t.insert('delivery_items', {
            'id': newId(),
            'delivery_id': id,
            'product_id': l.productId,
            'ordered_qty': l.orderedQty,
            'delivered_qty': l.deliveredQty,
            'unit_price_cents': l.unitPriceCents,
            'reason': l.hasDiff ? l.reason : null,
          });
          perProduct[l.productId] = (perProduct[l.productId] ?? 0) + l.deliveredQty;
        }
        for (final e in perProduct.entries.where((e) => e.value > 0)) {
          await t.insert('inventory_movements', {
            'id': newId(),
            'workday_id': workdayId,
            'product_id': e.key,
            'type': MovementType.delivery.name,
            'qty': e.value,
            'ref_type': 'delivery',
            'ref_id': id,
            'created_at': now,
          });
        }
        for (final r in draft.returns) {
          final rid = newId();
          await t.insert('return_lines', {
            'id': rid,
            'delivery_id': id,
            'product_id': r.productId,
            'qty': r.qty,
            'reason': r.reason,
            'condition': r.condition.name,
            'unit_price_cents': r.unitPriceCents,
          });
          await t.insert('inventory_movements', {
            'id': newId(),
            'workday_id': workdayId,
            'product_id': r.productId,
            'type': (r.condition == ItemCondition.sellable ? MovementType.returnSellable : MovementType.returnDamaged).name,
            'qty': r.qty,
            'ref_type': 'return',
            'ref_id': rid,
            'created_at': now,
          });
        }
        if (draft.totalCents > 0) {
          await FinanceRepository.createDeliveryReceivable(t, _d,
              customerId: customerId, deliveryId: id, amountCents: draft.totalCents, termsDays: stop['payment_terms_days']! as int);
        }
        await FinanceRepository.applyReturnCredit(t, _d,
            customerId: customerId, deliveryId: id, creditCents: draft.returnsCreditCents, actorId: actorId, workdayId: workdayId);
        await t.update('stops', {'status': outcome.name, 'completed_at': now}, where: 'id = ?', whereArgs: [stopId]);
        if (orderId != null) {
          final os = outcome == StopStatus.partial ? OrderStatus.partial : OrderStatus.delivered;
          await t.update('orders', {'status': os.name}, where: 'id = ?', whereArgs: [orderId]);
          await addOrderEvent(t, orderId, os, 'Entrega $folio · recibió ${draft.receiver.trim()}', now);
        }
        await _evidence.attachDrafts(t, deliveryDraftKey(stopId), 'delivery', id);
        await _evidence.insertFile(t, 'delivery', id, EvidenceKind.signature, sigPath);
        await t.delete('delivery_drafts', where: 'stop_id = ?', whereArgs: [stopId]);
        await _d.log(t, actorId, 'delivery.confirm', 'delivery', id, {'folio': folio, 'outcome': outcome.name});
        await _d.enqueue(t,
            entity: 'delivery',
            type: 'delivery.confirm',
            idempotencyKey: 'delivery:$stopId',
            dependsOn: 'workday.depart:$workdayId',
            payload: {
              'delivery_id': id,
              'folio': folio,
              'stop_id': stopId,
              'order_id': orderId,
              'outcome': outcome.name,
              'total_cents': draft.totalCents,
              'returns_credit_cents': draft.returnsCreditCents,
              'receiver': draft.receiver.trim(),
              'lines': [for (final l in draft.lines) l.toJson()],
              'returns': [for (final r in draft.returns) r.toJson()],
              'fix': fix.toJson(),
              'device_id': deviceId,
            });
        await _d.enqueue(t,
            entity: 'media',
            type: 'delivery.media',
            idempotencyKey: 'delivery.media:$stopId',
            dependsOn: 'delivery:$stopId',
            payload: {'delivery_id': id, 'photos': photos.length, 'signature': true});
      });
    } on _AlreadyDone {
      await _evidence.files.delete(sigPath);
      return (await deliveryIdForStop(stopId))!;
    } catch (_) {
      await _evidence.files.delete(sigPath);
      rethrow;
    }
    return id;
  }

  /// No entrega: guarda motivo, notas, evidencia y ubicación. No toca el
  /// inventario (la mercancía nunca se descontó). Reprogramar solo se permite
  /// para motivos de [Reasons.reschedulable] y devuelve el pedido a “recibido”.
  Future<String> registerFailure({
    required String stopId,
    required String reason,
    required String notes,
    required bool reschedule,
    required LocationFix fix,
    required String deviceId,
    required String actorId,
  }) async {
    final already = await deliveryIdForStop(stopId);
    if (already != null) return already;
    if (!Reasons.noDelivery.contains(reason)) throw const DomainException('fail.reason', 'Selecciona un motivo.');
    if (reschedule && !Reasons.reschedulable.contains(reason)) {
      throw const DomainException('fail.reschedule', 'Este motivo no permite reprogramar el pedido.');
    }
    final photos = await _evidence.drafts(failureDraftKey(stopId));
    if (photos.isEmpty) throw const DomainException('fail.photo', 'Toma al menos una fotografía de respaldo.');
    final id = newId();
    await _d.tx((t) async {
      if ((await t.query('deliveries', columns: ['id'], where: 'stop_id = ?', whereArgs: [stopId])).isNotEmpty) return;
      final stop = await _openStop(t, stopId);
      final workdayId = stop['workday_id']! as String;
      final orderId = stop['order_id'] as String?;
      final folio = await AppDatabase.nextFolio(t, 'NOE');
      final now = _d.nowMs();
      await t.insert('deliveries', {
        'id': id,
        'folio': folio,
        'stop_id': stopId,
        'order_id': orderId,
        'workday_id': workdayId,
        'customer_id': stop['customer_id'],
        'outcome': StopStatus.failed.name,
        'total_cents': 0,
        'returns_credit_cents': 0,
        'failure_reason': reason,
        'notes': notes.trim(),
        'rescheduled': reschedule ? 1 : 0,
        'fix': encodeFix(fix),
        'device_id': deviceId,
        'created_by': actorId,
        'confirmed_at': now,
      });
      await t.update('stops', {'status': StopStatus.failed.name, 'completed_at': now}, where: 'id = ?', whereArgs: [stopId]);
      if (orderId != null) {
        await addOrderEvent(t, orderId, OrderStatus.failed, 'No entregado: $reason', now);
        if (reschedule) {
          await t.update('orders', {'status': OrderStatus.submitted.name, 'workday_id': null, 'stop_id': null},
              where: 'id = ?', whereArgs: [orderId]);
          await addOrderEvent(t, orderId, OrderStatus.submitted, 'Reprogramado: pendiente de asignar a otra ruta', now + 1);
        } else {
          await t.update('orders', {'status': OrderStatus.failed.name}, where: 'id = ?', whereArgs: [orderId]);
        }
      }
      await _evidence.attachDrafts(t, failureDraftKey(stopId), 'delivery', id);
      await _d.log(t, actorId, 'delivery.failed', 'delivery', id, {'reason': reason, 'reschedule': reschedule});
      await _d.enqueue(t,
          entity: 'delivery',
          type: 'delivery.failed',
          idempotencyKey: 'delivery:$stopId',
          dependsOn: 'workday.depart:$workdayId',
          payload: {
            'delivery_id': id,
            'folio': folio,
            'stop_id': stopId,
            'order_id': orderId,
            'reason': reason,
            'notes': notes.trim(),
            'rescheduled': reschedule,
            'fix': fix.toJson(),
            'photos': photos.length,
          });
    });
    return (await deliveryIdForStop(stopId))!;
  }

  // ───────── Consultas ─────────

  static const _deliverySelect = '''
    SELECT d.*, c.name AS customer_name, o.folio AS order_folio
    FROM deliveries d JOIN customers c ON c.id = d.customer_id LEFT JOIN orders o ON o.id = d.order_id''';

  Delivery _fromRow(Row r, {List<DeliveryItem> items = const [], List<ReturnLine> returns = const [], List<EvidenceFile> evidence = const []}) =>
      Delivery(
        id: r['id']! as String,
        folio: r['folio']! as String,
        stopId: r['stop_id']! as String,
        workdayId: r['workday_id']! as String,
        customerId: r['customer_id']! as String,
        customerName: r['customer_name']! as String,
        orderId: r['order_id'] as String?,
        orderFolio: r['order_folio'] as String?,
        outcome: byName(StopStatus.values, r['outcome']),
        totalCents: r['total_cents']! as int,
        returnsCreditCents: r['returns_credit_cents']! as int,
        receiverName: r['receiver_name']! as String,
        failureReason: r['failure_reason'] as String?,
        notes: r['notes']! as String,
        rescheduled: (r['rescheduled']! as int) == 1,
        fix: decodeFix(r['fix'] as String?),
        deviceId: r['device_id']! as String,
        confirmedAt: fromMs(r['confirmed_at']! as int),
        items: items,
        returns: returns,
        evidence: evidence,
      );

  Future<Delivery?> deliveryById(String id) async {
    final r = await _db.rawQuery('$_deliverySelect WHERE d.id = ?', [id]);
    if (r.isEmpty) return null;
    final items = await _db.rawQuery('''
      SELECT di.*, ${cols('p', 'p_', productCols)} FROM delivery_items di JOIN products p ON p.id = di.product_id
      WHERE di.delivery_id = ? ORDER BY p.name''', [id]);
    final rets = await _db.rawQuery('''
      SELECT rl.*, ${cols('p', 'p_', productCols)} FROM return_lines rl JOIN products p ON p.id = rl.product_id
      WHERE rl.delivery_id = ? ORDER BY p.name''', [id]);
    return _fromRow(
      r.first,
      items: [
        for (final e in items)
          DeliveryItem(
            product: productFromRow(e, prefix: 'p_'),
            orderedQty: e['ordered_qty']! as int,
            deliveredQty: e['delivered_qty']! as int,
            unitPriceCents: e['unit_price_cents']! as int,
            reason: e['reason'] as String?,
          )
      ],
      returns: [
        for (final e in rets)
          ReturnLine(
            product: productFromRow(e, prefix: 'p_'),
            qty: e['qty']! as int,
            reason: e['reason']! as String,
            condition: byName(ItemCondition.values, e['condition']),
            unitPriceCents: e['unit_price_cents']! as int,
          )
      ],
      evidence: await _evidence.filesFor('delivery', id),
    );
  }

  Future<List<Delivery>> deliveriesForCustomer(String customerId) async =>
      (await _db.rawQuery('$_deliverySelect WHERE d.customer_id = ? ORDER BY d.confirmed_at DESC', [customerId])).map(_fromRow).toList();

  Future<List<Delivery>> deliveriesForWorkday(String workdayId) async =>
      (await _db.rawQuery('$_deliverySelect WHERE d.workday_id = ? ORDER BY d.confirmed_at', [workdayId])).map(_fromRow).toList();

  Future<String?> deliveryIdForOrder(String orderId) async {
    final r = await _db.query('deliveries', columns: ['id'], where: 'order_id = ?', whereArgs: [orderId], orderBy: 'confirmed_at DESC', limit: 1);
    return r.isEmpty ? null : r.first['id']! as String;
  }
}

class _AlreadyDone implements Exception {
  const _AlreadyDone();
}
