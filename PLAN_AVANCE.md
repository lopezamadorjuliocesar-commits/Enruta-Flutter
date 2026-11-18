# EnRuta — Plan de avance

> Lista de avance viva. Cada fase se **compila y prueba** antes de iniciar la siguiente.
> Referencias `DT-xx` → `DECISIONES_TECNICAS.md`. Estado: ☐ pendiente · ◐ en curso · ☑ terminado y verificado.
> Fecha de creación: 2026-11-17. Estado global: **Fases 0, 1 y 2 terminadas y verificadas. Siguiente: Fase 3.**

## Comandos de verificación por fase (salida filtrada)

```bash
cd backend && npm test -- --test-reporter=dot
```
```bash
npx ng build --configuration development 2>&1 | grep -E "ERROR|WARNING|complete" ; git checkout -- dist
```
```bash
npx ng test --watch=false --browsers=ChromeHeadless 2>&1 | tail -5
```
```bash
npx playwright test --reporter=line --trace off
```

> `dist/` está versionado: tras cada `ng build` de verificación se restaura (`git checkout -- dist && git clean -fd dist`) para no modificar carpetas compiladas. Alternativa preferida: compilar con `--output-path` a un directorio temporal.

---

## Fase 0 — Diagnóstico ☑

- ☑ Inventario de dependencias y versiones reales (Angular 22.2.5, zone.js 0.16.3, TS 6.0.3, Node 22.23.5).
- ☑ Revisión de backend (Express + pg + BullMQ/Redis), esquema SQL, docker-compose, Mapbox, servicios.
- ☑ Confirmado: no existe proyecto Flutter (ni en árbol ni en ZIP).
- ☑ Build Angular de desarrollo compila sin errores.
- ☑ 16 hallazgos críticos documentados (H1–H16).
- ☑ `DECISIONES_TECNICAS.md` y `PLAN_AVANCE.md`.

---

## Fase 1 — Núcleo, persistencia, auth y aislamiento

### 1.A Infraestructura backend (DT-01…05, 24, 32, 53, 54, 56, 58)
- ☑ `backend/package.json`: añadir `better-sqlite3`, `bcryptjs`; scripts `start`, `dev`, `migrate`, `seed:reset`, `test`.
- ☑ `src/config/index.js` con `envStr()` (vacío = no definido) y carga de `.env` que rellena vacíos sin pisar valores (DT-32).
- ☑ `src/db/sqlite.js` (PRAGMAs, mutex, `uow.run`) y `src/db/migrator.js` + `schema_migrations` con checksum.
- ☑ `migrations/001_core.sql` (empresas, centros, zonas, usuarios, roles, permisos, sesiones, tokens, auditoría, notificaciones, dev_mailbox, idempotencia, jobs_queue, company_validations).
- ☑ `src/app.js` (sin listen) / `src/server.js` (`HOST=0.0.0.0`, advertencia `PUBLIC_WEB_URL` localhost).
- ☑ `GET /api/health` (BD + cola + modo de adaptadores), `GET /api/system/network`, `GET /api/system/client-config` (token Mapbox público).
- ☑ `scripts/seed-reset.js` (`--yes` obligatorio; prohibido en producción): 2 empresas demo, centros, zonas, usuarios de cada rol, clientes geolocalizados, productos, listas de precios, rutas en varios estados. Mantiene `demo@enruta.mx / Demo12345678`.
- ☑ `docker-compose.yml` de un servicio con volúmenes `data/` y `storage/` (**sin probar con Docker**: no hay daemon en el entorno de desarrollo); `.env.example` raíz y `backend/.env.example` sin secretos.
- **Criterio:** reiniciar el backend conserva datos; `seed:reset --yes` repone demo; pruebas usan `:memory:`.

### 1.B Repositorios (DT-04, 06, 16)
- ☑ `repositories/index.js` + implementaciones SQLite: companies, centers, zones, users, roles, permissions, sessions, audit, notifications (+ clients, products, jobs, mailbox, Carta Porte, dispositivos). `settings` se difiere a la Fase 3.C.
- ☑ Todos los métodos reciben `ctx` y filtran por `company_id` (y `center_id` cuando aplica).
- ☑ Prueba: repositorio con `ctx` de empresa A no ve registros de B (404).

