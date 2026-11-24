import 'package:sqflite/sqflite.dart';

import '../../core/utils/ids.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../services/file_store.dart';
import '../db/app_database.dart';
import '../db/mappers.dart';

/// Referencias SQLite ↔ archivos de evidencia.
///
/// Flujo: las fotos se guardan primero como “borrador” (`owner_type = draft`,
/// `owner_id = <clave del formulario>`), así sobreviven a un cierre de la app.
/// Al confirmar la operación, [attachDrafts] las reasigna al registro final
/// dentro de la misma transacción.
class EvidenceRepository {
  EvidenceRepository(this._d, this.files);
  final AppDatabase _d;
  final FileStore files;
  Database get _db => _d.db;

  static const draft = 'draft';

  Future<EvidenceFile> addDraftFile(String draftKey, EvidenceKind kind, String relPath) async {
    final f = EvidenceFile(id: newId(), ownerType: draft, ownerId: draftKey, kind: kind, relPath: relPath, createdAt: _d.clock.now());
    await _d.tx((t) => t.insert('evidence_files', {
          'id': f.id,
          'owner_type': draft,
          'owner_id': draftKey,
          'kind': kind.name,
          'rel_path': relPath,
          'created_at': f.createdAt.millisecondsSinceEpoch,
        }));
    return f;
  }

  Future<List<EvidenceFile>> filesFor(String ownerType, String ownerId, [DatabaseExecutor? ex]) async {
    final r = await (ex ?? _db).query('evidence_files',
        where: 'owner_type = ? AND owner_id = ?', whereArgs: [ownerType, ownerId], orderBy: 'created_at');
    return r.map(evidenceFromRow).toList();
  }

  Future<List<EvidenceFile>> drafts(String draftKey) => filesFor(draft, draftKey);

  /// Elimina una foto de borrador (registro y archivo).
  Future<void> removeDraft(String fileId) async {
    final r = await _db.query('evidence_files', where: 'id = ? AND owner_type = ?', whereArgs: [fileId, draft]);
    if (r.isEmpty) return;
    await _d.tx((t) => t.delete('evidence_files', where: 'id = ?', whereArgs: [fileId]));
    await files.delete(r.first['rel_path']! as String);
  }

  Future<void> discardDrafts(String draftKey) async {
    for (final f in await drafts(draftKey)) {
      await removeDraft(f.id);
    }
  }

  /// Reasigna los borradores al registro definitivo (dentro de la transacción del negocio).
  Future<int> attachDrafts(Transaction t, String draftKey, String ownerType, String ownerId, {EvidenceKind? kind}) =>
      t.update('evidence_files', {'owner_type': ownerType, 'owner_id': ownerId},
          where: 'owner_type = ? AND owner_id = ?${kind == null ? '' : ' AND kind = ?'}',
          whereArgs: [draft, draftKey, if (kind != null) kind.name]);

  Future<void> insertFile(Transaction t, String ownerType, String ownerId, EvidenceKind kind, String relPath) => t.insert('evidence_files', {
        'id': newId(),
        'owner_type': ownerType,
        'owner_id': ownerId,
        'kind': kind.name,
        'rel_path': relPath,
        'created_at': _d.nowMs(),
      });

  /// Limpieza: borra archivos sin referencia (huérfanos) y borradores con más
  /// de [draftMaxAge]. Devuelve cuántos archivos eliminó.
  Future<int> cleanup({Duration draftMaxAge = const Duration(days: 7)}) async {
    var removed = 0;
    final oldDrafts = await _db.query('evidence_files',
        where: 'owner_type = ? AND created_at < ?',
        whereArgs: [draft, _d.clock.now().subtract(draftMaxAge).millisecondsSinceEpoch]);
    for (final r in oldDrafts) {
      await files.delete(r['rel_path']! as String);
      removed++;
    }
    if (oldDrafts.isNotEmpty) {
      await _d.tx((t) => t.delete('evidence_files',
          where: 'owner_type = ? AND created_at < ?',
          whereArgs: [draft, _d.clock.now().subtract(draftMaxAge).millisecondsSinceEpoch]));
    }
    final known = {for (final r in await _db.query('evidence_files', columns: ['rel_path'])) r['rel_path']! as String};
    for (final name in await files.listAll()) {
      if (!known.contains(name)) {
        // Solo huérfanos con antigüedad: evita borrar una foto recién copiada
        // cuyo registro aún no se inserta.
        final modified = await files.modifiedAt(name);
        if (modified != null && _d.clock.now().difference(modified) > const Duration(minutes: 10)) {
          await files.delete(name);
          removed++;
        }
      }
    }
    return removed;
  }

  /// Registros cuyo archivo ya no existe (se muestran como “archivo no disponible”).
  Future<int> missingCount() async {
    var n = 0;
    for (final r in await _db.query('evidence_files', columns: ['rel_path'])) {
      if (!await files.exists(r['rel_path']! as String)) n++;
    }
    return n;
  }
}
