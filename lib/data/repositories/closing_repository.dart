import 'dart:convert';

import 'package:sqflite/sqflite.dart';

import '../../core/utils/dates.dart';
import '../../core/utils/ids.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../domain/errors.dart';
import '../../domain/rules/closing_rules.dart';
import '../db/app_database.dart';
import '../db/queries.dart';
import 'workday_repository.dart';

/// Resumen calculado a partir de los registros reales de la jornada.
class ClosingSummary {
  const ClosingSummary({
    required this.workday,
    required this.salesCents,
    required this.returnsCents,
    required this.cashCents,
    required this.transferCents,
    required this.cardCents,
    required this.toleranceCents,
    required this.stopsTotal,
    required this.stopsDone,
    required this.stopsFailed,
    required this.pendingStops,
    required this.inventory,
  });
  final Workday workday;
  final int salesCents, returnsCents, cashCents, transferCents, cardCents, toleranceCents;
  final int stopsTotal, stopsDone, stopsFailed, pendingStops;
  final List<InventoryRow> inventory;
  int get collectedCents => cashCents + transferCents + cardCents;
}

class ClosingRepository {
  ClosingRepository(this._d, this._workdays);
  final AppDatabase _d;
  final WorkdayRepository _workdays;
  Database get _db => _d.db;

  Future<ClosingSummary> summary(String workdayId) async {
    final w = await _workdays.workdayById(workdayId);
    if (w == null) throw const DomainException('workday.none', 'Jornada no encontrada.');
    final sales = await _db.rawQuery(
        "SELECT COALESCE(SUM(total_cents),0) AS s, COALESCE(SUM(returns_credit_cents),0) AS r FROM deliveries WHERE workday_id = ? AND outcome <> 'failed'",
        [workdayId]);
    final pay = await _db.rawQuery('SELECT method, COALESCE(SUM(amount_cents),0) AS a FROM payments WHERE workday_id = ? GROUP BY method', [workdayId]);
    int m(PaymentMethod x) => (pay.where((e) => e['method'] == x.name).map((e) => (e['a'] as num).toInt()).firstOrNull) ?? 0;
    final stops = await _db.rawQuery('SELECT status, COUNT(*) AS n FROM stops WHERE workday_id = ? GROUP BY status', [workdayId]);
    int s(StopStatus x) => (stops.where((e) => e['status'] == x.name).map((e) => (e['n'] as num).toInt()).firstOrNull) ?? 0;
    final total = stops.fold<int>(0, (a, e) => a + (e['n'] as num).toInt());
    final company = await _db.query('companies', columns: ['cash_tolerance_cents'], where: 'id = ?', whereArgs: [w.companyId]);
    return ClosingSummary(
      workday: w,
      salesCents: (sales.first['s'] as num).toInt(),
      returnsCents: (sales.first['r'] as num).toInt(),
      cashCents: m(PaymentMethod.cash),
      transferCents: m(PaymentMethod.transfer),
      cardCents: m(PaymentMethod.card),
      toleranceCents: company.first['cash_tolerance_cents']! as int,
      stopsTotal: total,
      stopsDone: s(StopStatus.delivered) + s(StopStatus.partial),
      stopsFailed: s(StopStatus.failed),
      pendingStops: s(StopStatus.pending),
      inventory: await _workdays.inventory(workdayId),
    );
  }

