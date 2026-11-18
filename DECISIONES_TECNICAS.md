# EnRuta — Decisiones técnicas y arquitectura objetivo

> Documento vivo. Versión 1 (Fase 1 implementada). Fecha: 2026-11-18.
> Las secciones 1–5 son el diseño original; la **sección 6** registra lo que cambió o se confirmó al implementar la Fase 1 y **prevalece** sobre el texto original cuando difieren.
> Cada decisión lleva un identificador `DT-xx` que se cita en el código, en los commits y en `PLAN_AVANCE.md`.

---

## 1. Diagnóstico del estado actual

### 1.1 Inventario verificado

| Área | Lo que hay realmente | Evidencia |
|---|---|---|
| Frontend | Angular **22.2.5** (CLI 22.2.6), TypeScript 6.0.3, RxJS 7.8.2, **zone.js 0.16.3**, standalone components, `mapbox-gl` 3.34.2, `angularx-qrcode` 22.0.1, `fflate` (XLSX) | `package.json`, `node_modules/*/package.json` |
| Detección de cambios | `provideZoneChangeDetection({ eventCoalescing: true })` + polyfill `zone.js` → **modo Zone.js**, estrategia `Default` en todas las pantallas | `src/app/app.config.ts`, `angular.json` |
| Navegación | `AppComponent` conmuta 31 pantallas según `state.view` / `state.authView`; el router solo se usa para `forgot-password` y `reset-password` | `app.component.ts`, `app.routes.ts` |
| Estado | `EnrutaState` (1 629 líneas) concentra **todo**: cuentas, sesiones, hash PBKDF2 en navegador, catálogos, rutas, aprobaciones, liquidaciones, auditoría, parámetros, formularios, marca, integraciones | `core/enruta-state.service.ts` |
| Persistencia de negocio | **`localStorage`** (`enruta.accounts`, `enruta.data.<empresa-normalizada>`, `enruta.session`, `enruta.sid`, `enruta.recovery`) | `persist()`, `loadCompanyData()` |
| Backend | Node.js (CommonJS) + Express 4, `pg` (PostgreSQL), `bullmq` + `ioredis` (Redis), `jsonwebtoken`, `nodemailer`, `express-rate-limit`, `dotenv` | `backend/package.json` |
| Endpoints existentes | Conductores, vehículos, dispositivos (CRUD), QR de vinculación (token JWT + `jti` de un solo uso), `/api/mobile/link`, validación RFC (idoo.dev), alta de empresa, recuperación de contraseña (JWT + `Map` en memoria), Carta Porte (cola BullMQ, PAC sandbox/live) | `backend/src/server.js`, `routes/*` |
| Esquema SQL | Postgres: `drivers`, `vehicles`, `devices`, `device_link_tokens`, `device_links`, `company_validations`, `companies`, `carta_porte_documents`. **No existen** usuarios, roles, clientes, productos, rutas, entregas, cobros, etc. | `backend/sql/schema.sql` |
| Docker | `docker-compose.yml`: `postgres:16`, `redis:7`, `api`. `ADMIN_API_KEY` y `JWT_SECRET` fijos en el compose | `docker-compose.yml` |
| Mapbox | Token público `pk.` embebido en `core/config.ts`; geocodificación, direcciones y `optimized-trips` vía `fetch` directo desde el navegador | `core/mapbox.service.ts`, `core/route-map.component.ts` |
| Móvil | **No hay proyecto Flutter** (ni `pubspec.yaml` ni `.dart`), ni en el árbol ni en `Enruta-Flutter.zip` (el ZIP es una copia anterior del mismo proyecto web) | `find`, `unzip -l` |
| SSR | `server.ts` y `main.server.ts` existen, pero `angular.json` no declara `server`/`ssr` → **SSR inactivo** | `angular.json` |
| Pruebas | Front: Karma/Jasmine (`app.component.spec.ts`, `screen-boundary.component.spec.ts`). Back: `node:test` (4 archivos; `companyValidation.test.js` requiere PostgreSQL vivo) | `src/**/*.spec.ts`, `backend/test` |
| Compilación | `ng build --configuration development` compila sin errores (bundle inicial 2.71 MB). La salida se restauró para no alterar `dist/` versionado | ejecución local |
| Entorno | Node 22.23.5, npm 10.9.9. `backend/node_modules` **no instalado**. `backend/.env.example` **referenciado en la documentación pero inexistente** | `node -v`, `ls backend` |

### 1.2 Hallazgos críticos (bloqueantes para producción)

| # | Hallazgo | Impacto |
|---|---|---|
| H1 | `API_KEY = 'dev-admin-key'` embebida en Angular (`core/config.ts`) y enviada en cada petición como credencial administrativa | Cualquiera con el bundle es administrador de la API |
| H2 | Aislamiento por header `x-company` = nombre de empresa normalizado (`"Mi Empresa"` → `mi-empresa`) sin validar pertenencia | Lectura/escritura cruzada entre empresas; colisiones de nombre |
| H3 | Autenticación 100 % en navegador (PBKDF2 en `localStorage`, cuenta demo con hash fijo) | No hay sesión real; no funciona multi-navegador; la recuperación por correo "consume" el token en backend pero cambia la contraseña en el `localStorage` del navegador que abre el enlace |
| H4 | Bloqueo por intentos, revocación de sesiones y caducidad por inactividad viven en `localStorage` | Se evaden borrando almacenamiento; no afectan a otros navegadores |
| H5 | RBAC solo visual: `canAccess()` con listas fijas por nombre de rol; el editor de permisos guarda casillas que nadie evalúa | Sin autorización en backend |
| H6 | Rutas, aprobaciones, liquidaciones, precios, formularios, parámetros, notificaciones y auditoría solo en `localStorage` | Sin fuente de verdad; se pierden al cambiar de navegador |
| H7 | Aprobación de ruta sin versión: editar una ruta "Publicada" no invalida la aprobación | Se ejecutan rutas no aprobadas |
| H8 | "Cambiar de centro" solo renombra `centerName` y **puede renombrar la empresa de la cuenta** (`switchContext()`); no filtra datos | Falsa sensación de aislamiento |
| H9 | Integraciones con `connectionState` = `true` por defecto → la UI dice "Conectado" sin comprobar nada | Viola la regla de honestidad operativa |
| H10 | Torre de control muestra la píldora **"En vivo"** fija; no existe recepción de GPS | Indicador falso |
| H11 | Recuperación de contraseña: `jti` usados en un `Map` en memoria (se olvidan al reiniciar) y modo "local" que muestra el código en un toast | Token reutilizable tras reinicio |
| H12 | `persist()` llama `appRef.tick()` en un microtask y el temporizador de inactividad fuerza `appRef.tick()`; `NgZone.run` manual para el RFC | Síntomas de vista que no se actualiza tratados con parches |
| H13 | Dependencia de PostgreSQL + Redis para arrancar (`migrate()` aborta el proceso si no hay BD) | Imposible demo local sin Docker |
| H14 | En el ZIP original, `docker-compose.yml` declaraba `IDOO_API_KEY: ${IDOO_API_KEY:-}` en `environment:`; esa clave **vacía** tiene precedencia sobre `env_file` y borraba la clave real de `backend/.env`. El árbol actual ya quitó la línea, pero el código (`process.env.IDOO_API_KEY || ''`) sigue tratando vacío como "no configurado" sin advertir y `dotenv` no sobrescribe variables ya definidas (aunque estén vacías) | Validación fiscal "no configurada" de forma silenciosa |
| H15 | Liquidación: montos "cobrado" y "depositado" se teclean a mano; no se derivan de cobros; se puede liquidar la misma ruta varias veces | Conciliación ficticia |
| H16 | Evidencias, firmas, logo de marca y foto de perfil se guardarían como Data URL en `localStorage` | Límite de 5 MB y datos binarios en JSON |

### 1.3 Lo que funciona y se conserva

- **Diseño visual completo** (`src/styles.css` 50 KB, 62 plantillas) — no se rediseña.
- Generador XML de **Carta Porte 3.1** en cliente (`core/carta-porte.ts`) y su pantalla.
- Importación CSV/XLSX (`fflate`) con detección de delimitador y vista previa (`import-templates.ts`).
- Cliente idoo.dev (`clients/idoo.client.js`) con clasificación de errores y backoff — se envuelve en un adaptador.
- Validación de formato de RFC moral (`utils/rfc.js`).
- Lógica de vinculación QR (token de un solo uso, invalidación de QR previos, alta automática de hardware) — se porta a SQLite.
- Componente de mapa (`route-map.component.ts`) que ya corre Mapbox fuera de la zona.
- Directiva `validate-form` y `screen-boundary` (captura de errores por pantalla).

---

## 2. Arquitectura objetivo

