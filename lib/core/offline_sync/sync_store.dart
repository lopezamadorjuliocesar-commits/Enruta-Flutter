import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import 'sync_operation.dart';

abstract interface class SyncStore {
  Future<void> upsert(SyncOperation op);
  Future<List<SyncOperation>> all();
  Future<void> delete(String id);
}

class MemorySyncStore implements SyncStore {
  final Map<String, SyncOperation> _ops = {};

  @override
  Future<void> upsert(SyncOperation op) async => _ops[op.id] = op;

  @override
  Future<List<SyncOperation>> all() async =>
      _ops.values.toList()..sort((a, b) => a.createdAt.compareTo(b.createdAt));

  @override
  Future<void> delete(String id) async => _ops.remove(id);
}

/// Persistencia SQLite de la cola (operación 100% offline-first).
class SqliteSyncStore implements SyncStore {
  SqliteSyncStore._(this._db);
  final Database _db;

  static Future<SqliteSyncStore> open() async {
    final path = p.join(await getDatabasesPath(), 'enruta.db');
    final db = await openDatabase(path, version: 1, onCreate: (db, _) async {
      await db.execute('''
        CREATE TABLE sync_queue(
          id TEXT PRIMARY KEY,
          category TEXT NOT NULL,
          type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          status TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0
        )''');
    });
    return SqliteSyncStore._(db);
  }

  @override
  Future<void> upsert(SyncOperation op) =>
      _db.insert('sync_queue', op.toRow(), conflictAlgorithm: ConflictAlgorithm.replace);

  @override
  Future<List<SyncOperation>> all() async =>
      (await _db.query('sync_queue', orderBy: 'created_at ASC')).map(SyncOperation.fromRow).toList();

  @override
  Future<void> delete(String id) => _db.delete('sync_queue', where: 'id = ?', whereArgs: [id]);
}