### 1.C Autenticación (DT-07…15)
- ☑ `POST /api/companies/validate-rfc` (adaptador RFC local/idoo), `POST /api/companies/register` (empresa + admin + roles + sesión en una transacción).
- ☑ `POST /api/auth/login`, `POST /api/auth/mfa/verify`, `POST /api/auth/logout`, `GET /api/session`, `PUT /api/session/center`.
- ☑ `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `DELETE /api/auth/sessions?others=1`.
- ☑ Bloqueo 5 intentos/15 min, rate-limit por IP, revocación inmediata al inactivar usuario.
- ☑ `POST /api/auth/forgot-password`, `GET /api/auth/reset-password/validate`, `POST /api/auth/reset-password` (token en BD, un uso, revoca sesiones).
- ☑ Adaptador de correo `local|smtp`; `GET /api/dev/mailbox` (solo `MAIL_MODE=local`).
- ☑ 2FA TOTP: `POST /api/auth/mfa/setup`, `/confirm`, `/disable`.
- ☑ Perfil: `PUT /api/me`, `PUT /api/me/password`, avatar en `storage/avatars`.
- ☑ Eliminar middleware `x-api-key`/`x-company` y `ADMIN_API_KEY`.

### 1.D RBAC (DT-20…22)
- ☑ Siembra de `permissions` y roles de sistema con `max_discount_bp`.
- ☑ `middleware/require-permission.js`; aplicado a todas las rutas.
- ☑ `GET/POST/PUT /api/roles`, `PUT /api/roles/:id/permissions`; `GET/POST/PUT /api/users`, `PATCH /api/users/:id/status`.

### 1.E Frontend núcleo (DT-07, 09, 19, 22, 50, 51, 52)
- ☑ `provideHttpClient(withFetch(), withInterceptors([...]))`; `ApiClient` con `X-EnRuta-Client` y `withCredentials`.
- ☑ `SessionStore` / `ScopeStore` (epoch) / `PermissionStore`; directiva `*appCan`; guard `canMatch`.
- ☑ Quitar `API_KEY` y `MAPBOX_TOKEN` de `core/config.ts`; la API es relativa (`/api`) y el token de Mapbox lo entrega el backend.
- ☑ Login, registro, verificación 2FA, recuperación, perfil, sesiones, usuarios y editor de permisos conectados al backend.
- ☑ Vista `/dev/correo` con banner "MODO LOCAL".
- ◐ Limpieza única de claves heredadas de `localStorage` ☑. Preferencias visuales en `enruta.prefs.*`: aún no hay preferencias visuales que guardar; los módulos sin API usan almacenamiento **temporal** `enruta.interim.v1.<empresa>.<centro>` (ver DT-51).
- ☑ Selector de centro real (lista de `GET /api/centers`), con reseteo de stores y cancelación de peticiones.
- **Pruebas de salida de Fase 1 (ejecutadas):** escenarios 1, 2, 3, 16 (parte backend), 17, 18, 19 → **106/106 pruebas `node:test`**; Karma **22 correctas + 1 omitida** (`xit`, ver DECISIONES §6); `ng build` de producción sin errores; humo E2E en navegador **12/12**. Detalle en `ESTADO_IMPLEMENTACION.md`.

**Añadido en la Fase 1 (no estaba en el plan):** puerto de dispositivos/QR/conductores/vehículos (antes 2.D), carta porte sobre la cola local (antes 3.E), `X-EnRuta-Background`, `GET /api/me/security-events`, `DELETE /api/me/avatar`, `README_LOCAL.md`.


---

## Fase 2 — Change detection y operación de rutas

### 2.A Reactividad (DT-49)
- ☑ Estrategia coherente (Zone.js + OnPush + estado en signals): `makeReactive()` respalda con signals los campos de `EnrutaState` y de los componentes con estado asíncrono; las 31 pantallas, `AppComponent`, la frontera de errores y el mapa pasan a **OnPush**. Las asignaciones por reemplazo repintan la vista; la mutación en sitio de objetos anidados solo es segura dentro de eventos de la propia vista.
- ☑ Eliminados `appRef.tick()` y `NgZone.run` (Fase 1). RFC con signal; el doble clic de login/importación/guardado se bloquea con banderas de ocupado (no hace falta `exhaustMap`).
- ☑ Timers del QR, Carta Porte, mapa y avisos con `timer()` de RxJS (sin `setTimeout`/`setInterval` en la app); sondeo del QR sustituido por SSE (solo queda un respaldo cada 5 s).
- ☑ Mapbox: callbacks fuera de zona escriben signals; sin `detectChanges()`.
- ◐ Estados de carga/error: banderas `loading`/`error` en los stores nuevos (administración, conductor, dispositivos, operación). Un patrón único `resource` para todas las pantallas queda pendiente.
- ☑ Pantallas → `OnPush`.
- **Criterio:** escenario 20 (Playwright verifica actualización sin recargar ni clic extra en: login/logout, RFC, CRUD, mapa, QR, cambio de centro, Carta Porte).

### 2.B Catálogo y clientes (base para rutas)
- ☑ `migrations/002_catalog.sql`; repos y endpoints `/api/clients`, `/api/products`, `/api/zones`, `/api/centers`.
- ☑ Importación CSV/XLSX: el parseo sigue en cliente; envío por lotes a `POST /api/import/{clients|products}` con modo `omitir|actualizar` y reporte.
- ☑ Exportaciones CSV desde backend.

### 2.C Rutas y aprobaciones (DT-23…25)
- ☑ `migrations/004_routes.sql`; servicio de máquina de estados con tabla de transiciones permitidas.
- ☑ Endpoints: `GET/POST /api/routes`, `GET/PUT /api/routes/:id` (con `revision`), `PUT /api/routes/:id/stops`, `POST …/duplicate`, `…/submit`, `…/approve {revision}`, `…/reject {revision, reason}`, `…/cancel`, `GET /api/approvals`.
- ☑ Invalidación de aprobación al editar; 409 `REVISION_MISMATCH`.
- ☑ Planeador y Aprobaciones conectados; optimización Mapbox con respaldo local.

### 2.D Dispositivos, QR y repartidor (DT-26…29)
- ☑ `migrations/003_fleet.sql`; port de endpoints actuales de vehículos y dispositivos sin `x-company`.
- ☑ `POST /api/devices/link-qr`, `POST /api/devices/:id/link-token`, `POST /api/mobile/v1/link`, `POST /api/devices/:id/revoke`.
- ☑ `GET /api/events` (SSE) + `EventStreamService` en Angular.
- ☑ QR como URL `${PUBLIC_WEB_URL}/repartidor/vincular#t=…`; advertencia si es localhost.
- ☑ Shell `/repartidor`: login, vincular, "Mi ruta", descarga de ruta (`GET /api/mobile/v1/route/today`), iniciar ruta.
- **Pruebas de salida de Fase 2 (ejecutadas):** escenarios 5, 6, 7, 8, 9 y 20 → **131/131 `node:test`**; Karma **25 correctas + 1 omitida**; `ng build` de producción sin errores ni advertencias; humo E2E de la Fase 1 **12/12** (sin regresiones con OnPush) y de la Fase 2 **15/15**. Detalle en `ESTADO_IMPLEMENTACION.md`.

