import 'package:flutter/foundation.dart';
import 'package:permission_handler/permission_handler.dart' as ph;

enum AppPermission {
  location('Ubicación', 'Registrar llegada, evidencia y recorrido mientras usas la app.'),
  camera('Cámara', 'Fotografías de evidencia y lectura de códigos de barras.');

  const AppPermission(this.label, this.purpose);
  final String label, purpose;
}

enum PermState {
  granted('Concedido'),
  limited('Concedido parcialmente'),
  denied('No concedido'),
  permanentlyDenied('Denegado permanentemente'),
  restricted('Restringido por el sistema');

  const PermState(this.label);
  final String label;
  bool get usable => this == granted || this == limited;
}

/// Consulta y solicitud de permisos reales del sistema operativo.
abstract interface class PermissionService {
  Future<PermState> status(AppPermission p);
  Future<PermState> request(AppPermission p);
  Future<bool> openSettings();
}

class SystemPermissionService implements PermissionService {
  const SystemPermissionService();

  ph.Permission _map(AppPermission p) => switch (p) {
        AppPermission.location => ph.Permission.locationWhenInUse,
        AppPermission.camera => ph.Permission.camera,
      };

  PermState _state(ph.PermissionStatus s) => switch (s) {
        ph.PermissionStatus.granted => PermState.granted,
        ph.PermissionStatus.limited || ph.PermissionStatus.provisional => PermState.limited,
        ph.PermissionStatus.permanentlyDenied => PermState.permanentlyDenied,
        ph.PermissionStatus.restricted => PermState.restricted,
        ph.PermissionStatus.denied => PermState.denied,
      };

  // En navegadores algunos permisos no se pueden consultar: se informa
  // “no concedido” en lugar de fallar, y el navegador pregunta al usarlos.
  @override
  Future<PermState> status(AppPermission p) async {
    try {
      return _state(await _map(p).status);
    } catch (_) {
      return PermState.denied;
    }
  }

  @override
  Future<PermState> request(AppPermission p) async {
    try {
      return _state(await _map(p).request());
    } catch (_) {
      return PermState.denied;
    }
  }

  @override
  Future<bool> openSettings() async {
    if (kIsWeb) return false; // No hay ajustes de app en el navegador.
    try {
      return await ph.openAppSettings();
    } catch (_) {
      return false;
    }
  }
}
