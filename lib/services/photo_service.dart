import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import 'file_store.dart';

enum PhotoError { permissionDenied, unavailable }

class PhotoException implements Exception {
  const PhotoException(this.error, this.message);
  final PhotoError error;
  final String message;
  @override
  String toString() => message;
}

/// Captura fotografías reales y las copia al almacenamiento privado.
/// Devuelve la ruta relativa en [FileStore] o null si el usuario canceló.
abstract interface class PhotoService {
  Future<String?> capture({bool fromGallery = false});

  /// Android puede destruir la actividad mientras la cámara está abierta; al
  /// reiniciar, recupera la foto pendiente (ruta relativa) si existe.
  Future<String?> recoverLost();
}

class CameraPhotoService implements PhotoService {
  CameraPhotoService(this._files, [ImagePicker? picker]) : _picker = picker ?? ImagePicker();
  final FileStore _files;
  final ImagePicker _picker;

  @override
  Future<String?> capture({bool fromGallery = false}) async {
    try {
      final x = await _picker.pickImage(
        source: fromGallery ? ImageSource.gallery : ImageSource.camera,
        maxWidth: 1600,
        maxHeight: 1600,
        imageQuality: 72,
        requestFullMetadata: false,
      );
      if (x == null) return null;
      return await _files.importFile(x.path);
    } on PlatformException catch (e) {
      if (e.code.contains('access_denied') || e.code.contains('permission')) {
        throw const PhotoException(PhotoError.permissionDenied, 'Sin permiso de cámara. Actívalo en Ajustes para tomar fotografías.');
      }
      throw PhotoException(PhotoError.unavailable, 'No se pudo usar la cámara (${e.code}).');
    }
  }

  @override
  Future<String?> recoverLost() async {
    if (defaultTargetPlatform != TargetPlatform.android) return null;
    try {
      final r = await _picker.retrieveLostData();
      final f = r.file ?? r.files?.firstOrNull;
      if (r.isEmpty || f == null) return null;
      return await _files.importFile(f.path);
    } on PlatformException {
      return null;
    }
  }
}