  /// Envía el corte. Se guarda una sola vez por jornada (restricción única +
  /// verificación previa); un reintento devuelve el corte existente.
  /// El cierre local termina aquí: la sincronización remota es independiente.
  Future<String> submit({
    required String workdayId,
    required int cashDeclaredCents,
    required Map<String, int> countedByProduct,
    required int? endKm,
    required String justification,
    required String exceptionalReason,
    required String actorId,
  }) async {
    final existing = await closingIdForWorkday(workdayId);
    if (existing != null) return existing;
    final s = await summary(workdayId);
    if (s.workday.status != WorkdayStatus.inRoute) throw const DomainException('closing.state', 'Solo se cierra una jornada en ruta.');
    final inv = [
      for (final r in s.inventory)
        ClosingInventoryLine(
            productId: r.product.id, productName: r.product.name, expected: r.expectedInTruck, counted: countedByProduct[r.product.id] ?? r.expectedInTruck)
    ];
    final input = ClosingInput(
      cashExpectedCents: s.cashCents,
      cashDeclaredCents: cashDeclaredCents,
      toleranceCents: s.toleranceCents,
      inventoryDiffs: inv.where((l) => l.diff != 0).length,
      pendingStops: s.pendingStops,
      justification: justification,
      exceptionalReason: exceptionalReason,
      startKm: s.workday.startKm ?? 0,
      endKm: endKm,
    );
    validateClosing(input);
    final id = newId();
    await _d.tx((t) async {
      if ((await t.query('closings', columns: ['id'], where: 'workday_id = ?', whereArgs: [workdayId])).isNotEmpty) return;
      final now = _d.nowMs();
      // Cierre excepcional: paradas pendientes quedan “sin visitar” y sus pedidos se reprograman.
      final pending = await t.query('stops', where: 'workday_id = ? AND status = ?', whereArgs: [workdayId, StopStatus.pending.name]);
      for (final p in pending) {
        await t.update('stops', {'status': StopStatus.skipped.name, 'completed_at': now}, where: 'id = ?', whereArgs: [p['id']]);
        final orderId = p['order_id'] as String?;
        if (orderId != null) {
          await t.update('orders', {'status': OrderStatus.submitted.name, 'workday_id': null, 'stop_id': null}, where: 'id = ?', whereArgs: [orderId]);
          await addOrderEvent(t, orderId, OrderStatus.submitted, 'Sin visita por cierre excepcional; pendiente de reprogramar', now);
        }
      }
      final folio = await AppDatabase.nextFolio(t, 'CRT');
      await t.insert('closings', {
        'id': id,
        'folio': folio,
        'workday_id': workdayId,
        'sales_cents': s.salesCents,
        'returns_cents': s.returnsCents,
        'cash_expected_cents': s.cashCents,
        'cash_declared_cents': cashDeclaredCents,
        'transfer_cents': s.transferCents,
        'card_cents': s.cardCents,
        'tolerance_cents': s.toleranceCents,
        'justification': justification.trim(),
        'exceptional_reason': exceptionalReason.trim(),
        'pending_stops': s.pendingStops,
        'stops_total': s.stopsTotal,
        'stops_done': s.stopsDone,
        'end_km': endKm,
        'inventory': jsonEncode([
          for (final l in inv) {'product_id': l.productId, 'name': l.productName, 'expected': l.expected, 'counted': l.counted}
        ]),
        'status': ClosingStatus.submitted.name,
        'submitted_at': now,
      });
      await t.update('workdays', {'status': WorkdayStatus.closed.name, 'closed_at': now, 'end_km': endKm}, where: 'id = ?', whereArgs: [workdayId]);
      await t.update('vehicles', {'odometer_km': endKm}, where: 'id = ?', whereArgs: [s.workday.vehicleId]);
      await t.delete('delivery_drafts', where: 'stop_id IN (SELECT id FROM stops WHERE workday_id = ?)', whereArgs: [workdayId]);
      await _d.log(t, actorId, 'closing.submit', 'closing', id, {'folio': folio});
      await _d.enqueue(t,
          entity: 'closing',
          type: 'closing.submit',
          idempotencyKey: 'closing:$workdayId',
          dependsOn: 'workday.depart:$workdayId',
          payload: {
            'closing_id': id,
            'folio': folio,
            'workday_id': workdayId,
            'cash_expected_cents': s.cashCents,
            'cash_declared_cents': cashDeclaredCents,
            'transfer_cents': s.transferCents,
            'card_cents': s.cardCents,
            'sales_cents': s.salesCents,
            'justification': justification.trim(),
            'exceptional_reason': exceptionalReason.trim(),
            'end_km': endKm,
          });
    });
    return (await closingIdForWorkday(workdayId))!;
  }