**Diferencias respecto al plan original:** (1) el QR codifica `PUBLIC_WEB_URL/repartidor/vincular#t=<token>`; el JSON `{v:1, api, token}` para Flutter sigue disponible vía `apiUrl` en la respuesta. (2) Las rutas conservan el campo `day` (día de la semana) en lugar de fecha: la validación «fecha ≥ hoy» se difiere a la Fase 3.C con los horarios de embarque. (3) `route_loads` y `orders` no se crean todavía (Fase 3.D). (4) Los productos ganan `description` y `price_cents` como interino hasta las listas de precios.


---

## Fase 3 — Ejecución en campo, GPS, reglas e integraciones

### 3.A Entregas, evidencias y cobros (DT-34…39) — ☑ completada
- ☑ `migrations/007_execution.sql` (visitas, entregas y líneas, evidencias, cobros, libro de cuenta del cliente, incidencias, `idempotency_keys`); middleware de idempotencia (`Idempotency-Key` 8–80 caracteres; solo se guardan respuestas 2xx).
- ☑ `POST /api/mobile/v1/routes/:id/stops/:clientId/arrive|skip`, `/visits/:id/delivery|payments|close`, `/visits/:id/evidences?kind=PHOTO|SIGNATURE` (imagen cruda), `/routes/:id/finish`, `/incidents`; apoyo: `GET /mobile/v1/products`, `/incident-reasons`.
- ☑ Evidencias en disco (`./storage/evidences/<empresa>/<año>/<mes>/<uuid>.<ext>`, validadas por firma de archivo, SHA-256); `GET /api/evidences/:id` y `GET /api/routes/:id/execution` con sesión y permiso `tracking.read`.
- ☑ Vista de repartidor: llegada con GPS y radio, entrega total/parcial/fallida con motivos, formulario publicado, foto real (cámara/archivo reducida en el cliente), firma en canvas, cobro con saldo (FIFO), cierre, «no visitada», fin de ruta con resumen; reintento seguro con la misma `Idempotency-Key`.
- Desviaciones: migraciones 006/007/008 (no 005/006/007); el repartidor captura cantidades pedido/entregado (no hay pedidos hasta 3.D); la tolerancia de efectivo se resuelve y publica, pero se aplica en las liquidaciones (3.D).

