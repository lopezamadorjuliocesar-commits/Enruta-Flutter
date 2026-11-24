# Arquitectura de EnRuta

## Capas

```
lib/
├─ domain/            Entidades, enums y reglas puras (sin Flutter ni SQLite)
│  └─ rules/          Carga, entrega, cobro, crédito y corte (probadas unitariamente)
├─ data/
│  ├─ db/             AppDatabase (sqflite), esquema versionado, migraciones, mapeos
│  ├─ repositories/   Casos de uso transaccionales sobre SQLite (fuente de verdad)
│  └─ seed/           Modo demostración local (inserción única)
├─ services/          Dispositivo: cámara/fotos, ubicación, permisos, archivos, PDF, PIN
├─ sync/              Cola de salida (outbox), contrato de transporte y controlador
├─ app/               Riverpod: arranque, sesión, repositorios y consultas reactivas
├─ core/              Configuración, tema, componentes, router, utilidades
└─ features/          Pantallas por flujo (auth, route, delivery, collection, closing,
                      client_portal, orders, receipts, dev_tools, scanner, inventory)
```

- **SQLite es la fuente de verdad del negocio.** Riverpod solo presenta: cada
  escritura confirmada incrementa `dataVersionProvider` y las consultas
  (`app/queries.dart`) se releen.
- **Reglas en el dominio y en el repositorio**, no solo en la UI: por ejemplo
  `DeliveryRepository.confirmDelivery` vuelve a validar existencias y evidencia
  dentro de la transacción.
- **Pantallas por ID explícito** (`/cliente?stop=…`, `/entrega?stop=…`,
  `/entregada?delivery=…`): no existe una “parada actual” global.

## Base de datos local

- Archivo `enruta.db` (directorio de bases de datos de la app). Esquema en
  `lib/data/db/schema.dart`, versión `2`.
- Migración **v1 → v2**: la v1 original solo tenía `sync_queue`; al actualizar se
  crean las tablas del modelo completo y las operaciones no enviadas se copian a
  `outbox` (clave `legacy:<id>`) antes de eliminar la tabla vieja.
- Identificadores UUID v4; folios legibles y estables por prefijo
  (`PED-`, `ENT-`, `NOE-`, `REM-`, `COB-`, `NC-`, `SAF-`, `INC-`, `SAL-`, `CRT-`).
- Integridad: `FOREIGN KEY` activas, `CHECK` de estados y cantidades, `UNIQUE`
  para idempotencia (una entrega por parada, un corte por jornada, una jornada
  abierta por conductor, claves idempotentes de pedidos/pagos/incidencias/auditorías,
  movimientos de inventario únicos por referencia).
- **Dinero en centavos enteros** (`INTEGER`). La captura se convierte con
  `parseCents` sin pasar por `double`.

| Grupo | Tablas |
|---|---|
| Empresa y cuentas | `companies`, `users`, `invitations`, `verification_codes`, `local_messages`, `app_settings` |
| Catálogo y clientes | `products`, `customers`, `addresses`, `vehicles` |
| Pedidos | `orders`, `order_items`, `order_events`, `cart_items` |
| Jornada | `workdays`, `stops`, `load_lines`, `inventory_movements`, `track_points` |
| Entregas | `deliveries`, `delivery_items`, `return_lines`, `delivery_drafts` |
| Cobranza | `receivables`, `payments`, `payment_applications` |
| Evidencias y campo | `evidence_files`, `incidents`, `incident_updates`, `audits`, `audit_items` |
| Cierre | `closings` |
| Control | `audit_log`, `outbox`, `folio_counters` |

### Transacciones atómicas relevantes

| Operación | En una sola transacción |
|---|---|
| Confirmar carga | estado/kilometraje de jornada, movimientos `load` (una vez), odómetro, outbox |
| Salida | estado, folio de hoja de salida, pedidos → “En camino” + eventos, outbox |
| Confirmar entrega | entrega, partidas, devoluciones, movimientos (entrega, devolución vendible/dañada), remisión por cobrar, nota de crédito aplicada, estado de parada y pedido, evidencias (borrador → definitiva + firma), borrado de borrador, outbox |
| No entrega | registro, parada, pedido (cerrado o reprogramado), evidencias, outbox — **sin tocar inventario** |
| Cobro | pago, aplicaciones por documento, saldos, outbox (idempotente por clave) |
| Corte | corte, paradas sin visitar y pedidos reprogramados (cierre excepcional), jornada cerrada, odómetro, outbox |

### Inventario de la unidad

Se calcula por movimientos: `disponible = carga − entregado + devuelto vendible`;
lo dañado se registra aparte. La entrega valida que no se entregue más de lo
disponible; la pantalla muestra inconsistencias (negativos) en lugar de ocultarlas.