  Future<String?> closingIdForWorkday(String workdayId) async {
    final r = await _db.query('closings', columns: ['id'], where: 'workday_id = ?', whereArgs: [workdayId]);
    return r.isEmpty ? null : r.first['id']! as String;
  }

  Closing _fromRow(Map<String, Object?> r) => Closing(
        id: r['id']! as String,
        folio: r['folio']! as String,
        workdayId: r['workday_id']! as String,
        salesCents: r['sales_cents']! as int,
        returnsCents: r['returns_cents']! as int,
        cashExpectedCents: r['cash_expected_cents']! as int,
        cashDeclaredCents: r['cash_declared_cents']! as int,
        transferCents: r['transfer_cents']! as int,
        cardCents: r['card_cents']! as int,
        toleranceCents: r['tolerance_cents']! as int,
        justification: r['justification']! as String,
        exceptionalReason: r['exceptional_reason']! as String,
        pendingStops: r['pending_stops']! as int,
        stopsTotal: r['stops_total']! as int,
        stopsDone: r['stops_done']! as int,
        endKm: r['end_km']! as int,
        status: byName(ClosingStatus.values, r['status']),
        submittedAt: fromMs(r['submitted_at']! as int),
        reviewedAt: fromMsOrNull(r['reviewed_at']),
        reviewer: r['reviewer'] as String?,
        reviewNote: r['review_note'] as String?,
        inventory: [
          for (final e in jsonDecode(r['inventory']! as String) as List)
            ClosingInventoryLine(
                productId: e['product_id'] as String, productName: e['name'] as String, expected: e['expected'] as int, counted: e['counted'] as int)
        ],
      );

  Future<Closing?> closingById(String id) async {
    final r = await _db.query('closings', where: 'id = ?', whereArgs: [id]);
    return r.isEmpty ? null : _fromRow(r.first);
  }

  Future<Closing?> closingForWorkday(String workdayId) async {
    final r = await _db.query('closings', where: 'workday_id = ?', whereArgs: [workdayId]);
    return r.isEmpty ? null : _fromRow(r.first);
  }

  Future<Closing?> latestForDriver(String driverId) async {
    final r = await _db.rawQuery(
        'SELECT c.* FROM closings c JOIN workdays w ON w.id = c.workday_id WHERE w.driver_id = ? ORDER BY c.submitted_at DESC LIMIT 1', [driverId]);
    return r.isEmpty ? null : _fromRow(r.first);
  }

  Future<List<({Closing closing, Workday workday})>> submittedClosings() async {
    final r = await _db.query('closings', where: 'status = ?', whereArgs: [ClosingStatus.submitted.name], orderBy: 'submitted_at');
    return [
      for (final c in r) (closing: _fromRow(c), workday: (await _workdays.workdayById(c['workday_id']! as String))!)
    ];
  }

  /// Aprobación explícita (herramientas locales de demostración / supervisor).
  Future<void> review(String closingId, {required bool approve, required String reviewer, String note = ''}) async {
    if (!approve && note.trim().length < 5) throw const DomainException('review.note', 'Indica el motivo del rechazo.');
    await _d.tx((t) async {
      final n = await t.update(
          'closings',
          {
            'status': (approve ? ClosingStatus.approved : ClosingStatus.rejected).name,
            'reviewed_at': _d.nowMs(),
            'reviewer': reviewer,
            'review_note': note.trim(),
          },
          where: 'id = ? AND status = ?',
          whereArgs: [closingId, ClosingStatus.submitted.name]);
      if (n == 0) throw const DomainException('review.state', 'El corte ya fue revisado.');
      await _d.log(t, 'dev-tools', approve ? 'closing.approve' : 'closing.reject', 'closing', closingId, {'reviewer': reviewer});
    });
  }
}