```
┌───────────────────────── Navegador (PC o móvil en LAN) ─────────────────────────┐
│ Angular 22 (Zone.js)                                                             │
│  core/http      ApiClient (HttpClient+fetch) · interceptores: sesión, scope, err │
│  core/session   SessionStore (signals) · ScopeStore (empresa/centro/epoch)       │
│  core/rbac      PermissionStore · *appCan · canMatch guard                       │
│  core/realtime  EventStream (SSE /api/events)                                    │
│  features/*     stores por dominio (signals)  ← EnrutaState queda como fachada   │
│  /repartidor/** vista móvil (mobile-first) con los mismos endpoints que Flutter  │
└───────────────┬─────────────────────────────────────────────────────────────────┘
                │ /api (proxy de ng serve en dev; mismo origen → cookie HttpOnly)
┌───────────────▼─────────────────────── Node.js 22 + Express 4 ──────────────────┐
│ middleware: requestId · sesión · tenant(ctx) · requirePermission · idempotencia  │
│ routes/ → services/ (reglas de negocio) → repositories/ (interfaz)               │
│                                             └─ sqlite/ (better-sqlite3)          │
│ adapters/: rfc · pac · mail · maps(server-side opcional)  (local | real)         │
│ queue/: jobs_queue en SQLite + worker con lease y recuperación                   │
│ storage/: evidencias en ./storage/evidences (servidas con auth)                  │
│ realtime/: SSE por empresa                                                       │
└──────────────┬───────────────────────────────────────┬──────────────────────────┘
               ▼                                       ▼
      ./data/enruta.sqlite (WAL)            ./storage/evidences/<companyId>/...
```

### 2.1 Estructura de carpetas del backend

```
backend/
  migrations/                 001_core.sql, 002_catalog.sql, ... (solo hacia adelante)
  scripts/                    migrate.js, seed-reset.js
  src/
    app.js                    construye la app Express (sin listen) → usable en pruebas
    server.js                 carga config, migra, arranca worker, listen(HOST, PORT)
    config/index.js           lectura tipada de env (DT-32)
    db/sqlite.js              conexión, PRAGMAs, mutex de transacciones (DT-04)
    db/migrator.js
    repositories/index.js     createRepositories(db) → { companies, users, routes, ... }
    repositories/sqlite/*.js  una implementación por agregado
    services/*.js             auth, tenant, rbac, routes, approvals, devices, visits,
                              payments, settlements, pricing, inventory, parameters,
                              config-versions, forms, tracking, simulator, reports,
                              audit, notifications, fiscal, mail
    adapters/{rfc,pac,mail}/{local,real}.js + index.js (selección por env)
    queue/{queue.js,worker.js,handlers/*.js}
    storage/evidence-store.js
    realtime/sse.js
    middleware/*.js
    routes/*.routes.js        /api/auth, /api/companies, /api/users, /api/roles, ...
                              /api/mobile/v1/* (contrato compartido Flutter/web repartidor)
    utils/                    rfc.js (existente), money.js, ids.js, time.js, errors.js
  test/                       node:test; cada archivo crea BD :memory: y storage temporal
```

### 2.2 Estructura del frontend (sin rediseño)

```
src/app/
  core/http/        api-client.ts, session.interceptor.ts, scope.interceptor.ts, error.interceptor.ts
  core/session/     session.store.ts, scope.store.ts
  core/rbac/        permission.store.ts, can.directive.ts, permission.guard.ts
  core/realtime/    event-stream.service.ts
  core/config.ts    solo valores públicos; sin API_KEY (DT-07)
  features/<dominio>/<dominio>.store.ts  (catalog, clients, prices, routes, approvals, devices,
                    tracking, deliveries, settlements, reports, audit, config, forms,
                    parameters, notifications, users, fiscal)
  driver/           shell móvil /repartidor y sus pantallas
  dev/              /dev/correo (bandeja local, solo MAIL_MODE=local)
  screens/          plantillas existentes (se conservan; cambian solo los enlaces de datos)
  core/enruta-state.service.ts  → fachada delgada que expone los stores a las plantillas
```

---

## 3. Decisiones

### Persistencia y datos