### Devoluciones

Cada devolución identifica SKU, cantidad, motivo y condición. Genera una nota de
crédito (`payments.method = creditNote`) aplicada primero a la remisión de esa
entrega y luego a los documentos más antiguos; el remanente queda como saldo a
favor (`receivables.kind = credit`, saldo negativo).

## Evidencias

- Fotos: `image_picker` (cámara) → copia en `<documentos>/evidence/<uuid>.jpg`.
  Firma: PNG del `SignatureController` escrito al confirmar.
- SQLite guarda rutas **relativas** en `evidence_files`. Las fotos se guardan
  primero como borrador (sobreviven a reinicios) y se reasignan al registro final
  en la transacción.
- Limpieza al iniciar: borradores con más de 7 días y archivos huérfanos con más
  de 10 minutos. Un archivo faltante se muestra como “Archivo no disponible”.
- Ubicación: se obtiene **una vez** por pantalla con límite de tiempo; se guarda
  como actual, última conocida (con antigüedad) o no disponible. Nunca se usa
  precisión infinita ni se afirma “verificada”.

## Cuentas y seguridad

- PIN con PBKDF2-HMAC-SHA256 (60 000 iteraciones, sal de 16 bytes, en un isolate).
  La sesión guarda solo el ID de usuario. Bloqueo de 5 minutos tras 5 intentos.
- Códigos de verificación/recuperación: 6 dígitos aleatorios, guardados con hash,
  10 minutos de vigencia, 5 intentos, reenvío tras 30 s. En modo local se
  depositan en `local_messages` (no se envía SMS ni correo).
- Limitaciones: un PIN de 4 dígitos es débil frente a un ataque con acceso al
  archivo de la base; la base no está cifrada; `android:allowBackup="false"`
  evita respaldos automáticos. El control definitivo debe estar en el servidor.
- Rutas protegidas por rol en el router; además, pedidos, comprobantes e
  incidencias verifican que pertenezcan al negocio de la sesión.

## Sincronización (preparada, sin servidor conectado)

Tres estados independientes en `/sync`: **red del sistema** (connectivity_plus),
**datos locales** (todo guardado) y **servidor remoto** (no configurado / último
error / próximo reintento).

- Cada cambio de negocio escribe una operación en `outbox` dentro de su
  transacción, con `idempotency_key` y `depends_on`.
- `NoBackendTransport` (sin URL) **nunca** devuelve éxito: nada se marca enviado.
- `HttpSyncTransport` (con `ENRUTA_API_BASE_URL`) envía en orden, respetando
  dependencias. Solo `acknowledged` borra el estado pendiente; errores temporales
  aplican espera exponencial (30 s → 1 h) con un único temporizador; rechazos
  quedan visibles para reintento manual. No hay bucle continuo.
- El cierre local termina sin esperar al servidor.

### Contrato HTTP propuesto (para el equipo de API + PostgreSQL)

```
POST {ENRUTA_API_BASE_URL}/v1/sync/operations
Idempotency-Key: <idempotency_key>
Authorization: Bearer <token>            (cuando exista autenticación remota)
Content-Type: application/json

{ "id": "...", "entity": "delivery", "type": "delivery.confirm",
  "idempotency_key": "delivery:<stopId>", "depends_on": "workday.depart:<id>",
  "created_at": "2026-11-20T15:04:05Z", "payload": { ... } }

200/201/202                    → confirmada
409 {"status":"duplicate"}     → ya aplicada (confirmada)
400 / 409 / 422                → rechazada (requiere atención)
401 / 403 / 408 / 429 / 5xx    → reintento con espera
```

Tipos emitidos: `access_request.create`, `user.profile`, `customer.contact`,
`order.create|cancel|assign|unassign`, `workday.create`, `load.confirm`,
`workday.depart`, `stop.arrive`, `delivery.confirm|failed`, `delivery.media`,
`payment.create`, `incident.create`, `audit.create`, `closing.submit`.

## Guía para conectar Firebase o una API con PostgreSQL

1. **No conectar la app directamente a PostgreSQL.** La app habla con una API
   (REST/HTTP) que valida, autoriza y escribe en la base. No se incrustan
   credenciales de base de datos en la app.
2. **Envío:** configurar `ENRUTA_API_BASE_URL` activa `HttpSyncTransport`. Para
   Firebase, implementar `SyncTransport` (p. ej. escribiendo cada operación en
   una colección de entrada procesada por Cloud Functions) y sustituir
   `syncTransportProvider`. Las pantallas no cambian.
3. **Autenticación remota:** implementar el login contra el servidor dentro de
   `AuthRepository.login` (o un `AuthGateway` que lo envuelva) y guardar el token
   en almacenamiento seguro; pasar `tokenProvider` a `HttpSyncTransport`.
