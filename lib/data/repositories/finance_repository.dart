import 'package:sqflite/sqflite.dart';

import '../../core/utils/dates.dart';
import '../../core/utils/ids.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../domain/errors.dart';
import '../../domain/rules/payment_rules.dart';
import '../db/app_database.dart';
import '../db/mappers.dart';
import '../db/queries.dart';

/// Documentos por cobrar, pagos y su aplicación.
///
/// Los saldos se actualizan en la misma transacción que el pago; un pago
/// repetido con la misma clave idempotente devuelve el registro existente.
class FinanceRepository {
  FinanceRepository(this._d);
  final AppDatabase _d;
  Database get _db => _d.db;

  Future<List<Receivable>> receivables(String customerId, {bool openOnly = false}) async {
    final r = await _db.query('receivables',
        where: openOnly ? 'customer_id = ? AND balance_cents <> 0' : 'customer_id = ?',
        whereArgs: [customerId],
        orderBy: 'due_at, issued_at');
    return r.map(receivableFromRow).toList();
  }

  Future<int> balance(String customerId) => customerBalance(_db, customerId);

  Future<Receivable?> receivableForDelivery(String deliveryId) async {
    final r = await _db.query('receivables', where: 'delivery_id = ? AND kind = ?', whereArgs: [deliveryId, DocumentKind.delivery.name]);
    return r.isEmpty ? null : receivableFromRow(r.first);
  }

  Future<Payment?> paymentById(String id) async {
    final r = await _db.rawQuery('SELECT p.*, c.name AS customer_name FROM payments p JOIN customers c ON c.id = p.customer_id WHERE p.id = ?', [id]);
    return r.isEmpty ? null : _payment(r.first, await _applications(id));
  }

  Future<List<Payment>> payments(String customerId) async {
    final r = await _db.rawQuery(
        'SELECT p.*, c.name AS customer_name FROM payments p JOIN customers c ON c.id = p.customer_id WHERE p.customer_id = ? ORDER BY p.created_at DESC',
        [customerId]);
    return [for (final e in r) _payment(e, await _applications(e['id']! as String))];
  }

  Future<List<Payment>> paymentsForWorkday(String workdayId) async {
    final r = await _db.rawQuery(
        'SELECT p.*, c.name AS customer_name FROM payments p JOIN customers c ON c.id = p.customer_id WHERE p.workday_id = ? ORDER BY p.created_at',
        [workdayId]);
    return [for (final e in r) _payment(e, await _applications(e['id']! as String))];
  }

  /// Pagos aplicados a un documento (p. ej. la remisión de una entrega).
  Future<List<Payment>> paymentsForReceivable(String receivableId) async {
    final r = await _db.rawQuery('''
      SELECT DISTINCT p.*, c.name AS customer_name FROM payments p
      JOIN payment_applications pa ON pa.payment_id = p.id JOIN customers c ON c.id = p.customer_id
      WHERE pa.receivable_id = ? ORDER BY p.created_at''', [receivableId]);
    return [for (final e in r) _payment(e, await _applications(e['id']! as String))];
  }

  Future<List<PaymentApplication>> _applications(String paymentId, [DatabaseExecutor? ex]) async {
    final r = await (ex ?? _db).rawQuery('''
      SELECT pa.receivable_id, pa.amount_cents, r.folio FROM payment_applications pa
      JOIN receivables r ON r.id = pa.receivable_id WHERE pa.payment_id = ?''', [paymentId]);
    return [
      for (final e in r)
        PaymentApplication(receivableId: e['receivable_id']! as String, receivableFolio: e['folio']! as String, amountCents: e['amount_cents']! as int)
    ];
  }

  Payment _payment(Row r, List<PaymentApplication> apps) => Payment(
        id: r['id']! as String,
        folio: r['folio']! as String,
        customerId: r['customer_id']! as String,
        customerName: r['customer_name']! as String,
        workdayId: r['workday_id'] as String?,
        method: byName(PaymentMethod.values, r['method']),
        amountCents: r['amount_cents']! as int,
        receivedCents: r['received_cents']! as int,
        changeCents: r['change_cents']! as int,
        reference: r['reference']! as String,
        createdAt: fromMs(r['created_at']! as int),
        applications: apps,
      );