**DT-01 · Motor: SQLite con `better-sqlite3` 13.x.** Node 22.23 cumple `engines >=22`; trae binarios precompilados. Se descarta `node:sqlite` (aún experimental en 22.x). Archivo por defecto `./data/enruta.sqlite` (relativo a `backend/`, configurable con `DB_PATH`). PRAGMAs: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`.

**DT-02 · Arranque nunca destructivo.** `server.js` solo ejecuta migraciones pendientes. Borrar datos es exclusivo de `npm run seed:reset`, que exige `--yes` (o `SEED_RESET_CONFIRM=1`) y se niega si `NODE_ENV=production`. Pruebas: `DB_PATH=:memory:` y `STORAGE_DIR` en `fs.mkdtemp`.

**DT-03 · Migraciones.** Archivos SQL numerados en `backend/migrations/`, tabla `schema_migrations(version, name, checksum, applied_at)`; cada migración en su propia transacción; si cambia el checksum de una aplicada, el arranque falla con mensaje claro. Solo hacia adelante.

**DT-04 · Repositorios asíncronos sobre un driver síncrono.** Todos los métodos de repositorio devuelven `Promise` aunque `better-sqlite3` sea síncrono, para que el cambio a `pg` no toque servicios. Transacciones: `uow.run(async (repos) => …)` abre `BEGIN IMMEDIATE` en la única conexión y toma un **mutex asíncrono**; toda escritura fuera de `uow` también pasa por el mutex, de modo que nunca se intercala una escritura ajena dentro de una transacción abierta. Lecturas sin mutex (WAL).

**DT-05 · Identificadores y tipos.** IDs `TEXT` UUID v4 (`crypto.randomUUID()`), nunca nombres. Dinero en **centavos enteros** (`INTEGER`), moneda `MXN`. Fechas `TEXT` ISO-8601 UTC (`2026-11-17T23:30:00.000Z`); fechas de negocio (`route_date`) como `YYYY-MM-DD` en la zona horaria de la empresa. JSON en `TEXT` con `CHECK (json_valid(col))`. Booleanos `INTEGER 0/1`.

**DT-06 · Modelo de datos (tablas por migración).**

| Migración | Tablas |
|---|---|
| 001_core | `companies`(id, rfc, legal_name, plan, timezone, fiscal_status, status), `centers`, `zones`(center_id), `users`(company_id, email UNIQUE global, password_hash, status ACTIVE/INACTIVE/LOCKED, failed_attempts, locked_until, totp_secret_enc, totp_enabled, default_center_id), `user_centers`, `roles`(company_id, name, is_system, max_discount_bp), `permissions`(code PK, description), `role_permissions`, `user_roles`, `sessions`(token_hash, user_id, company_id, center_id, ua, ip, created_at, last_seen_at, expires_at, revoked_at, revoked_reason), `password_reset_tokens`(token_hash, user_id, expires_at, used_at), `mfa_challenges`, `login_attempts`(email, ip, at, ok), `audit_log`, `notifications`, `dev_mailbox`, `idempotency_keys`, `jobs_queue`, `company_validations` |
| 002_catalog | `clients`(company_id, center_id, zone_id, code, name, rfc, lat, lng, address, credit_limit_cents, credit_days, price_list_id, status), `products`(sku, name, category, unit, status), `price_lists`(valid_from, valid_to, priority, is_default), `price_list_items`, `promotions`, `discount_rules`, `center_stock`(center_id, product_id, qty, min_qty), `assets`(comodato: serial, client_id, status) |
| 003_fleet | `vehicles`, `devices`(company_id, alias, hardware_serial, brand, model, os, os_version, app_version, driver_user_id, vehicle_id, status, last_seen_at), `device_link_tokens`(jti, token_hash, company_id, device_id NULL, expires_at, used_at), `device_links`(historial), `device_sessions`(token_hash, device_id, revoked_at) |
| 004_routes | `routes`(company_id, center_id, zone_id, name, route_date, operator_user_id, vehicle_id, device_id, status, revision, approved_revision, color, started_at, finished_at), `route_stops`(route_id, client_id, seq, planned_eta), `route_approvals`(route_id, revision, requested_by, decided_by, decision, reason), `route_status_history`, `route_loads`(stock cargado al camión) |
| 005_execution | `visits`(route_stop_id, arrived_at, lat, lng, distance_m, outside_radius_reason, closed_at, status), `orders`(preventa), `deliveries`(visit_id, kind DELIVERY/SALE/PRESALE, status DELIVERED/PARTIAL/FAILED, incident_reason_id), `delivery_lines`(product_id, qty_planned, qty_delivered, unit_price_cents, discount_bp), `incident_reasons`, `evidences`(company_id, visit_id, kind PHOTO/SIGNATURE, path, mime, size, sha256), `payments`(visit_id, method CASH/TRANSFER/CARD/CREDIT, amount_cents, reference), `client_ledger`(cargo/abono, due_date), `exhibition_audits`, `asset_checks`, `form_submissions` |
| 006_tracking | `positions`(company_id, device_id, user_id, route_id, lat, lng, accuracy_m, speed, heading, recorded_at, received_at, source REAL/SIMULATED), `simulations`(route_id, status, speed_kmh, started_by) |
| 007_settings | `config_versions`(company_id, version, status DRAFT/PUBLISHED/SUPERSEDED, payload, published_by/at), `config_acks`(device_id, version, acked_at), `parameters`(scope_type, scope_id, key, value), `form_definitions`(kind entrega/cobro/visita, version, status, fields JSON), `branding`, `integration_status` |
| 008_settlements | `settlements`(route_id **UNIQUE**, expected_cash_cents, expected_other_cents, deposited_cents, diff_cents, tolerance_cents, status, authorized_by), `settlement_deposits`(reference, amount_cents, bank) |
| 009_fiscal | `carta_porte_documents` (port del esquema actual + `mode LOCAL/LIVE`, `simulated`) |

Cada tabla operativa lleva `company_id NOT NULL` y, si aplica, `center_id`; índices compuestos que empiezan por `company_id`.

### Autenticación y sesiones

**DT-07 · Se elimina `API_KEY` del frontend** y el middleware `admin` por `x-api-key`/`x-company`. Las rutas públicas (alta de empresa, validación RFC, login, recuperación) quedan sin llave y protegidas con rate-limit.

**DT-08 · Sesiones opacas en servidor, no JWT.** Token aleatorio de 32 bytes; en BD solo `SHA-256(token)`. Cada petición valida: sesión no revocada ni expirada, usuario `ACTIVE`, empresa activa. Esto da revocación y **bloqueo inmediato** al inactivar un usuario (DT-11). Expiración deslizante 12 h por inactividad, absoluta 7 días ("mantener sesión") o 12 h (sin marcar).

**DT-09 · Transporte del token.** Web: cookie `enruta_sid` `HttpOnly; SameSite=Lax; Path=/api` (`Secure` si `COOKIE_SECURE=1`); el navegador nunca ve el token, `localStorage` queda libre de credenciales. Protección CSRF: toda petición mutante exige el header `X-EnRuta-Client` (no enviable por formularios cruzados) y CORS restringido a `CORS_ORIGINS`. Flutter / dispositivos: `Authorization: Bearer <token>` (sesión de usuario repartidor o `device_session`).

**DT-10 · Hash de contraseñas: `bcryptjs` coste 12** (algoritmo bcrypt `$2b$`, sin compilación nativa adicional). Política existente se conserva: ≥12 caracteres, una mayúscula, un número.

**DT-11 · Bloqueos.** 5 intentos fallidos en 15 min por cuenta → `locked_until = now+15 min` (mensaje genérico, sin revelar si el correo existe). Rate-limit adicional por IP (20/15 min en login). Inactivar usuario → `UPDATE sessions SET revoked_at` + evento SSE `session.revoked` → el front cierra sesión al instante; peticiones posteriores reciben `401 SESSION_REVOKED`.

**DT-12 · Recuperación de contraseña.** Token aleatorio de un solo uso (hash en `password_reset_tokens`), TTL 15 min; se invalida al usarse, al emitir otro y al cambiar contraseña; tras restablecer se revocan **todas** las sesiones del usuario. Respuesta idéntica exista o no el correo. Enlace: `${PUBLIC_WEB_URL}/reset-password?token=…`.

**DT-13 · Correo con adaptador.** `MAIL_MODE=local` (por defecto en dev): los mensajes se guardan en `dev_mailbox` y se consultan en `GET /api/dev/mailbox` y en la vista Angular `/dev/correo`, rotulada **"MODO LOCAL — bandeja de desarrollo, no se envía correo real"**. El endpoint no requiere sesión (para abrirlo desde otro navegador) pero solo existe si `MAIL_MODE=local` y `NODE_ENV!=production`. `MAIL_MODE=smtp` usa el `nodemailer` actual.

**DT-14 · 2FA TOTP (la UI ya lo contempla).** Secreto generado en backend, cifrado AES-256-GCM con `DATA_ENCRYPTION_KEY`; RFC 6238 (SHA-1, 6 dígitos, 30 s, ventana ±1) implementado con `crypto` de Node. Login con 2FA: contraseña correcta → `{ mfaRequired: true, challengeId }` (5 min, 5 intentos) → `/api/auth/mfa/verify` crea la sesión. Desactivar exige código vigente.

**DT-15 · Alta de empresa.** Una transacción crea `companies`, centro "Matriz", roles de sistema con permisos por defecto, usuario administrador y sesión. El RFC se valida con el adaptador (DT-30); con validación simulada la empresa queda `fiscal_status=SIMULATED` y la UI lo muestra siempre.

### Multi-empresa, centro y RBAC

**DT-16 · El tenant sale de la sesión.** `req.ctx = { userId, companyId, centerId, permissions }`. Ningún endpoint acepta `companyId` del cliente; los repositorios exigen `ctx` como primer argumento y añaden `WHERE company_id = ?`. Acceso a un ID de otra empresa → **404** (no 403, para no filtrar existencia).

**DT-17 · Un usuario pertenece a una empresa.** El correo es único global. "Cambiar de empresa" = cerrar sesión e iniciar con otra cuenta (o selector si en el futuro hay membresías múltiples; la tabla `user_centers` ya lo permite para centros). Decisión estándar para evitar ambigüedad de pertenencia.

**DT-18 · Centro activo en la sesión.** `PUT /api/session/center` valida que el usuario tenga acceso (`user_centers` o permiso `centers.all`) y actualiza `sessions.center_id`. Los listados operativos (rutas, clientes, stock, entregas, posiciones, liquidaciones, indicadores) filtran por centro; catálogos de empresa (productos, listas de precios, roles) no. Valor especial "Todos los centros" solo con `centers.all`.

**DT-19 · Limpieza al cambiar de contexto (front).** `ScopeStore` mantiene `epoch` (entero). Cambiar de centro, cerrar sesión o expirar sesión incrementa `epoch` → (1) cada store resetea sus signals, (2) las suscripciones de datos usan `switchMap` sobre `scope$` y se cancelan, (3) el interceptor descarta respuestas cuya `epoch` de emisión ≠ actual, (4) se cierra y reabre el `EventSource`.

**DT-20 · Catálogo de permisos (códigos estables).**
`catalog.read|write`, `clients.read|write`, `prices.read|write`, `import.run`, `routes.read|write|submit|approve|start_outside_window|cancel`, `deliveries.execute`, `payments.collect`, `discounts.apply`, `discounts.over_limit`, `credit.authorize`, `settlements.read|manage|authorize`, `tracking.read`, `simulator.run`, `reports.read`, `audit.read`, `users.manage`, `roles.manage`, `config.manage|publish`, `devices.manage`, `fiscal.manage`, `centers.all`.
Mapeo de las 5 casillas actuales de la UI: "Entregar y capturar evidencia"→`deliveries.execute`; "Cobrar en ruta"→`payments.collect`; "Aplicar descuentos"→`discounts.apply`; "Autorizar crédito"→`credit.authorize`; "Ver precios de otros canales"→`prices.read`. El editor se amplía con el resto agrupado por módulo (mismo estilo visual).

**DT-21 · Roles de sistema sembrados** (editables, no borrables): Administrador (todo), Supervisor (todo salvo `users.manage`, `roles.manage`, `config.publish`, `fiscal.manage`), Repartidor (`deliveries.execute`, `payments.collect`, `discounts.apply` con tope 5 %, `routes.read` propias), Preventista (Repartidor + pedidos de preventa). `max_discount_bp` por rol: Admin 10000, Supervisor 1500, Repartidor 500, Preventista 500.

**DT-22 · Aplicación de RBAC.** Backend: `requirePermission('routes.approve')` en cada ruta Express; servicios verifican reglas finas (p. ej. descuento ≤ tope). Front: `PermissionStore` (signal con la lista de códigos de `/api/session`), directiva `*appCan="'routes.approve'"` para botones, `canAccess(view)` de la fachada pasa a evaluar permisos en vez de nombres de rol. La UI oculta; **el backend decide**.

### Rutas, aprobaciones y versiones

**DT-23 · Máquina de estados.**

```
DRAFT ──submit──▶ PENDING_APPROVAL ──approve(rev)──▶ PUBLISHED ──start──▶ IN_PROGRESS ──close──▶ COMPLETED
  ▲                   │ reject                           │                      │
  └──── edición ◀─────┴──────────── edición ◀────────────┘                      │
