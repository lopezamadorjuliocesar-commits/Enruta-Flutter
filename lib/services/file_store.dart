import 'dart:io';
import 'dart:typed_data';

import 'package:path/path.dart' as p;

import '../core/utils/ids.dart';
import '../data/db/app_database.dart';

/// Almacenamiento privado de evidencias (fotos y firmas). SQLite guarda solo
/// la referencia relativa (`evidence_files.rel_path`); los bytes viven en:
/// - [IoFileStore]: archivos en el directorio de documentos de la app (Android/iOS).
/// - [DbFileStore]: tabla `file_blobs` de SQLite (web, donde no hay sistema de archivos).
abstract interface class FileStore {
  Future<void> ensure();
  Future<bool> exists(String relPath);
  Future<String> writeBytes(Uint8List bytes, {String ext = '.png'});
  Future<Uint8List?> readBytes(String relPath);
  Future<void> delete(String relPath);

  /// Nombres relativos de todo lo guardado (para detectar huérfanos).
  Future<List<String>> listAll();

  /// Fecha de creación/modificación (null si no existe).
  Future<DateTime?> modifiedAt(String relPath);
  Future<void> wipe();
}

class IoFileStore implements FileStore {
  IoFileStore(this.root);

  /// Directorio raíz (p. ej. `<documentos>/evidence`).
  final Directory root;

  File _file(String relPath) => File(p.join(root.path, relPath));

  @override
  Future<void> ensure() async {
    if (!await root.exists()) await root.create(recursive: true);
  }

  @override
  Future<bool> exists(String relPath) => _file(relPath).exists();

  @override
  Future<String> writeBytes(Uint8List bytes, {String ext = '.png'}) async {
    await ensure();
    final rel = '${newId()}$ext';
    await _file(rel).writeAsBytes(bytes, flush: true);
    return rel;
  }

  @override
  Future<Uint8List?> readBytes(String relPath) async {
    final f = _file(relPath);
    return await f.exists() ? f.readAsBytes() : null;
  }

  @override
  Future<void> delete(String relPath) async {
    final f = _file(relPath);
    if (await f.exists()) await f.delete();
  }

  @override
  Future<List<String>> listAll() async {
    if (!await root.exists()) return const [];
    return [
      await for (final e in root.list())
        if (e is File) p.basename(e.path)
    ];
  }

  @override
  Future<DateTime?> modifiedAt(String relPath) async {
    final f = _file(relPath);
    return await f.exists() ? (await f.stat()).modified : null;
  }

  @override
  Future<void> wipe() async {
    if (await root.exists()) await root.delete(recursive: true);
  }
}

class DbFileStore implements FileStore {
  DbFileStore(this._d);
  final AppDatabase _d;

  @override
  Future<void> ensure() async {}

  @override
  Future<bool> exists(String relPath) async =>
      (await _d.db.query('file_blobs', columns: ['rel_path'], where: 'rel_path = ?', whereArgs: [relPath])).isNotEmpty;

  @override
  Future<String> writeBytes(Uint8List bytes, {String ext = '.png'}) async {
    final rel = '${newId()}$ext';
    await _d.db.insert('file_blobs', {'rel_path': rel, 'bytes': bytes, 'created_at': _d.nowMs()});
    return rel;
  }

  @override
  Future<Uint8List?> readBytes(String relPath) async {
    final r = await _d.db.query('file_blobs', columns: ['bytes'], where: 'rel_path = ?', whereArgs: [relPath]);
    if (r.isEmpty) return null;
    final b = r.first['bytes'];
    return b is Uint8List ? b : Uint8List.fromList(List<int>.from(b! as List));
  }

  @override
  Future<void> delete(String relPath) => _d.db.delete('file_blobs', where: 'rel_path = ?', whereArgs: [relPath]);

  @override
  Future<List<String>> listAll() async =>
      [for (final r in await _d.db.query('file_blobs', columns: ['rel_path'])) r['rel_path']! as String];

  @override
  Future<DateTime?> modifiedAt(String relPath) async {
    final r = await _d.db.query('file_blobs', columns: ['created_at'], where: 'rel_path = ?', whereArgs: [relPath]);
    return r.isEmpty ? null : DateTime.fromMillisecondsSinceEpoch(r.first['created_at']! as int);
  }

  @override
  Future<void> wipe() => _d.db.delete('file_blobs');
}
