import 'dart:async';
import 'dart:convert';

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import '../../core/utils/ids.dart';
import 'schema.dart';

/// Reloj inyectable (las pruebas controlan expiraciones y fechas).
class AppClock {
  const AppClock();
  DateTime now() => DateTime.now();
}

class FixedClock extends AppClock {
  FixedClock(this.current);
  DateTime current;
  @override
  DateTime now() => current;
  void advance(Duration d) => current = current.add(d);
}

/// Base de datos operativa: fuente de verdad del negocio en el dispositivo.
class AppDatabase {
  AppDatabase._(this.db, this.path, this.clock);

  final Database db;
  final String path;
  final AppClock clock;
  final _changes = StreamController<int>.broadcast();
  int _revision = 0;

  /// Emite una revisión nueva después de cada escritura confirmada.
  Stream<int> get changes => _changes.stream;
  int get revision => _revision;

  static const fileName = 'enruta.db';

  static Future<String> defaultPath() async => p.join(await getDatabasesPath(), fileName);

  /// Abre (o crea) la base y aplica migraciones versionadas.
  static Future<AppDatabase> open({DatabaseFactory? factory, String? path, AppClock clock = const AppClock()}) async {
    final f = factory ?? databaseFactory;
    final dbPath = path ?? await defaultPath();
    final db = await f.openDatabase(
      dbPath,
      options: OpenDatabaseOptions(
        version: schemaVersion,
        onConfigure: (db) async => db.execute('PRAGMA foreign_keys = ON'),
        onCreate: (db, version) async {
          final batch = db.batch();
          for (final s in schemaV2) {
            batch.execute(s);
          }
          await batch.commit(noResult: true);
        },
        onUpgrade: (db, from, to) async {
          if (from < 2) await _migrate1to2(db, clock);
        },
      ),
    );
    return AppDatabase._(db, dbPath, clock);
  }

  /// v1 → v2: crea el modelo completo y conserva la cola original.
  static Future<void> _migrate1to2(Database db, AppClock clock) async {
    for (final s in schemaV2) {
      await db.execute(s);
    }
    final legacy = await db.query('sync_queue');
    for (final r in legacy) {
      if (r['status'] == 'done') continue;
      await db.insert('outbox', {
        'id': newId(),
        'entity': r['category'],
        'op_type': r['type'],
        'payload': r['payload'],
        'idempotency_key': 'legacy:${r['id']}',
        'status': 'pending',
        'attempts': r['attempts'] ?? 0,
        'last_error': 'Migrada desde la cola v1',
        'created_at': r['created_at'],
      });
    }
    await db.execute('DROP TABLE sync_queue');
  }

  void notifyChanged() {
    _revision++;
    if (!_changes.isClosed) _changes.add(_revision);
  }

  /// Ejecuta [action] en una transacción y notifica a los observadores al confirmar.
  Future<T> tx<T>(Future<T> Function(Transaction t) action) async {
    final r = await db.transaction(action);
    notifyChanged();
    return r;
  }

  Future<void> close() async {
    await _changes.close();
    await db.close();
  }

  // ───── utilidades compartidas por los repositorios ─────

  int nowMs() => clock.now().millisecondsSinceEpoch;

  /// Folio estable y secuencial por prefijo (PED-000001, COB-000001…).
  static Future<String> nextFolio(DatabaseExecutor ex, String prefix) async {
    final r = await ex.query('folio_counters', where: 'prefix = ?', whereArgs: [prefix]);
    final n = r.isEmpty ? 1 : r.first['next']! as int;
    await ex.insert('folio_counters', {'prefix': prefix, 'next': n + 1}, conflictAlgorithm: ConflictAlgorithm.replace);
    return '$prefix-${n.toString().padLeft(6, '0')}';
  }

  Future<String?> getSetting(String key, [DatabaseExecutor? ex]) async {
    final r = await (ex ?? db).query('app_settings', where: 'key = ?', whereArgs: [key]);
    return r.isEmpty ? null : r.first['value'] as String;
  }

  Future<void> setSetting(String key, String? value, [DatabaseExecutor? ex]) async {
    final e = ex ?? db;
    if (value == null) {
      await e.delete('app_settings', where: 'key = ?', whereArgs: [key]);
    } else {
      await e.insert('app_settings', {'key': key, 'value': value}, conflictAlgorithm: ConflictAlgorithm.replace);
    }
    if (ex == null) notifyChanged();
  }

  /// Registro de auditoría interno (quién hizo qué y cuándo).
  Future<void> log(DatabaseExecutor ex, String? actorId, String action, String entity, String entityId,
      [Map<String, Object?> details = const {}]) async {
    await ex.insert('audit_log', {
      'id': newId(),
      'actor_id': actorId,
      'action': action,
      'entity': entity,
      'entity_id': entityId,
      'details': jsonEncode(details),
      'created_at': nowMs(),
    });
  }

  /// Registra una operación para sincronización remota dentro de la misma
  /// transacción del cambio local (atomicidad). La clave idempotente evita
  /// duplicados si la acción se repite.
  Future<void> enqueue(DatabaseExecutor ex,
      {required String entity,
      required String type,
      required String idempotencyKey,
      required Map<String, Object?> payload,
      String? dependsOn}) async {
    await ex.insert(
      'outbox',
      {
        'id': newId(),
        'entity': entity,
        'op_type': type,
        'payload': jsonEncode(payload),
        'idempotency_key': idempotencyKey,
        'depends_on': dependsOn,
        'status': 'pending',
        'attempts': 0,
        'created_at': nowMs(),
      },
      conflictAlgorithm: ConflictAlgorithm.ignore,
    );
  }
}