DRAFT|PENDING|PUBLISHED ──cancel──▶ CANCELLED          IN_PROGRESS ──cancel(supervisor)──▶ CANCELLED
REJECTED = DRAFT con última decisión "rechazada" (se muestra como "Rechazada" hasta la siguiente edición)
```
Etiquetas UI: Borrador · Pendiente de aprobación · Publicada · En ejecución · Finalizada · Rechazada · Cancelada.

**DT-24 · Versionado y aprobación exacta.** `routes.revision` se incrementa en toda edición relevante (paradas, orden, operador, vehículo, fecha, centro/zona). Una edición sobre `PENDING_APPROVAL` o `PUBLISHED` regresa la ruta a `DRAFT`, marca la aprobación previa como `INVALIDATED`, registra auditoría y notifica. `POST /routes/:id/approve` exige `{ revision }` igual a la actual; si no, `409 REVISION_MISMATCH`. Todas las escrituras usan concurrencia optimista con `revision` (dos editores → el segundo recibe 409). `IN_PROGRESS` y `COMPLETED` no son editables.

**DT-25 · Validaciones para enviar/aprobar/publicar.** Operador asignado, `ACTIVE`, con `deliveries.execute` y del mismo centro; ≥1 parada; todos los clientes activos y con coordenadas; sin clientes duplicados; fecha ≥ hoy (zona horaria de la empresa); vehículo opcional pero, si existe, activo. Auto-aprobación permitida para quien tenga `routes.approve`, registrada en auditoría con `self_approved=true` (decisión estándar para empresas con un solo administrador en la demo).

### Dispositivos, QR y vista de repartidor

**DT-26 · QR de vinculación.** Se conserva el modelo actual (token de un solo uso, TTL 15 min, invalidación de QR previos) portado a SQLite y sin JWT: token opaco con hash en BD. El QR codifica una **URL**: `${PUBLIC_WEB_URL}/repartidor/vincular#t=<token>` (el token va en el fragmento para no quedar en logs). Al escanearlo con la cámara del móvil se abre la vista de repartidor de Angular, que llama `POST /api/mobile/v1/link` con datos de hardware (`navigator.userAgentData`/UA, `source=web`). Flutter usará el mismo contrato leyendo el parámetro `t`. Se acepta también el formato anterior `{v:1, api, token}` por compatibilidad.

**DT-27 · Confirmación en tiempo real con SSE.** `GET /api/events` (Server-Sent Events, sin dependencias) emite por empresa: `device.linked`, `device.revoked`, `route.updated`, `position`, `job.updated`, `config.acked`, `notification`, `session.revoked`. Reemplaza los `setInterval` de sondeo del QR; si SSE falla, el front cae a sondeo cada 5 s con `timer()` de RxJS.

**DT-28 · Asociación conductor-vehículo y revocación.** Un dispositivo se asocia a un usuario repartidor y opcionalmente a un vehículo (índices únicos parciales como hoy). Revocar → `device_sessions.revoked_at`, estado `Inactivo`, evento SSE; el móvil recibe `401 DEVICE_REVOKED`. Estado `Robado` bloquea vinculación (regla existente).

**DT-29 · Vista de repartidor en Angular (no hay Flutter).** Ruta `/repartidor` mobile-first, con login de usuario repartidor o sesión de dispositivo. Pantallas: Mi ruta del día → Iniciar ruta → Lista de paradas (mapa opcional) → Llegada → Entrega (líneas, parcial, fallida con motivo) → Evidencias (cámara `<input capture>` y lienzo de firma) → Cobro → Cerrar visita → Cerrar ruta; incidencias; envío de GPS (`navigator.geolocation.watchPosition`) con `source=REAL`. Contrato REST `/api/mobile/v1/*` documentado en `README_LOCAL.md` para Flutter. **No se crean ni modifican archivos Flutter.**

### Integraciones y honestidad operativa

**DT-30 · Adaptadores `local` / `real`.** Selección por env: `RFC_MODE=local|idoo`, `PAC_MODE=local|live` (`sandbox` se acepta como alias de `local`), `MAIL_MODE=local|smtp`. Los modos locales son **deterministas** y permiten forzar escenarios:
- RFC local: prefijo del RFC `REJ…`→ rechazado, `MIS…`→ razón social no coincide, `ERR…`→ error de proveedor, `TMO…`→ timeout (espera `RFC_LOCAL_TIMEOUT_MS`); cualquier otro → `SIMULATED` válido.
- PAC local: prefijo del folio `REJ-`→ rechazo del PAC, `ERR-`→ error transitorio (reintenta y termina en error), `TMO-`→ timeout, otro → `Simulado`.
- Ningún modo local genera UUID fiscal ni `TimbreFiscalDigital`; `pac_uuid` queda `NULL` y la UI rotula **"Simulado / Desarrollo — sin validez fiscal"**.

**DT-31 · Estado de integraciones real.** Se elimina `connectionState` booleano. `GET /api/integrations` devuelve por integración `{ mode, configured, simulated, lastCheckAt, lastCheckOk, lastError }`; "Conectado" solo si hay `lastCheckOk` en las últimas 24 h con modo real. Las integraciones sin implementación (ERP, telemetría, pagos con tarjeta, SMS, WhatsApp, push) se muestran como **"No disponible en esta versión"**. Mapbox se marca "Servicio externo (requiere Internet)".

**DT-32 · `IDOO_API_KEY` y variables vacías.** (a) `docker-compose.yml` no declarará ninguna clave secreta en `environment:`; solo `env_file: backend/.env` (precedencia documentada). (b) `config/index.js` trata `''` y espacios como *no definido* (`envStr()`); `dotenv` se carga con `override: true` **solo para variables vacías** (se rellena una vacía con el valor del archivo, nunca se pisa una no vacía). (c) Al arrancar se registra el modo efectivo (`RFC_MODE=idoo` sin clave → error de configuración explícito en `/api/integrations`, nunca "Conectado").

**DT-33 · Mapbox.** El token público `pk.` sale de `core/config.ts` y lo sirve `GET /api/system/client-config` desde `MAPBOX_PUBLIC_TOKEN` (debe restringirse por URL en Mapbox). Mapbox es la **única dependencia externa** aceptada (teselas del mapa); sin Internet la app funciona: listas sin mapa, distancias en línea recta marcadas "estimado" (ya existe el flag `estimated`), optimización de secuencia por vecino más cercano local.

### Ejecución en campo

**DT-34 · Idempotencia.** Todo `POST` de `/api/mobile/v1/*` y de cobros/liquidaciones exige `Idempotency-Key` (UUID generado por el cliente por acción). Tabla `idempotency_keys(company_id, key, route, request_hash, status_code, response, created_at)`: misma clave + mismo cuerpo → misma respuesta; misma clave + cuerpo distinto → `422 IDEMPOTENCY_MISMATCH`; TTL 48 h. En la UI los botones se deshabilitan mientras hay petición en curso (doble clic) y los reintentos reutilizan la clave.

**DT-35 · Llegada y radio de visita.** Llegada registra GPS; si `distance > visit_radius_m` efectivo, se **permite** pero exige motivo (`outside_radius_reason`) y se marca en indicadores (decisión estándar: no bloquear al repartidor por mala señal).

**DT-36 · Entregas.** `DELIVERED` (todas las líneas completas), `PARTIAL` (alguna línea < planeada; motivo por línea), `FAILED` (cero entregado; motivo de incidencia obligatorio). Foto/firma obligatorias según el formulario publicado de "entrega" (campos tipo Foto/Firma con `required`). El backend rechaza el cierre de visita si faltan evidencias obligatorias.

**DT-37 · Evidencias en disco.** Subida binaria `POST /api/mobile/v1/visits/:id/evidences?kind=PHOTO|SIGNATURE` con `Content-Type` `image/jpeg|png|webp` (cuerpo crudo vía `express.raw`, límite 8 MB, verificación de *magic bytes*). Ruta: `./storage/evidences/<companyId>/<yyyy>/<mm>/<uuid>.<ext>`; en BD solo metadatos + SHA-256. Servidas por `GET /api/evidences/:id` con sesión, misma empresa y permiso (`tracking.read` o autor), `Cache-Control: private, no-store`. Logo y foto de perfil siguen el mismo mecanismo (`storage/branding`, `storage/avatars`).

**DT-38 · Cobros y saldo.** Métodos: efectivo, transferencia, tarjeta (referencia manual, sin pasarela), crédito. Venta a crédito genera cargo en `client_ledger` con vencimiento `credit_days`; cobros generan abonos. Saldo pendiente = Σ cargos − Σ abonos. **Bloqueo por saldo vencido**: si el cliente tiene cargos vencidos más de `overdue_block_days`, se bloquea vender a crédito (solo contado) salvo `credit.authorize`. Exceder `credit_limit_cents` requiere `credit.authorize`.

**DT-39 · Cierre de ruta.** Requiere todas las paradas con visita cerrada (entregada, parcial o fallida) o marcadas "no visitada" con motivo; al cerrar se crea la liquidación en estado `OPEN` con importes esperados calculados.

### GPS y torre de control

