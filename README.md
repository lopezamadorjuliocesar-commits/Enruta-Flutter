# EnRuta

App Flutter offline-first para repartidores y portal de negocio (29 pantallas del mockup).
Clean/feature-first: `core/{theme,offline_sync,domain,state,router,widgets}` y
`features/{auth,route,delivery,collection,closing,inventory,scanner,client_portal}`.

## Ejecutar
```
flutter pub get && flutter test && flutter run
```
Android: permisos (INTERNET, CAMERA, UBICACIÓN) ya declarados en `AndroidManifest.xml`.
iOS: generar con `flutter create --platforms=ios .` y añadir `NSCameraUsageDescription` y
`NSLocationWhenInUseUsageDescription` a `Info.plist`.

## Implementado
- Tokens exactos (`core/theme`), GoRouter con 2 shells (Repartidor 4 tabs / Negocio 3 tabs).
- `SyncQueue` persistida en SQLite (sqflite), FIFO, tolerante a fallos, con conectividad real (connectivity_plus).
- Evidencia real: sello de tiempo + ID de dispositivo + GPS (`DeviceEvidenceSource`).
- Navegación externa turn-by-turn (url_launcher), escáner EAN-13 (mobile_scanner), firma (signature).
- Reglas críticas: motivo obligatorio ante diferencias (carga/entrega), justificación en corte > tolerancia.
- Tests: `test/closing_rules_test.dart`, `test/core_rules_test.dart`.

## Pendiente
- Mapbox SDK real en `features/route/route_map.dart` (hoy: mapa offline dibujado con CustomPaint; requiere token).
- Transporte HTTP de `syncTransportProvider` (hoy acepta todo) y descarga real de configuración del tenant.
- Migración opcional a Drift; app id `com.example.enruta_transportistas` por definir.
- Nota: el entorno de revisión no tenía Flutter SDK; ejecutar `flutter analyze` y `flutter test` al recibir.
