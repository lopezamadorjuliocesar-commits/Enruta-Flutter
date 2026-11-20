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

  @override
  Future<PermState> status(AppPermission p) async => _state(await _map(p).status);

  @override
  Future<PermState> request(AppPermission p) async => _state(await _map(p).request());

  @override
  Future<bool> openSettings() => ph.openAppSettings();
}