**DT-40 · Posiciones.** `POST /api/mobile/v1/positions` acepta lote (≤100) con `recorded_at` del dispositivo; se descartan coordenadas inválidas y precisión > 500 m. Retención: sin purga en local (documentado).

**DT-41 · Estado visual del vehículo.**
- **Ubicación real**: última posición `REAL` con antigüedad ≤ `GPS_STALE_SECONDS` (120 s).
- **Ubicación simulada**: última posición `SIMULATED` ≤ 120 s (marcador con trama/etiqueta "SIMULADO").
- **Desactualizado**: 120 s < antigüedad ≤ `GPS_OFFLINE_SECONDS` (900 s).
- **Desconectado**: > 900 s o sin posiciones.
La píldora "En vivo" solo aparece si existe ≥1 vehículo con ubicación real reciente; si solo hay simuladas dice "Simulación activa"; si no, "Sin datos en vivo".

**DT-42 · Simulador explícito.** `POST /api/routes/:id/simulation` (permiso `simulator.run`) inicia un recorrido sobre la geometría de la ruta (polilínea de Mapbox si está cacheada; si no, segmentos rectos entre paradas) a `speed_kmh` (40 por defecto), un punto cada 5 s, `source=SIMULATED`. Se detiene manualmente o al terminar. Solo en `NODE_ENV!=production` o con `SIMULATOR_ENABLED=1`.

### Configuración, formularios y parámetros

**DT-43 · Configuración versionada.** Borrador editable (módulos, formularios, marca, parámetros) → "Publicar" crea `config_versions.version = n+1` `PUBLISHED` y marca la anterior `SUPERSEDED`. Los dispositivos obtienen `GET /api/mobile/v1/config` y confirman con `POST …/config/ack {version}`; el panel muestra "Recibida por X de Y dispositivos".

**DT-44 · Constructor de formularios.** Se conservan los tipos actuales (Texto, Número, Fecha, Selección, Foto, Firma, Código de barras, Casilla) y propiedades (`required`, `min`, `max`, `maxLength`, `options`, `visible`, `defaultValue`). Un validador compartido (función pura JS, copiada en TS para el front) valida capturas en el repartidor y **de nuevo en backend** contra la versión publicada que el dispositivo declaró.

**DT-45 · Herencia de parámetros.** Resolución de más específico a más general: `Usuario > Ruta > Zona > Centro > Empresa > valor por defecto del sistema`. Valor vacío = hereda. Claves y defaults:

| Clave | Default | Regla aplicada |
|---|---|---|
| `visit_radius_m` | 150 | DT-35 |
| `cash_tolerance_cents` | 5 000 ($50.00) | DT-47 |
| `overdue_block_days` | 30 (0 = desactivado) | DT-38 |
| `loading_window` | `06:00-09:00` (zona de la empresa) | iniciar ruta fuera de la ventana requiere `routes.start_outside_window` |
| `min_client_version` | `1.0.0` | el móvil envía `X-Client-Version`; si es menor → `426 UPGRADE_REQUIRED` |

`GET /api/parameters/effective?routeId&userId` devuelve valor y **origen** (de qué nivel vino) para mostrarlo en el panel.

### Precios, inventario y liquidaciones

**DT-46 · Precios.** Lista del cliente vigente hoy → si no, lista por defecto de la empresa vigente → si no, error "Producto sin precio". Vigencia `[valid_from, valid_to]` inclusive; empate por `priority`. Promociones (porcentaje o monto por producto y vigencia) se aplican antes del descuento manual. Descuento manual ≤ `max_discount_bp` del rol; por encima → requiere `discounts.over_limit` o crea solicitud en Aprobaciones.

**DT-46b · Inventario.** Stock por centro (`center_stock`) y carga por ruta (`route_loads`, al iniciar ruta se descuenta del centro). Autoventa descuenta de la carga; **nunca negativo** (409 `INSUFFICIENT_STOCK`, verificado dentro de la transacción). Al cruzar `min_qty` se genera notificación. Preventa crea `orders` sin mover stock hasta su entrega. Comodato: alta/retiro de activos por cliente y verificación en visita. Auditoría de exhibición: frentes por producto + foto. Cada flujo solo está disponible si su módulo está activo en la configuración publicada.

**DT-47 · Liquidaciones.** Esperado = Σ cobros en efectivo de la ruta (otros métodos se muestran por separado). Se registran uno o más depósitos; diferencia = depositado − esperado. Estados: `OPEN` → `BALANCED` (dif = 0) | `WITHIN_TOLERANCE` (|dif| ≤ tolerancia efectiva) | `PENDING_AUTHORIZATION` (|dif| > tolerancia) → `AUTHORIZED`/`REJECTED` por `settlements.authorize` (distinto de quien capturó). `UNIQUE(route_id)` impide doble liquidación; una liquidación cerrada es inmutable. Todo en auditoría.

### Cola de trabajos

**DT-48 · `jobs_queue` en SQLite.** Columnas: `id, company_id, type, payload, status (PENDING|RUNNING|SUCCEEDED|FAILED|DEAD), attempts, max_attempts (5), run_at, locked_by, locked_until, last_error, dedupe_key UNIQUE(type, dedupe_key), created_at, updated_at`. Worker en el mismo proceso: cada 1 s reclama atómicamente con `UPDATE … SET status='RUNNING', locked_until=now+lease WHERE id = (SELECT id … WHERE status='PENDING' AND run_at<=now ORDER BY run_at LIMIT 1) RETURNING *`. Reintento con backoff exponencial `2^attempts × 2 s` (máx. 5 min); al agotar → `DEAD`. **Recuperación**: al arrancar y cada minuto, `RUNNING` con `locked_until < now` vuelve a `PENDING`. Tipos: `CARTA_PORTE_STAMP`, `SEND_MAIL`, `STOCK_ALERT`, `NOTIFY`. Cambios de estado emiten `job.updated` por SSE. Se eliminan `bullmq`, `ioredis` y Redis.

### Frontend: detección de cambios y reactividad

**DT-49 · Se mantiene Zone.js** (`provideZoneChangeDetection` explícito, Angular 22). Migrar a zoneless ahora multiplica el riesgo sobre 62 plantillas con estado mutable. Estrategia coherente:
1. Estado en **signals** dentro de stores por dominio; mutaciones siempre inmutables (`set`/`update` con objetos nuevos).
2. HTTP con `HttpClient` (`provideHttpClient(withFetch(), withInterceptors(...))`) en vez de `fetch` suelto.
3. Flujos con RxJS: `switchMap` para búsquedas/filtros y cambio de scope, `exhaustMap` para envíos (evita doble clic), `takeUntilDestroyed()` en componentes, `timer()/interval()` en lugar de `setInterval`/`setTimeout`.
4. Callbacks de Mapbox y `geolocation` siguen fuera de la zona y **solo escriben signals** (los signals programan la detección aunque estén fuera de la zona).
5. Se eliminan `appRef.tick()` en `persist()` y en el temporizador de inactividad, y el `NgZone.run` del RFC.
6. Pantallas migradas a `OnPush` conforme leen signals; prohibido `detectChanges()` salvo en el lienzo de firma si fuera imprescindible (documentar).
Puntos a corregir explícitamente: login/logout, validación RFC, CRUD, mapa, temporizadores, sondeo, QR, carga/error, cambio de centro, estados de Carta Porte.

**DT-50 · `EnrutaState` como fachada.** Las 31 pantallas usan `app.x`/`state.x`; para conservar el diseño sin reescribir plantillas, `EnrutaState` se adelgaza hasta delegar en los stores (getters que leen signals y métodos que llaman servicios). Se elimina toda escritura de negocio a `localStorage`.

**DT-51 · `localStorage` solo para preferencias visuales** (`enruta.prefs.*`: tema, filtros, pestaña activa, panel colapsado). En el primer arranque tras la migración se borran `enruta.accounts`, `enruta.data.*`, `enruta.session`, `enruta.sid`, `enruta.recovery`. **No se importan** datos antiguos (contraseñas PBKDF2 del navegador incompatibles y datos no verificables) — se documenta en `README_LOCAL.md`.

**DT-52 · Navegación.** Se mantiene el conmutador de pantallas del panel (funciona y preserva diseño) y se añaden rutas del router para `/repartidor/**`, `/dev/correo`, `/forgot-password`, `/reset-password`. Guard `canMatch` por permiso en las rutas nuevas.

### Red local, QR y arranque

**DT-53 · Escucha en `0.0.0.0`.** Backend `HOST=0.0.0.0`, `PORT=3000`. Front: `ng serve --host 0.0.0.0 --port 4200` con `allowedHosts` permisivo solo en dev; el proxy `/api → http://127.0.0.1:3000` hace que el móvil solo necesite el puerto 4200 y que la cookie sea del mismo origen.

