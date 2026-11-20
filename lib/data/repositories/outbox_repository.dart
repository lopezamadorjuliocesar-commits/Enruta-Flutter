import 'dart:convert';
import 'dart:math';

import 'package:sqflite/sqflite.dart';

import '../../core/utils/dates.dart';
import '../../domain/enums.dart';
import '../../sync/sync_transport.dart';
import '../db/app_database.dart';

class OutboxEntry {
  const OutboxEntry({required this.op, required this.status, required this.attempts, this.lastError, this.nextAttemptAt, this.acknowledgedAt});
  final OutboxOperation op;
  final OutboxStatus status;
  final int attempts;
  final String? lastError;
  final DateTime? nextAttemptAt, acknowledgedAt;
}

class OutboxCounts {
  const OutboxCounts({this.pending = 0, this.rejected = 0, this.acknowledged = 0, this.byEntity = const {}});
  final int pending, rejected, acknowledged;
  final Map<String, int> byEntity;
}

/// Cola persistente de operaciones hacia el servidor.
class OutboxRepository {
  OutboxRepository(this._d);
  final AppDatabase _d;
  Database get _db => _d.db;

  OutboxEntry _fromRow(Map<String, Object?> r) => OutboxEntry(
        op: OutboxOperation(
          id: r['id']! as String,
          entity: r['entity']! as String,
          type: r['op_type']! as String,
          payload: Map<String, Object?>.from(jsonDecode(r['payload']! as String) as Map),
          idempotencyKey: r['idempotency_key']! as String,
          dependsOn: r['depends_on'] as String?,
          createdAt: fromMs(r['created_at']! as int),
        ),
        status: byName(OutboxStatus.values, r['status']),
        attempts: r['attempts']! as int,
        lastError: r['last_error'] as String?,
        nextAttemptAt: fromMsOrNull(r['next_attempt_at']),
        acknowledgedAt: fromMsOrNull(r['acknowledged_at']),
      );

  Future<OutboxCounts> counts() async {
    final r = await _db.rawQuery('SELECT status, COUNT(*) AS n FROM outbox GROUP BY status');
    int n(String s) => r.where((e) => e['status'] == s).map((e) => (e['n'] as num).toInt()).fold(0, (a, b) => a + b);
    final e = await _db.rawQuery("SELECT entity, COUNT(*) AS n FROM outbox WHERE status IN ('pending','sending') GROUP BY entity");
    return OutboxCounts(
      pending: n('pending') + n('sending'),
      rejected: n('rejected'),
      acknowledged: n('acknowledged'),
      byEntity: {for (final x in e) x['entity']! as String: (x['n'] as num).toInt()},
    );
  }

  Future<List<OutboxEntry>> list({List<OutboxStatus>? statuses, int limit = 100}) async {
    final s = statuses ?? [OutboxStatus.pending, OutboxStatus.sending, OutboxStatus.rejected];
    final r = await _db.query('outbox',
        where: 'status IN (${List.filled(s.length, '?').join(',')})', whereArgs: s.map((e) => e.name).toList(), orderBy: 'created_at', limit: limit);
    return r.map(_fromRow).toList();
  }

  /// Operaciones listas para enviar: pendientes, con tiempo de reintento
  /// cumplido y cuya dependencia ya fue confirmada por el servidor.
  Future<List<OutboxEntry>> ready(DateTime now, {int limit = 50}) async {
    final r = await _db.rawQuery('''
      SELECT o.* FROM outbox o
      WHERE o.status = 'pending' AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= ?)
        AND (o.depends_on IS NULL
             OR NOT EXISTS (SELECT 1 FROM outbox p WHERE p.idempotency_key = o.depends_on)
             OR EXISTS (SELECT 1 FROM outbox p WHERE p.idempotency_key = o.depends_on AND p.status = 'acknowledged'))
      ORDER BY o.created_at LIMIT ?''', [now.millisecondsSinceEpoch, limit]);
    return r.map(_fromRow).toList();
  }

  Future<DateTime?> nextRetryAt() async {
    final r = await _db.rawQuery("SELECT MIN(next_attempt_at) AS t FROM outbox WHERE status = 'pending' AND next_attempt_at IS NOT NULL");
    return fromMsOrNull(r.first['t']);
  }

  Future<void> markSending(String id) => _db.update('outbox', {'status': 'sending'}, where: 'id = ?', whereArgs: [id]);

  Future<void> markResult(String id, PushResult res, int attempts) async {
    final now = _d.clock.now();
    switch (res.outcome) {
      case PushOutcome.acknowledged:
        await _db.update('outbox', {'status': 'acknowledged', 'acknowledged_at': now.millisecondsSinceEpoch, 'last_error': null},
            where: 'id = ?', whereArgs: [id]);
      case PushOutcome.retry:
        // Espera exponencial: 30 s, 60 s, 2 min… hasta 1 h.
        final wait = Duration(seconds: min(3600, 30 * pow(2, min(attempts, 7)).toInt()));
        await _db.update(
            'outbox', {'status': 'pending', 'attempts': attempts + 1, 'last_error': res.message, 'next_attempt_at': now.add(wait).millisecondsSinceEpoch},
            where: 'id = ?', whereArgs: [id]);
      case PushOutcome.rejected:
        await _db.update('outbox', {'status': 'rejected', 'attempts': attempts + 1, 'last_error': res.message}, where: 'id = ?', whereArgs: [id]);
    }
    _d.notifyChanged();
  }

  /// Si la app se cerró durante un envío, la operación vuelve a pendiente.
  Future<void> recoverInterrupted() async {
    await _db.update('outbox', {'status': 'pending'}, where: 'status = ?', whereArgs: ['sending']);
  }

  /// Reintento manual de una operación rechazada (tras corregir el problema en servidor).
  Future<void> requeue(String id) async {
    await _db.update('outbox', {'status': 'pending', 'next_attempt_at': null}, where: 'id = ? AND status = ?', whereArgs: [id, 'rejected']);
    _d.notifyChanged();
  }

  Future<void> resetBackoff() async {
    await _db.update('outbox', {'next_attempt_at': null}, where: 'status = ?', whereArgs: ['pending']);
  }
}