  /// Registra un cobro sobre documentos seleccionados por ID.
  ///
  /// No procesa pagos bancarios: registra lo que el conductor recibió.
  Future<String> registerPayment({
    required String customerId,
    required List<String> receivableIds,
    required PaymentMethod method,
    required int enteredCents,
    required String reference,
    required String actorId,
    required String idempotencyKey,
    String? workdayId,
  }) async {
    final existing = await _db.query('payments', columns: ['id'], where: 'idempotency_key = ?', whereArgs: [idempotencyKey]);
    if (existing.isNotEmpty) return existing.first['id']! as String;
    final id = newId();
    await _d.tx((t) async {
      final again = await t.query('payments', columns: ['id'], where: 'idempotency_key = ?', whereArgs: [idempotencyKey]);
      if (again.isNotEmpty) return;
      if (receivableIds.isEmpty) throw const DomainException('payment.docs', 'Selecciona al menos un documento.');
      final docs = (await t.query('receivables',
              where: 'id IN (${List.filled(receivableIds.length, '?').join(',')}) AND customer_id = ?',
              whereArgs: [...receivableIds, customerId]))
          .map(receivableFromRow)
          .toList();
      if (docs.length != receivableIds.toSet().length) throw const DomainException('payment.docs', 'Documento no válido para este cliente.');
      final selected = docs.fold<int>(0, (a, d) => a + (d.balanceCents > 0 ? d.balanceCents : 0));
      final plan = planPayment(method: method, selectedTotalCents: selected, enteredCents: enteredCents, reference: reference);
      if (workdayId != null) {
        final w = await t.query('workdays', columns: ['status'], where: 'id = ?', whereArgs: [workdayId]);
        if (w.isEmpty || w.first['status'] != WorkdayStatus.inRoute.name) {
          throw const DomainException('payment.workday', 'La jornada no está en ruta: no se pueden registrar cobros.');
        }
      }
      final folio = await AppDatabase.nextFolio(t, 'COB');
      await t.insert('payments', {
        'id': id,
        'folio': folio,
        'customer_id': customerId,
        'workday_id': workdayId,
        'method': method.name,
        'amount_cents': plan.appliedCents,
        'received_cents': plan.receivedCents,
        'change_cents': plan.changeCents,
        'reference': reference.trim(),
        'created_by': actorId,
        'created_at': _d.nowMs(),
        'idempotency_key': idempotencyKey,
      });
      final alloc = allocate(plan.appliedCents, docs);
      await _apply(t, id, alloc.applications);
      await _d.log(t, actorId, 'payment.create', 'payment', id, {'folio': folio, 'amount': plan.appliedCents, 'method': method.name});
      await _d.enqueue(t, entity: 'payment', type: 'payment.create', idempotencyKey: 'payment:$idempotencyKey', payload: {
        'payment_id': id,
        'folio': folio,
        'customer_id': customerId,
        'workday_id': workdayId,
        'method': method.name,
        'amount_cents': plan.appliedCents,
        'received_cents': plan.receivedCents,
        'change_cents': plan.changeCents,
        'reference': reference.trim(),
        'applications': [for (final a in alloc.applications) {'receivable_id': a.receivableId, 'amount_cents': a.amountCents}],
      });
    });
    final r = await _db.query('payments', columns: ['id'], where: 'idempotency_key = ?', whereArgs: [idempotencyKey]);
    return r.first['id']! as String;
  }

  Future<void> _apply(Transaction t, String paymentId, List<Allocation> apps) async {
    for (final a in apps) {
      final n = await t.rawUpdate(
          'UPDATE receivables SET balance_cents = balance_cents - ? WHERE id = ? AND balance_cents >= ?', [a.amountCents, a.receivableId, a.amountCents]);
      if (n == 0) throw const DomainException('payment.balance', 'El saldo del documento cambió; vuelve a intentarlo.');
      await t.insert('payment_applications', {'id': newId(), 'payment_id': paymentId, 'receivable_id': a.receivableId, 'amount_cents': a.amountCents});
    }
  }

  /// Crea el documento por cobrar de una entrega (dentro de su transacción).
  static Future<String> createDeliveryReceivable(Transaction t, AppDatabase d,
      {required String customerId, required String deliveryId, required int amountCents, required int termsDays}) async {
    final id = newId();
    final now = d.clock.now();
    await t.insert('receivables', {
      'id': id,
      'customer_id': customerId,
      'folio': await AppDatabase.nextFolio(t, 'REM'),
      'kind': DocumentKind.delivery.name,
      'delivery_id': deliveryId,
      'issued_at': now.millisecondsSinceEpoch,
      'due_at': now.add(Duration(days: termsDays)).millisecondsSinceEpoch,
      'amount_cents': amountCents,
      'balance_cents': amountCents,
    });
    return id;
  }

  /// Aplica una nota de crédito por devoluciones: primero al documento de la
  /// entrega, luego a los documentos abiertos más antiguos; el remanente queda
  /// como saldo a favor (documento de crédito con saldo negativo).
  static Future<void> applyReturnCredit(Transaction t, AppDatabase d,
      {required String customerId, required String deliveryId, required int creditCents, required String actorId, String? workdayId}) async {
    if (creditCents <= 0) return;
    final paymentId = newId();
    final folio = await AppDatabase.nextFolio(t, 'NC');
    await t.insert('payments', {
      'id': paymentId,
      'folio': folio,
      'customer_id': customerId,
      'workday_id': workdayId,
      'method': PaymentMethod.creditNote.name,
      'amount_cents': creditCents,
      'received_cents': creditCents,
      'change_cents': 0,
      'reference': 'Devoluciones',
      'created_by': actorId,
      'created_at': d.nowMs(),
      'idempotency_key': 'return-credit:$deliveryId',
    });
    final docs = (await t.query('receivables', where: 'customer_id = ? AND balance_cents > 0', whereArgs: [customerId]))
        .map(receivableFromRow)
        .toList();
    final own = docs.where((e) => e.deliveryId == deliveryId).toList();
    final rest = docs.where((e) => e.deliveryId != deliveryId).toList();
    final first = allocate(creditCents, own);
    final second = allocate(first.leftover, rest);
    for (final a in [...first.applications, ...second.applications]) {
      await t.rawUpdate('UPDATE receivables SET balance_cents = balance_cents - ? WHERE id = ?', [a.amountCents, a.receivableId]);
      await t.insert('payment_applications', {'id': newId(), 'payment_id': paymentId, 'receivable_id': a.receivableId, 'amount_cents': a.amountCents});
    }
    if (second.leftover > 0) {
      final now = d.clock.now().millisecondsSinceEpoch;
      await t.insert('receivables', {
        'id': newId(),
        'customer_id': customerId,
        'folio': await AppDatabase.nextFolio(t, 'SAF'),
        'kind': DocumentKind.credit.name,
        'delivery_id': deliveryId,
        'issued_at': now,
        'due_at': now,
        'amount_cents': -second.leftover,
        'balance_cents': -second.leftover,
      });
    }
  }
}