**DT-54 · URL base pública.** `PUBLIC_WEB_URL` (p. ej. `http://192.168.1.50:4200`) se usa para QR y enlaces de correo. Si contiene `localhost`/`127.0.0.1`, el backend registra advertencia al arrancar y `GET /api/system/network` devuelve `{ publicWebUrl, warning, lanAddresses[] }` (IPs detectadas con `os.networkInterfaces()`); la pantalla de Dispositivos muestra la advertencia junto al QR.

**DT-55 · SSR.** Se deja inactivo (no configurado hoy); `server.ts` no se toca.

**DT-56 · Docker.** `docker-compose.yml` pasa a un solo servicio `api` (Node 22, compila `better-sqlite3`) con volúmenes `./backend/data` y `./backend/storage`, `env_file` y sin secretos. Postgres/Redis se retiran; el esquema Postgres actual se archiva en `backend/sql/legacy-postgres-schema.sql` como referencia.

### Pruebas

**DT-57 · Estrategia.**
- Backend: `node:test` + `fetch` nativo contra `app.listen(0)`; cada archivo crea BD `:memory:` (o archivo temporal cuando se prueba reinicio) y `STORAGE_DIR` temporal. Sin dependencias nuevas.
- Frontend unitario: Karma/Jasmine existente, ChromeHeadless (`CHROME_BIN` configurable).
- E2E: `@playwright/test` como **nueva devDependency** (justificada: escenarios multi-navegador, reinicio y reactividad no son verificables con Karma). `webServer` levanta backend con `DB_PATH` temporal y `ng serve`; escenarios multi-navegador con varios `browser.newContext()`; reinicio de backend controlado desde `globalSetup`.
- Resultados reales en `ESTADO_IMPLEMENTACION.md` (salida resumida de cada comando).

### Dependencias

**DT-58 · Cambios de dependencias (mínimos).**
- Backend **añade**: `better-sqlite3`, `bcryptjs`. **Retira** (al terminar Fase 1/3): `pg`, `bullmq`, `ioredis`. Conserva: `express`, `cors`, `dotenv`, `express-rate-limit`, `nodemailer`, `jsonwebtoken` (solo si sigue usándose en pruebas del cliente idoo; si no, se retira).
- Frontend **no** cambia versiones de Angular/RxJS/Mapbox. Añade solo `@playwright/test` (dev).

---

## 4. Guía de migración a PostgreSQL

1. **Interfaz estable.** Los servicios solo conocen `createRepositories(db)` y `uow.run()`; los repositorios ya son asíncronos (DT-04). Implementar `repositories/pg/*.js` con la misma firma.
2. **Tipos.** `TEXT` UUID → `UUID`; centavos `INTEGER` → `BIGINT`; `TEXT` ISO → `TIMESTAMPTZ`; JSON `TEXT` → `JSONB`; `INTEGER 0/1` → `BOOLEAN`; `CHECK(json_valid)` → innecesario.
3. **SQL.** `?` → `$1..$n`; `INSERT … ON CONFLICT … DO UPDATE` y `RETURNING` son compatibles; `datetime('now')` → `now()`; `LIKE` sin acentos → `ILIKE`/`unaccent`; índices parciales se mantienen; `COLLATE NOCASE` → `lower()` + índice funcional.
4. **Transacciones.** `uow.run` usa `pool.connect()` + `BEGIN … COMMIT`; desaparece el mutex global (Postgres maneja concurrencia). Revisar `SELECT … FOR UPDATE` en stock, liquidaciones y tokens QR.
5. **Cola.** Reclamar con `SELECT … FOR UPDATE SKIP LOCKED` → permite varios workers/instancias.
6. **Datos.** Script `scripts/sqlite-to-pg.js`: lee tablas en orden de dependencias, convierte tipos e inserta por lotes; las evidencias en disco no cambian (o se suben a S3 implementando `EvidenceStore` con la misma interfaz).
7. **Multi-instancia.** SSE necesitará `LISTEN/NOTIFY` de Postgres o un bus; las sesiones ya están en BD (sin estado en memoria).
8. **Migraciones.** Mantener numeración; crear `migrations/pg/` paralelas o un traductor; verificar con la misma batería `node:test` cambiando `DB_DRIVER=pg`.

---

## 5. Registro de reglas ambiguas resueltas (resumen)

| Tema | Decisión | Ref. |
|---|---|---|
| ¿Un usuario en varias empresas? | No; correo único global; cambiar de empresa = otra sesión | DT-17 |
| ¿Auto-aprobar ruta propia? | Sí con `routes.approve`, marcado en auditoría | DT-25 |
| Editar ruta pendiente/publicada | Vuelve a Borrador, revisión +1, aprobación invalidada | DT-24 |
| Llegada fuera de radio | Permitida con motivo obligatorio | DT-35 |
| Saldo vencido | Bloquea crédito, no contado | DT-38 |
| Diferencia en liquidación | > tolerancia → autorización de otro usuario | DT-47 |
| Stock negativo | Prohibido siempre | DT-46b |
| Descuento sobre tope | Requiere permiso extra o aprobación | DT-46 |
| Iniciar ruta fuera de horario de embarque | Requiere permiso | DT-45 |
| Versión de app vieja | `426` y bloqueo de operación | DT-45 |
| GPS "en vivo" | ≤ 120 s y origen REAL | DT-41 |
| Datos de `localStorage` existentes | Se descartan, no se importan | DT-51 |
| Integraciones sin implementación | "No disponible en esta versión" | DT-31 |
| Mapbox sin Internet | Degradación a línea recta "estimado" | DT-33 |


---

## 6. Ajustes y hallazgos de la Fase 1 (prevalecen sobre las secciones 1–5)

| Ref. | Ajuste | Motivo |
|---|---|---|
| DT-01 | `better-sqlite3` **13.2.0** instalado y verificado con Node 22.23 (SQLite 3.53). | Confirmado. |
| DT-06 | **Un usuario = un rol** (`users.role_id`); no existe la tabla `user_roles`. Se omiten `idempotency_keys` y `login_attempts` (los intentos fallidos viven en `users`). Las migraciones reales son `001_core`, `002_catalog` (solo `clients` y `products`), `003_fiscal` (Carta Porte) y `004_fleet`. El resto de tablas llega con su fase. | Coincide con la UI (un rol por usuario) y evita tablas sin uso. |
| DT-08/09 | Sesión opaca con hash en BD y cookie `enruta_sid` `HttpOnly; SameSite=Lax; Path=/api`. Bearer solo si el cliente declara `X-EnRuta-Client: mobile` (el token viaja en el cuerpo del login). Anti-CSRF: toda petición mutante exige `X-EnRuta-Client` salvo `/api/mobile/*` y las que usan Bearer. | Implementado y probado. |
| DT-11 | Respuesta genérica única para credenciales erróneas, cuenta bloqueada o usuario inactivo (`INVALID_CREDENTIALS`). 5 fallos en una ventana de 15 min bloquean 15 min. Cada petición revalida sesión y usuario: inactivar = bloqueo inmediato (`USER_INACTIVE`). | Sin enumeración de cuentas. |
| DT-11b | El sondeo del navegador (`GET /api/session` cada 30 s) lleva `X-EnRuta-Background: 1` y **no renueva la inactividad**. | Detectar un cierre remoto sin mantener viva una sesión abandonada. |
| DT-13 | Bandeja local: `GET /api/dev/mailbox` y vista `/dev/correo`. Los correos pasan por la cola (`SEND_MAIL`) y el token se borra del `payload` al enviar. | Probado desde un segundo navegador. |
| DT-15 | El registro **abre sesión** y la UI entra directo al panel (la pantalla «Solicitud enviada» queda sin uso). | Evita un segundo login inmediato. |
| DT-16/18 | El centro activo vive en la sesión; el alcance de un usuario son sus centros asignados (o todos con `centers.all`). El acceso por ID a un recurso de otro centro responde 404. | Probado en `tenant-isolation.test.js`. |
| DT-21 | El rol **Supervisor** tampoco recibe `config.manage` (conserva la restricción previa sobre Configuración/Parámetros/Formularios/Marca). Se añadió `users.read` al catálogo (Supervisor puede listar usuarios). | Paridad con las restricciones de la UI anterior. |
| DT-26 | `PUBLIC_API_URL` (además de `PUBLIC_WEB_URL`) se emite en el token del QR y en `GET /api/system/network`. El QR sigue siendo `{v:1, api, token}`; la versión «URL con fragmento» se pospone a la Fase 2. | Mantener compatibilidad con la app móvil existente. |
| DT-30/32 | `PAC_MODE=local` es alias de `sandbox`. `loadEnvFile` rellena variables vacías sin pisar las reales. Las pruebas reproducen el caso `IDOO_API_KEY` heredado vacío. | Corrige el defecto H14. |
| DT-33 | El token público de Mapbox lo entrega `GET /api/system/client-config`. Su valor por defecto es el `pk.` que ya estaba en el repositorio (público por diseño); sobrescríbelo con `MAPBOX_PUBLIC_TOKEN` y restríngelo por URL. Sin token, el mapa muestra un aviso en lugar de fallar. | Sin romper la demo actual. |
| DT-48 | La cola reclama con `UPDATE … RETURNING`, `lease` de 60 s y backoff `min(2^intentos × 2 s, 5 min)`. Una `PermanentError` pasa directo a `DEAD`. | 8 pruebas, incluida la recuperación tras reinicio. |
| DT-49 | **Hallazgo clave:** en Angular 22 un componente sin `changeDetection` explícito es **OnPush**. Por eso los campos simples mutados tras un `await` no repintaban la vista (causa raíz de los fallos de actualización). Fase 1: las pantallas que leen campos simples de `EnrutaState` y `AppComponent` declaran `ChangeDetectionStrategy.Default` de forma **transitoria**; los componentes nuevos o tocados (recuperación, bandeja, RFC, sesión, permisos) usan **signals**. La migración pantalla por pantalla a signals + OnPush es la Fase 2.A. | Confirmado con Playwright (el estado cambiaba pero la vista no). |
| DT-49b | `provideHttpClient` **sin** `withFetch()`: el backend fetch de HttpClient ejecuta la petición fuera de la zona. Se usa XHR (parcheado por zone.js). | Evitar vistas obsoletas con Zone.js. |
| DT-51 | Se purga `enruta.accounts`, `enruta.session`, `enruta.sid`, `enruta.recovery` y `enruta.data.*`. Los módulos aún sin API guardan **temporalmente** su estado en `enruta.interim.v1.<empresaId>.<centroId>` (IDs, no nombres), y se vacía y recarga al cambiar de empresa/centro. Desaparece conforme las Fases 2–3 migran cada módulo. | Respeta «backend única fuente de verdad» para identidad, usuarios, roles, permisos, sesiones y dispositivos, sin romper pantallas pendientes. |
| DT-56 | `docker-compose.yml` con un solo servicio `api` (Node 22). **No se probó** con Docker en este entorno. | Sin daemon de Docker disponible. |
| — | `drivers`, `vehicles`, `devices`, QR y `/api/mobile/link` se **portaron en la Fase 1** (planeados para la 2.D) para no perder una función que ya operaba. La Fase 2 añade SSE, revocación en vivo y la vista de repartidor. | «Conserva lo que ya funcione». |
| — | `clients` y `products` existen en backend (con alcance por centro/empresa) como vehículo de las pruebas de aislamiento; la **UI** de clientes/productos sigue sobre el estado temporal hasta la Fase 2.B. | Requiere migrar rutas y planeador a la vez. |

