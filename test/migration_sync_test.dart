import 'dart:convert';
import 'dart:io';

import 'package:enruta/data/db/app_database.dart';
import 'package:enruta/data/db/schema.dart';
import 'package:enruta/data/repositories/outbox_repository.dart';
import 'package:enruta/domain/enums.dart';
import 'package:enruta/sync/sync_transport.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'support/test_env.dart';

class FakeTransport implements SyncTransport {
  FakeTransport(this.decide);
  final PushResult Function(OutboxOperation op) decide;
  final sent = <String>[];
  @override
  bool get isConfigured => true;
  @override
  String get description => 'fake';
  @override
  Future<PushResult> push(OutboxOperation op) async {
    sent.add(op.idempotencyKey);
    return decide(op);
  }
}

/// Envía en rondas como el controlador real (sin Riverpod).
Future<void> flush(OutboxRepository repo, SyncTransport t, DateTime now) async {
  for (var round = 0; round < 10; round++) {
    final batch = await repo.ready(now);
    if (batch.isEmpty) return;
    var progressed = false;
    for (final e in batch) {
      final r = await t.push(e.op);
      await repo.markResult(e.op.id, r, e.attempts);
      progressed |= r.outcome == PushOutcome.acknowledged;
    }
    if (!progressed) return;
  }
}

void main() {
  test('Migración v1 → v2 conserva la cola original', () async {
    sqfliteFfiInit();
    final dir = await Directory.systemTemp.createTemp('enruta_mig_');
    final path = '${dir.path}/enruta.db';
    final v1 = await databaseFactoryFfiNoIsolate.openDatabase(path,
        options: OpenDatabaseOptions(version: 1, onCreate: (db, _) async {
          for (final s in schemaV1) {
            await db.execute(s);
          }
        }));
    await v1.insert('sync_queue', {
      'id': 'op-1',
      'category': 'delivery',
      'type': 'delivery.confirm',
      'payload': jsonEncode({'stop': 4}),
      'created_at': 1000,
      'status': 'pending',
      'attempts': 2,
    });
    await v1.insert('sync_queue',
        {'id': 'op-2', 'category': 'media', 'type': 'x', 'payload': '{}', 'created_at': 1001, 'status': 'done', 'attempts': 0});
    await v1.close();

    final db = await AppDatabase.open(factory: databaseFactoryFfiNoIsolate, path: path);
    expect(await db.db.getVersion(), schemaVersion);
    final rows = await db.db.query('outbox');
    expect(rows.length, 1); // la operación ya enviada (done) no se migra
    expect(rows.first['idempotency_key'], 'legacy:op-1');
    expect(jsonDecode(rows.first['payload']! as String)['stop'], 4);
    expect(rows.first['attempts'], 2);
    final tables = (await db.db.rawQuery("SELECT name FROM sqlite_master WHERE type='table'")).map((e) => e['name']).toSet();
    expect(tables, containsAll(['orders', 'deliveries', 'payments', 'closings', 'outbox', 'file_blobs']));
    expect(tables.contains('sync_queue'), isFalse);
    await db.close();
    await dir.delete(recursive: true);
  });

  group('Sincronización', () {
    late TestEnv env;
    setUp(() async => env = await TestEnv.create());
    tearDown(() async => env.dispose());

    Future<void> makeOps() async {
      final lines = await env.workdays.loadLines(demoWorkdayId);
      for (final l in lines) {
        await env.workdays.setCount(l.id, l.expectedQty);
      }
      await env.workdays.confirmLoad(demoWorkdayId, 48250, demoDriverId);
      await env.workdays.depart(demoWorkdayId, demoDriverId);
    }

    test('Sin backend: nada se marca como enviado', () async {
      await makeOps();
      const t = NoBackendTransport();
      expect(t.isConfigured, isFalse);
      final r = await t.push((await env.outbox.list()).first.op);
      expect(r.outcome, isNot(PushOutcome.acknowledged));
      expect((await env.outbox.counts()).acknowledged, 0);
    });

    test('Confirmación real respeta dependencias y orden', () async {
      await makeOps();
      final t = FakeTransport((_) => const PushResult(PushOutcome.acknowledged));
      await flush(env.outbox, t, env.clock.now());
      expect((await env.outbox.counts()).pending, 0);
      expect(t.sent.indexOf('load.confirm:$demoWorkdayId'), lessThan(t.sent.indexOf('workday.depart:$demoWorkdayId')));
    });

    test('Fallo temporal: conserva, cuenta intentos y espera antes de reintentar', () async {
      await makeOps();
      final t = FakeTransport((_) => const PushResult(PushOutcome.retry, 'Servidor no disponible'));
      await flush(env.outbox, t, env.clock.now());
      final pending = await env.outbox.list(statuses: [OutboxStatus.pending]);
      expect(pending, isNotEmpty);
      expect(pending.where((e) => e.attempts == 1), isNotEmpty);
      expect(pending.first.lastError, 'Servidor no disponible');
      // Sin esperar, no hay operaciones listas: no hay bucle de reintentos.
      expect(await env.outbox.ready(env.clock.now()), isEmpty);
      expect(await env.outbox.ready(env.clock.now().add(const Duration(minutes: 2))), isNotEmpty);
    });

    test('Rechazo del servidor queda visible y bloquea dependientes', () async {
      await makeOps();
      final t = FakeTransport((op) => op.type == 'load.confirm' ? const PushResult(PushOutcome.rejected, 'Conflicto') : const PushResult(PushOutcome.acknowledged));
      await flush(env.outbox, t, env.clock.now());
      final c = await env.outbox.counts();
      expect(c.rejected, 1);
      expect(t.sent.contains('workday.depart:$demoWorkdayId'), isFalse);
    });
  });
}