### 3.B GPS y torre de control (DT-40…42) — ☑ completada
- ☑ `migrations/008_tracking.sql`; `POST /api/mobile/v1/positions` (≤ 100 por lote, descarta inválidas/futuras/imprecisas, deduplica), `GET /api/tracking/live`, `GET /api/tracking/routes/:id/history`.
- ☑ Simulador explícito `POST|DELETE /api/routes/:id/simulation` (`simulator.run`, `SIMULATOR_ENABLED`): puntos `source=SIMULATED`; al arrancar el servidor toda simulación vuelve a «detenida».
- ☑ Torre de control: *Ubicación real* / *Ubicación simulada* / *Desactualizado* / *Desconectado* (re-evaluado cada 5 s con la hora del servidor); la píldora dice «En vivo» solo con ≥ 1 vehículo REAL reciente, «Simulación activa · sin GPS real» o «Sin datos en vivo».
- ☑ El teléfono envía su ubicación REAL (`watchPosition`, lotes de 15 s) solo con la ruta en ejecución y permiso del navegador.

### 3.C Configuración, formularios y parámetros (DT-43…45) — ☑ completada
- ☑ `migrations/006_settings.sql`; `GET /api/config`, `PUT /api/config/draft`, `POST /api/config/publish`, `GET /api/config/versions[/:v]`, `GET /api/mobile/v1/config`, `POST …/config/ack`. Un BORRADOR editable y versiones PUBLICADAS inmutables; «recibida por X de Y dispositivos».
- ☑ Formularios (entrega, cobro, visita) con validador compartido (`backend/src/services/forms.js` ↔ `src/app/core/form-validator.ts`); el servidor valida con la versión con que se capturó.
- ☑ Parámetros por herencia Empresa → Centro → Zona → Ruta → Usuario (`GET /api/parameters/effective`, incl. `inheritedFor`) aplicados en los servicios: radio de visita, saldo vencido (bloqueo de crédito), horario de embarque, versión mínima (426).
- Desviación: los formularios y parámetros viajan en el mismo payload versionado (no hay `/api/forms/:kind` ni `/api/parameters` por separado). `loading_window` y `min_client_version` quedan vacíos (sin restricción) hasta que la empresa los define.

### 3.D Precios, inventario, módulos y liquidaciones (DT-46, 46b, 47)
- ☐ `/api/price-lists`, `/api/promotions`, `/api/discount-rules`, `GET /api/pricing/quote?clientId&items`.
- ☐ Stock por centro y carga de ruta; bloqueo de negativos; alertas de mínimo vía cola.
- ☐ Preventa (`orders`), autoventa, comodato (`assets`), auditoría de exhibición — condicionados al módulo publicado.
- ☐ `migrations/008_settlements.sql`; `GET /api/settlements`, `POST /api/routes/:id/settlement`, `POST /api/settlements/:id/deposits`, `…/authorize`, `…/reject`.

### 3.E Cola, RFC, Carta Porte y adaptadores (DT-30…33, 48)
- ☐ `queue/` con lease, backoff y recuperación al arranque; handlers `CARTA_PORTE_STAMP`, `SEND_MAIL`, `STOCK_ALERT`, `NOTIFY`.
- ☐ Adaptadores RFC (`local|idoo`) y PAC (`local|live`) con escenarios deterministas (`REJ/MIS/ERR/TMO`).
- ☐ `migrations/009_fiscal.sql`; Carta Porte persistida en backend; historial desde BD; rótulo "Simulado / Desarrollo".
- ☐ `GET /api/integrations` y pantalla de configuración con estado real; retirar `pg`, `bullmq`, `ioredis`.

### 3.F Indicadores y auditoría
- ☐ `GET /api/reports/summary?from&to&centerId&routeId&operatorId` (entregas, % cumplimiento, tiempos por visita, cobros por método, diferencias, incidencias, fuera de radio).
- ☐ `GET /api/reports/export.csv`, `GET /api/audit?filters`, `GET /api/audit/export.csv`.
- ☐ Auditoría append-only con `prev_hash` en todas las acciones de servicios.
- **Pruebas de salida de Fase 3:** escenarios 4, 10, 11, 12, 13, 14, 15.

---

## Fase 4 — Regresión y entrega

