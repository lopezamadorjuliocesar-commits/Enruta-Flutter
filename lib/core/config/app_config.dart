import 'package:flutter/foundation.dart';

/// Configuración externa de la app. Se inyecta en compilación con
/// `--dart-define` o `--dart-define-from-file=config/env.json` (ver
/// `config/env.example.json`). Ningún secreto vive en el código fuente.
abstract final class AppConfig {
  /// Token público de Mapbox (pk.*). Vacío ⇒ el mapa muestra “no configurado”
  /// y la operación continúa desde la lista de paradas.
  static const mapboxToken = String.fromEnvironment('MAPBOX_ACCESS_TOKEN');

  /// URL base de la API de sincronización (futuro backend con PostgreSQL).
  /// Vacía ⇒ la sincronización remota queda “no configurada” y las
  /// operaciones permanecen pendientes en el dispositivo.
  static const apiBaseUrl = String.fromEnvironment('ENRUTA_API_BASE_URL');

  /// Herramientas de desarrollo (restablecer demo, aprobar solicitudes y cortes).
  /// Activas en debug o con `--dart-define=ENRUTA_DEV_TOOLS=true`.
  static const _devToolsFlag = bool.fromEnvironment('ENRUTA_DEV_TOOLS');
  static bool get devToolsEnabled => kDebugMode || _devToolsFlag;

  static bool get hasMapbox => mapboxToken.trim().startsWith('pk.');
  static bool get hasApi => apiBaseUrl.trim().isNotEmpty;

  static const appVersion = '1.1.0 (2)';
}
