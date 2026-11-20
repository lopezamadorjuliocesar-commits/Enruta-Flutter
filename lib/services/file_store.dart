import 'dart:io';
import 'dart:typed_data';

import 'package:path/path.dart' as p;

import '../core/utils/ids.dart';

/// Almacenamiento privado de evidencias (fotos y firmas) dentro del directorio
/// de documentos de la app. SQLite guarda rutas relativas, de modo que la
/// referencia sigue siendo válida aunque cambie el contenedor (iOS).
class FileStore {
  FileStore(this.root);

  /// Directorio raíz (p. ej. `<documentos>/evidence`).
  final Directory root;

  Future<void> ensure() async {
    if (!await root.exists()) await root.create(recursive: true);
  }

  File fileFor(String relPath) => File(p.join(root.path, relPath));

  Future<bool> exists(String relPath) => fileFor(relPath).exists();

  /// Copia un archivo temporal (p. ej. de la cámara) al almacenamiento privado.
  Future<String> importFile(String sourcePath, {String ext = '.jpg'}) async {
    await ensure();
    final rel = '${newId()}$ext';
    await File(sourcePath).copy(fileFor(rel).path);
    try {
      await File(sourcePath).delete();
    } on FileSystemException {
      // El temporal puede pertenecer al sistema; no es crítico.
    }
    return rel;
  }

  Future<String> writeBytes(Uint8List bytes, {String ext = '.png'}) async {
    await ensure();
    final rel = '${newId()}$ext';
    await fileFor(rel).writeAsBytes(bytes, flush: true);
    return rel;
  }

  Future<Uint8List?> readBytes(String relPath) async {
    final f = fileFor(relPath);
    return await f.exists() ? f.readAsBytes() : null;
  }

  Future<void> delete(String relPath) async {
    final f = fileFor(relPath);
    if (await f.exists()) await f.delete();
  }

  /// Nombres relativos de todos los archivos guardados.
  Future<List<String>> listAll() async {
    if (!await root.exists()) return const [];
    return [
      await for (final e in root.list())
        if (e is File) p.basename(e.path)
    ];
  }

  Future<void> wipe() async {
    if (await root.exists()) await root.delete(recursive: true);
  }
}