| # | Escenario | Tipo de prueba | Archivo previsto |
|---|---|---|---|
| 1 | Registro de empresa y admin | API + E2E | `backend/test/auth.register.test.js`, `e2e/01-registro.spec.ts` |
| 2 | Usuarios con distintos permisos | API | `backend/test/rbac.test.js` |
| 3 | Bloqueo de usuario inactivo | API + E2E (2 contextos) | `backend/test/auth.inactive.test.js`, `e2e/03-inactivo.spec.ts` |
| 4 | Clientes, productos y precios | API | `backend/test/catalog-pricing.test.js` |
| 5 | Creación y aprobación de ruta | API + E2E | `backend/test/routes.lifecycle.test.js`, `e2e/05-ruta.spec.ts` |
| 6 | Invalidación de aprobación al editar | API | `backend/test/routes.revision.test.js` |
| 7 | Vinculación de dispositivo | API + E2E (2 contextos, SSE) | `backend/test/devices.link.test.js`, `e2e/07-qr.spec.ts` |
| 8 | Acceso como repartidor | E2E | `e2e/08-repartidor.spec.ts` |
| 9 | Consulta de ruta asignada | API | `backend/test/mobile.route.test.js` |
| 10 | GPS real y simulado | API + E2E | `backend/test/tracking.test.js`, `e2e/10-torre.spec.ts` |
| 11 | Entregas con evidencias | API | `backend/test/deliveries.evidence.test.js` |
| 12 | Registro de cobros (idempotente) | API | `backend/test/payments.test.js` |
| 13 | Cierre de ruta | API | `backend/test/routes.finish.test.js` |
| 14 | Liquidación y conciliación | API | `backend/test/settlements.test.js` |
| 15 | Indicadores y auditoría | API | `backend/test/reports-audit.test.js` |
| 16 | Persistencia tras reinicio back y front | API (archivo temporal, reinicio de app) + E2E (recarga) | `backend/test/persistence.test.js`, `e2e/16-persistencia.spec.ts` |
| 17 | Acceso multi-navegador | E2E (2 contextos) | `e2e/17-multinavegador.spec.ts` |
| 18 | Aislamiento al cambiar de empresa | API + E2E | `backend/test/tenant-isolation.test.js`, `e2e/18-aislamiento.spec.ts` |
| 19 | Recuperación de contraseña desde otro navegador | E2E (contexto B abre `/dev/correo`) | `e2e/19-recuperacion.spec.ts` |
| 20 | Actualización reactiva sin recargas | E2E | `e2e/20-reactividad.spec.ts` |

Entregables de Fase 4:
- ☐ `.env.example` (raíz) — sin secretos.
- ☐ `README_LOCAL.md` — instalación, `npm run seed:reset -- --yes`, arranque en dos terminales, `PUBLIC_WEB_URL` y firewall para QR, contrato `/api/mobile/v1` para Flutter.
- ☐ `DECISIONES_TECNICAS.md` — actualizado con cualquier decisión nueva.
- ☐ `ESTADO_IMPLEMENTACION.md` — resultado real de las 20 pruebas (pasa/falla con salida), funciones terminadas, **simulaciones** (RFC local, PAC local, correo local, simulador GPS, hardware reportado por navegador) y pendientes.

---

## Orden de commits previsto (rama `claude/gracious-albattani-ace1qj`)

1. `backend: sqlite, migraciones, config y seed` → 2. `backend: auth, sesiones, rbac, tenant` → 3. `front: http, sesión, permisos; sin API key` → 4. `front: reactividad y signals` → 5. `rutas y aprobaciones versionadas` → 6. `dispositivos, QR, SSE, vista repartidor` → 7. `entregas, evidencias, cobros` → 8. `gps y simulador` → 9. `config, formularios, parámetros` → 10. `precios, inventario, liquidaciones` → 11. `cola sqlite, adaptadores, carta porte` → 12. `indicadores y auditoría` → 13. `pruebas e2e y documentos de entrega`.

## Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| `better-sqlite3` sin binario para la plataforma/Docker | Imagen `node:22-bookworm-slim` con `python3 make g++` en etapa de build |
| Plantillas acopladas a `EnrutaState` mutable | Fachada (DT-50) y migración pantalla por pantalla con build tras cada una |
| Mapbox sin Internet en la demo | Degradación local (DT-33) |
| Cámara/GPS en móvil requieren HTTPS fuera de `localhost` | Documentar: en LAN por HTTP el navegador puede negar `geolocation`/`getUserMedia`; usar `<input type="file" capture>` (funciona en HTTP) para fotos y entrada manual/simulador para GPS; opción `ng serve --ssl` con certificado autofirmado |
| Mutex de escritura de SQLite limita concurrencia | Suficiente para demo/local; ruta a Postgres documentada |
| Tamaño de bundle (2.7 MB dev) | Carga diferida (`loadComponent`) para `/repartidor` y `/dev` |