4. **Recepción (pull):** agregar un servicio que descargue cambios del servidor
   (catálogo, pedidos asignados, aprobaciones, cortes revisados) y los escriba en
   las mismas tablas con `AppDatabase.tx`. Al escribir en SQLite, la UI se
   actualiza sola (`dataVersionProvider`).
5. **Archivos:** subir `evidence_files` (operación `delivery.media`) a
   almacenamiento de objetos (Firebase Storage/S3) y guardar la URL remota.
6. **Aprobaciones reales:** reemplazar las acciones de `/dev` por estados que
   llegan del servidor (usuarios aprobados, cortes aprobados/rechazados,
   seguimiento de incidencias).
7. **Conflictos:** el servidor es la autoridad para folios fiscales, crédito y
   saldos consolidados; la app conserva sus folios locales como referencia.

## Plataformas

- **Android:** `com.enruta.movil`, minSdk 24, targetSdk 36 (Flutter), compileSdk 37
  (exigido por `permission_handler_android` 14). AGP 9.3.1, Kotlin 2.4.20 y Gradle
  9.5.0, alineados con la plantilla de Flutter 3.50.1 (el proyecto original usaba
  AGP 9.1.0, por debajo del mínimo 9.1.1 de Flutter).
  Permisos: Internet, estado de red, cámara, ubicación precisa/aproximada (solo
  primer plano). Visibilidad de paquetes para mapas, cámara y compartir PDF.
  Firma de release mediante `android/key.properties` (ver ejemplo).
- **iOS:** `com.enruta.movil`, iOS 15.0. `Info.plist` con descripciones de
  cámara, ubicación “mientras se usa” y fotos (solo para adjuntar en reportes del
  negocio). `permission_handler` toma los permisos de `Info.plist` con Swift
  Package Manager; el `Podfile` incluye las macros equivalentes para CocoaPods.
- **Seguimiento:** solo en primer plano (no hay modos en segundo plano). Si el
  sistema suspende o cierra la app, el registro del recorrido se detiene.
- **Web:** `sqflite_common_ffi_web` (SQLite WASM + IndexedDB) seleccionado con
  import condicional (`lib/data/db/platform/`). Evidencias en `file_blobs`
  (`DbFileStore`); en móvil se usan archivos (`IoFileStore`). Sin mapa (WebView) ni
  sincronización HTTP. Esquema v3 agrega `file_blobs` (migración 2→3).
- Linux y escritorio no son objetivos.

## Material

Flutter 3.47 deprecó `package:flutter/material.dart` en favor del paquete
`material_ui`, que ya usan go_router, printing y riverpod. La app usa
`material_ui` para compartir los mismos tipos (`MaterialApp`, `Theme`,
`MaterialLocalizations`). `signature` y `mobile_scanner` todavía importan el
Material del SDK solo para utilidades sin ancestros (colores/íconos).

## Sistema de diseño de la interfaz

- **Tokens** (`lib/core/theme/tokens.dart`): espaciado `Sp`, radios `Rd`, tamaños táctiles `Hit` (mínimo 48 dp, botón principal 56 dp), duraciones `Dur` (120/220/320 ms) y curvas `Crv`.
- **Tema** (`app_theme.dart`): `AppTheme.of(client:, reducedMotion:)`. Conductor = azul marino + ámbar; negocio = esmeralda. Superficies planas con borde (sin sombras ni degradados); el acento se expresa con el color del borde. Los pares de texto/fondo se verifican con AA en `test/design_system_test.dart`.
- **Componentes compartidos** (`lib/core/widgets/`): `EnScaffold` (encabezado de rol + zona segura + banner de sincronización + pie con la acción principal), `HeroPanel` (estado actual + siguiente acción), `StageStepper` (etapas de jornada y de pedido), `ListGroup`/`ListRow` (listas agrupadas en lugar de pilas de tarjetas), `StatusBadge` (icono + texto, nunca solo color), `InfoBanner`, `EmptyState`/`ErrorView`/`SkeletonList`/`AsyncBody` (carga, vacío, error y reintento).
- **Movimiento** (`motion.dart`): `PressScale`, `FadeSlideIn`, `StateSwitcher`, `Reveal`, `ShakeOnChange`, fundido entre pestañas. Solo animaciones nativas de Flutter, sin animaciones continuas en mapa ni pantallas operativas. Con "reducir movimiento" del sistema (`MediaQuery.disableAnimations`) las duraciones pasan a cero y las transiciones de página son instantáneas.
- **Accesibilidad**: contraste AA, objetivos ≥ 48 dp, etiquetas semánticas, texto escalable hasta 200 % (las filas pasan a disposición vertical) y pruebas en 320×568.