### Pendientes conocidos de la Fase 1 (no resueltos)
1. `ScreenBoundaryComponent` no captura errores de **interacción** bajo Angular 22 (los listeners reportan al `ErrorHandler` del entorno, no al del componente). Su prueba está marcada `xit` con la explicación. Sí captura fallos de renderizado.
2. Los toasts y varias pantallas dependen aún de `ChangeDetectionStrategy.Default` (ver DT-49).
3. El SSO corporativo no existe: el botón figura como «no disponible».
4. Notificaciones del backend (bloqueos, etc.) aún no se muestran en la UI (la lista visible sigue siendo la temporal).
5. Las preferencias de perfil y el logo/marca siguen locales (Fase 3).


---

## 7. Ajustes y hallazgos de la Fase 2 (prevalecen sobre las secciones 1–6)

| Ref. | Ajuste | Motivo |
|---|---|---|
| DT-23 | Estados de ruta en BD: `DRAFT, PENDING_APPROVAL, PUBLISHED, IN_PROGRESS, COMPLETED, CANCELLED`. «Rechazada» no es un estado: es `DRAFT` con `last_decision='REJECTED'` (etiqueta propia). Cada transición queda en `route_status_history`. | Flujo simple y auditable. |
| DT-24 | `routes.revision` sube con cualquier edición **relevante** (nombre, día, operador, vehículo, zona, paradas). El **color es cosmético** y no la sube. Editar una ruta pendiente o publicada la regresa a `DRAFT`, marca la solicitud/aprobación como `INVALIDATED`, borra `approved_revision`, notifica y audita. `PUT` exige `revision` (`REVISION_REQUIRED`); si no coincide → `409 REVISION_CONFLICT`. **Aprobar** exige la revisión exacta de la solicitud (`409 REVISION_MISMATCH`) y vuelve a validar. | Nadie aprueba ni ejecuta una versión que no vio. |
| DT-25 | Validaciones al enviar **y** al aprobar: operador existente, activo, con `deliveries.execute` y asignado al centro de la ruta; ≥ 1 parada; clientes activos y con coordenadas. Las paradas deben ser del centro de la ruta. Se devuelven todos los `problems`. Autoaprobación permitida y marcada (`self_approved`, auditoría). | Coincide con el diseño original. |
| DT-26 | QR = `PUBLIC_WEB_URL/repartidor/vincular#t=<token>`; el token va en el **fragmento** y la vista lo borra de la URL con `history.replaceState` al leerlo. El token es opaco, de un solo uso, 15 min, solo su hash en BD. | No queda en logs ni en `Referer`. |
| DT-27 | **SSE implementado** (`GET /api/events`, `EventBus` en memoria con latidos). Eventos: `device.linked`, `device.revoked`, `route.updated` (filtrado por centro), `route.assigned`, `route.cancelled` (al operador), `session.revoked` (al usuario). El frontend reintenta solo; un 401 cierra el stream. Las conexiones SSE **no cuentan como actividad**. | Confirmación en vivo sin sondeo. |
| DT-28 | `POST /api/devices/:id/revoke` revoca las credenciales del dispositivo, lo deja `Inactivo` y emite `device.revoked`. Un dispositivo con conductor asignado solo acepta a ese conductor (por correo): `DEVICE_DRIVER_MISMATCH`. | Revocación inmediata. |
| DT-29 | **Vista de repartidor** (`/repartidor`, `/repartidor/vincular`, carga diferida, OnPush, una columna, objetivos táctiles ≥ 40 px). Contrato `/api/mobile/v1`: `link`, `me`, `routes`, `routes/:id/start`; todas menos `link` exigen sesión de usuario con `deliveries.execute` **y** `X-Device-Token` válido. Hoy: vincular, iniciar sesión, descargar la ruta publicada, ver paradas (llamar / cómo llegar) e **iniciar la ruta**. Visitas, entregas, cobros y evidencias **no se simulan**: llegan en la Fase 3. | Mismos endpoints que usará Flutter. |
| DT-29b | La credencial del **dispositivo** (`X-Device-Token`) y un identificador de hardware se guardan en `localStorage` del teléfono (`enruta.driver.device`, `enruta.driver.serial`). Es la identidad del equipo, no de un usuario, y el servidor puede revocarla; por eso es la única excepción a «`localStorage` solo para preferencias». | Equivale al almacenamiento seguro de una app móvil. |
| DT-09b | La exención CSRF se limita a `/mobile/link` y `/mobile/v1/link` (sin sesión). Los demás endpoints móviles con cookie exigen `X-EnRuta-Client`. | Cerrar un hueco que abría la exención por prefijo. |
| DT-49 | **Estrategia final de detección de cambios: Zone.js + OnPush + estado en signals.** `makeReactive()` convierte los campos de `EnrutaState` (y de componentes con estado asíncrono) en accesores respaldados por signals sin cambiar su API; todas las pantallas, `AppComponent`, la frontera de errores y el mapa son OnPush. Los callbacks fuera de la zona (Mapbox) y los eventos SSE solo escriben signals / entran a la zona con `NgZone.run`. Se eliminaron `setTimeout`/`setInterval` (RxJS `timer`), `markForCheck` y `detectChanges`. Límite conocido: la mutación **en sitio** de objetos anidados no notifica; usar reemplazo inmutable. | Cierra la causa raíz documentada en §6. |
| DT-50 | `EnrutaState` sigue como fachada para las 31 plantillas. Clientes, productos, rutas y aprobaciones se cargan del backend (`OperationsApi`) y se exponen como `SimpleRecord` con id numérico estable derivado del UUID; las mutaciones son llamadas al servidor seguidas de recarga. La importación CSV/XLSX se interpreta en el navegador y el servidor la **revalida** y aplica en una transacción. | Sin reescribir plantillas ni perder el diseño. |
| DT-51 | Salieron del estado temporal: clientes, productos, rutas, aprobaciones, usuarios, roles, sesiones y dispositivos. Siguen temporales (por empresa y centro): precios/promociones/descuentos, formularios, parámetros, módulos, liquidaciones manuales, notificaciones visibles, marca y Carta Porte generada. | Se migran en la Fase 3. |

### Pendientes conocidos tras la Fase 2
1. `ScreenBoundary` sigue sin capturar errores de interacción en Angular 22 (prueba `xit`).
2. Las rutas usan `day` (texto) y no fecha; no hay ventanas de embarque ni parámetros por herencia (Fase 3.C).
3. El repartidor no registra visitas, entregas, cobros, evidencias ni GPS (Fase 3.A/3.B).
4. El SSE vive en memoria de un solo proceso (una instancia).
5. Bandeja de aprobaciones: filtros decorativos (`Todas`) sin función; sin motivo de rechazo en la UI (el servidor sí lo admite).

---

## 8. Ajustes y decisiones de la Fase 3 (puntos 8, 9 y 10; prevalecen sobre las secciones 1–7)

| Ref. | Decisión | Motivo |
|---|---|---|
| DT-34b | **Idempotencia**: todas las acciones de campo exigen `Idempotency-Key` (8–80 caracteres, por empresa). Se reserva la clave, se **reproduce la respuesta 2xx** original (`Idempotent-Replay: true`), el mismo cuerpo con otra operación da `422 IDEMPOTENCY_MISMATCH`, una clave en curso da `409 IDEMPOTENCY_IN_PROGRESS` y **solo las respuestas 2xx se guardan** (un 4xx libera la clave para poder corregir). El cliente conserva la clave mientras la acción no tenga éxito (reintento tras un corte) y genera otra si el contenido cambia. | Doble clic y reintentos sin duplicar entregas, cobros ni fotos. |
| DT-35b | **Llegada**: distancia Haversine contra el radio efectivo (herencia). Fuera de radio → `422 OUTSIDE_RADIUS` con distancia y radio; con `outsideReason` se registra y queda en la visita. Una visita por (ruta, cliente). | Validar con el GPS real sin bloquear casos legítimos (fila de camiones, acceso cerrado). |
| DT-36b | **Entrega**: el estado se **calcula** (total / parcial / fallida) de las líneas; una línea corta exige motivo, una fallida exige motivo de incidencia (catálogo CLIENT_CLOSED, NO_ONE, REJECTED, NO_CASH, ADDRESS, STOCKOUT, DAMAGED, OTHER). Descuentos limitados por el rol (`maxDiscountBp`, `discounts.over_limit`). Hasta 3.D no hay pedidos: el repartidor captura cantidad pedida y entregada. | Evitar estados capturados a mano e inconsistentes. |
| DT-37b | **Evidencias**: imagen cruda (PNG/JPEG/WebP, ≤ 8 MB), validada por **firma de archivo**, hasta 10 por visita, guardada en `evidences/<empresa>/<año>/<mes>/<uuid>.<ext>` con SHA-256. Solo se sirve con sesión + `tracking.read` y centro visible; sin sesión → 401. Foto/firma son **obligatorias según el formulario de entrega de la versión con que se capturó**. | El nombre del archivo nunca depende del cliente; el repartidor no lee evidencias ajenas. |
| DT-38b | **Cobros**: métodos CASH / TRANSFER / CARD (transferencia y tarjeta exigen referencia). El **crédito es implícito**: saldo = cargos − pagos aplicados FIFO. Un pago mayor al saldo se rechaza (`OVERPAYMENT`). | Sin entidad «factura» todavía; el saldo se deriva del libro (`client_ledger`). |
| DT-39b | **Cierre de visita**: requiere entrega, evidencias obligatorias y formularios válidos (se revalidan en el servidor). Si el cliente tiene **saldo vencido** (más de `overdue_block_days` días) y la visita queda pendiente de pago, `CREDIT_BLOCKED` salvo permiso `credit.authorize`. **Finalizar ruta**: todas las paradas cerradas o «no visitadas» (`VISITS_PENDING`); calcula el resumen y notifica. | Cumplir el bloqueo por saldo vencido y no dejar paradas sin resolver. |
| DT-40b | **GPS**: `source` ∈ REAL / SIMULATED; estado visible = fuente si el dato tiene ≤ `GPS_STALE_SECONDS` (120), `STALE` hasta `GPS_OFFLINE_SECONDS` (900) y `OFFLINE` después (o sin posiciones). El cliente **recalcula** el estado cada 5 s con la hora del servidor. Las posiciones se deduplican por (ruta, fuente, instante). | La torre nunca presenta como «en vivo» un dato viejo o simulado. |
| DT-41b | **Simulador**: explícito (`simulator.run`, `SIMULATOR_ENABLED`, por defecto activo fuera de producción); recorre las coordenadas de las paradas con `source=SIMULATED`, intervalos `SIMULATOR_STEP_SECONDS`; al arrancar el servidor las simulaciones en curso pasan a detenidas. La interfaz lo rotula «Ubicación simulada» y avisa «NO son GPS real». | Demostrar el seguimiento sin camiones sin engañar al operador. |
| DT-42b | **Lectura de ejecución/evidencias** exige `tracking.read` (el repartidor no la tiene). | Menor privilegio. |
| DT-43b | **Configuración**: un payload `{modules, forms:{entrega,cobro,visita}, parameters}` con un **borrador** por empresa y versiones **PUBLICADAS** inmutables (la anterior pasa a `SUPERSEDED`). Publicar sin cambios → `409 NO_CHANGES`. Los dispositivos descargan lo **publicado** y confirman con `POST /mobile/v1/config/ack`; el panel muestra «Recibida por X de Y» (dispositivos activos y vinculados). `GET /config` admite `config.manage` o `config.publish`. | Lo editado no rige hasta publicar; trazabilidad de qué versión tiene cada dispositivo. |
| DT-44b | **Formularios**: definición validada (tipos Texto, Número, Fecha, Selección, Foto, Firma, Código de barras, Casilla; etiquetas únicas, ≥ 2 opciones, mínimo ≤ máximo, ≤ 60 campos). Validación de capturas con el **mismo contrato** en `backend/src/services/forms.js` y `src/app/core/form-validator.ts`; el servidor siempre revalida. | Respuesta inmediata en el teléfono sin confiar en el cliente. |
| DT-45b | **Herencia**: USUARIO > RUTA > ZONA > CENTRO > EMPRESA > SISTEMA (IDs del servidor, nunca nombres). Claves: `visit_radius_m` (150 m), `cash_tolerance_cents` (5000), `overdue_block_days` (30), `loading_window` (`HH:MM-HH:MM`, vacío = sin restricción), `min_client_version` (vacío = sin mínimo). *Se aparta de DT-45 original* en que `loading_window` y `min_client_version` no traen valor por defecto, para no bloquear a nadie por una regla que la empresa no definió. Los servicios aplican lo PUBLICADO. `?inheritedFor=ZONA` devuelve lo que heredaría ese nivel (marcadores de la pantalla). | Reglas reales sin bloqueos sorpresa. |
| DT-46c | `loading_window` se evalúa en la zona horaria de la empresa (ventanas que cruzan la medianoche) al **iniciar ruta** (`OUTSIDE_LOADING_WINDOW`, salvo `routes.start_outside_window`). `min_client_version` → `426 UPGRADE_REQUIRED` por `X-Client-Version`. El radio se aplica en la llegada y el saldo vencido al cerrar. La tolerancia de efectivo se resuelve y publica, pero **se aplica en 3.D** (liquidaciones). | Cada regla se hace cumplir en el servidor. |
| DT-52 | **Frontend**: la configuración (módulos, formularios, parámetros, versiones) salió del almacenamiento temporal del navegador y vive en el servidor (`ConfigStore`). Los editores se muestran al cargar (hidratar después de teclear perdería lo escrito) y no se pisan las ediciones sin guardar al navegar. `pendingChanges` se calcula comparando borrador y vigente. La marca (`brand*`) sigue local y **no** forma parte de la publicación. | Una sola fuente de verdad. |
| DT-53 | **Vista de repartidor**: la llegada reutiliza la última lectura de `watchPosition` si tiene ≤ 45 s (si no, pide una nueva); fotos reducidas a ≤ 1280 px (JPEG 0.82) en el cliente; firma en `canvas` exportada a PNG. Se envía `X-Client-Version: 1.0.0`. | Un teléfono con GPS activo no siempre responde a una segunda petición puntual; menos datos móviles. |

### Pendientes conocidos tras la Fase 3 (puntos 8–10)
1. Precios/promociones/descuentos, liquidaciones, inventario y módulos de preventa/autoventa/comodato siguen en 3.D (la tolerancia de efectivo aún no se aplica).
2. Sin sincronización fuera de línea: el repartidor necesita conexión; los reintentos son seguros pero no hay cola local persistente.
3. No existe historial visual del recorrido (el endpoint `tracking/routes/:id/history` existe, la pantalla no).
4. La revisión de evidencias vive en Rutas → «Ejecución» (visitas, líneas, cobros, enlaces a foto y firma); falta una galería con miniaturas y un visor.
5. En HTTP por LAN algunos navegadores móviles restringen cámara y geolocalización; probado solo con Chromium emulado (no con un teléfono físico).
