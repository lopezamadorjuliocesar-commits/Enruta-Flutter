# EnRuta — Estado de implementación

Corte: **Fase 4 terminada** (2026-11-18; incluye las Fases 1–3). Este documento solo afirma lo que se ejecutó; lo demás figura como pendiente.

## 1. Resultados reales de verificación (Fase 4)

Todo se reproduce con **`npm run verify:phase4`** (build + backend + 20 escenarios + Karma) y los humos E2E (`npm run e2e:phase1|2|3|3b`, con el stack levantado).

| Comprobación | Comando | Resultado |
|---|---|---|
| Compilación del backend | `node --check` de los 58 archivos + arranque completo del runtime | ✅ Sin errores (JavaScript, sin paso de compilación) |
| Compilación del frontend | `ng build` (producción) | ✅ **Sin errores ni advertencias**; bundle inicial 976 kB (221 kB transferidos); la vista de repartidor es un chunk diferido |
| Chequeo de tipos | `tsc -p tsconfig.app.json --noEmit` | ✅ Sin errores |
| Pruebas del backend | `npm run test:backend` (SQLite temporal) | ✅ **189 de 189** en 25 archivos (~23 s) |
| Los 20 escenarios | `npm run test:scenarios` (BD SQLite **en archivo** temporal, con reinicio real del backend en el escenario 16) | ✅ **20 de 20** — ver §2 |
| Documentación de configuración | `backend/test/env-example.test.js` (parte de las 189) | ✅ Toda variable que lee el backend está en `.env.example`, sin secretos, y el ejemplo produce una configuración válida |
| Pruebas del frontend | `npm test` (Karma + ChromeHeadless) | ✅ **42 correctas, 1 omitida (`xit`)**, 0 fallidas |
| Humo E2E Fase 1 | `npm run e2e:phase1` | ✅ **12 de 12** |
| Humo E2E Fase 2 | `npm run e2e:phase2` | ✅ **15 de 15** (admin, supervisor y móvil emulado de 390 px, simultáneos) |
| Humo E2E Fase 3 (puntos 8–10) | `npm run e2e:phase3` | ✅ **17 de 17** |
| Humo E2E Fase 3b (puntos 11–13) | `npm run e2e:phase3b` | ✅ **14 de 14** |

La prueba omitida es `ScreenBoundaryComponent … interaction failure` (preexistente: bajo Angular 22 los errores de listeners no llegan al `ErrorHandler` del componente; ver DECISIONES_TECNICAS §6).

**Fallos reales hallados y corregidos en la Fase 4:** (1) las visitas creadas por el servicio (`arrive`/`skip`) tomaban `created_at` del reloj del sistema y no del inyectado, por lo que los indicadores de un periodo podían excluirlas; ahora usan el reloj del servicio. (2) `.env.example` no documentaba 16 variables que el backend sí lee (sesiones, cola, límites, tiempos del proveedor, `PUBLIC_API_URL`, …); ahora están todas y una prueba impide que vuelva a desfasarse. (3) El entorno del ejecutor de verificación perdía `PATH` al lanzar Karma (defecto de la herramienta, no del producto).

No se probó: `docker compose up` (sin Docker en el entorno), SMTP real, `idoo` real, PAC real, dispositivos físicos, HTTPS/móvil por LAN.

## 2. Los 20 escenarios críticos

Cada escenario tiene una prueba «Escenario N — …» en `backend/test/scenarios.test.js` (un solo recorrido sobre una BD SQLite temporal en archivo; el 16 detiene y vuelve a levantar el backend sobre el mismo archivo). La columna «Pruebas de apoyo» lista las suites que lo detallan y los humos E2E que lo repiten en navegadores reales.

| # | Escenario | Estado | Qué verifica `scenarios.test.js` | Pruebas de apoyo |
|---|---|---|---|---|
| 1 | Registro de empresa y admin | ✅ | RFC rechazado/duplicado/formato, contraseña débil, RFC **simulado** declarado (`fiscalStatus=SIMULATED`) | `auth.register.test.js`, `fiscal.test.js`, E2E-1 |
| 2 | Usuarios con distintos permisos | ✅ | Matriz de 4 roles + rol personalizado; un permiso nuevo rige sin volver a entrar | `rbac.test.js`, E2E-1 |
| 3 | Bloqueo de usuario inactivo | ✅ | Todas sus sesiones caen (`USER_INACTIVE`), no reingresa; sin permiso no se cambia el estado | `auth.inactive.test.js`, E2E-1 |
| 4 | Clientes, productos y precios | ✅ | Importación revalidada, SKU único, lista por cliente + promoción + cotización | `import.test.js`, `commerce.test.js`, E2E-3b |
| 5 | Creación y aprobación de ruta | ✅ | Borrador → pendiente → publicada por otro usuario; revisión vieja rechazada; el repartidor no aprueba | `routes.test.js`, Karma, E2E-2 |
| 6 | Invalidación de aprobación al editar | ✅ | Editar una ruta publicada la regresa a Borrador; `REVISION_MISMATCH`; historial | `routes.test.js`, Karma, E2E-2 |
| 7 | Vinculación de dispositivo | ✅ | QR de un solo uso, caducidad, `DEVICE_REVOKED` | `fleet.test.js`, `mobile.test.js`, E2E-2 |
| 8 | Acceso como repartidor | ✅ | Sesión + dispositivo + permiso (`DEVICE_REQUIRED`, 403, 401) | `mobile.test.js`, E2E-2/3 |
| 9 | Consulta de ruta asignada | ✅ | Solo rutas publicadas del operador, con paradas; el borrador no baja | `mobile.test.js`, E2E-2 |
| 10 | GPS real y simulado | ✅ | Real → Desactualizado → Desconectado por antigüedad, simulador explícito, historial, permiso | `tracking.test.js`, Karma `tracking.store.spec`, E2E-3 |
| 11 | Entregas con evidencias | ✅ | Formulario publicado con foto/firma obligatorias, validación por firma de archivo, evidencia solo con sesión | `execution.test.js`, E2E-3 |
| 12 | Registro de cobros | ✅ | Saldo con lista+promoción, sobrepago, referencia, `Idempotency-Key` (reintento sin duplicar, cuerpo distinto = 422) | `execution.test.js`, Karma `driver.service.spec`, E2E-3 |
| 13 | Cierre de ruta | ✅ | `VISITS_PENDING`, no visitadas con motivo, resumen, ruta cerrada no admite visitas | `execution.test.js`, E2E-3 |
| 14 | Liquidación y conciliación | ✅ | Esperado en efectivo, depósitos idempotentes, tolerancia heredada, autorización por OTRA persona, inmutable, sin doble liquidación | `commerce.test.js`, E2E-3b |
| 15 | Indicadores y auditoría | ✅ | Cifras desde la BD, filtros, CSV, eventos clave en bitácora, cadena de hashes íntegra | `adapters-reports.test.js`, `audit.test.js`, E2E-3b |
| 16 | Persistencia tras reinicio de backend y frontend | ✅ | **Reinicio real** sobre el mismo archivo: sesiones, ruta, liquidación, indicadores, foto en disco, dispositivo, configuración, cola y cadena de hashes intactos | `db.test.js`, `auth.recovery.test.js`; frontend: E2E-1/2/3 recargan el navegador y recuperan todo del servidor |
| 17 | Acceso multi-navegador | ✅ | Varias sesiones del mismo usuario, cerrar una no cierra las demás, eventos en ambos navegadores | `tenant-isolation.test.js`, `realtime.test.js`, E2E-2 |
| 18 | Aislamiento total entre empresas y centros | ✅ | Otra empresa/centro no ve ni opera rutas, liquidaciones, evidencias, dispositivos, indicadores ni bitácora | `tenant-isolation.test.js`, Karma, E2E-1 |
| 19 | Recuperación de contraseña desde otro navegador | ✅ | Bandeja local rotulada, un solo uso, sesión anterior revocada | `auth.recovery.test.js`, E2E-1 |
| 20 | Actualización reactiva de UI sin recargas ni clics | ✅ | Eventos SSE llegan a los navegadores sin recargar; el flujo exige sesión | Karma `reactivity.spec.ts` (OnPush + signals, control negativo, pantalla con datos del servidor, error visible), `app.component.spec.ts`, E2E-1/2/3/3b |

## 3. Funciones terminadas (Fases 1 a 4)

- **Persistencia**: SQLite (`better-sqlite3`), migraciones con checksum, `seed:reset` con confirmación, repositorios asíncronos (listos para PostgreSQL), arranque sin borrar datos.
- **Cola sin Redis**: `jobs_queue` con estados, backoff exponencial, `dedupe_key`, reclamo atómico, recuperación al reiniciar. La usan el correo y el timbrado de Carta Porte.
- **Autenticación**: registro de empresa + administrador (transacción única), login/logout, sesiones opacas validadas en cada petición (cookie HttpOnly o Bearer), bcrypt (coste 12), bloqueo tras 5 fallos, revocación y bloqueo inmediato al inactivar, expiración por inactividad y absoluta, cierre/listado de sesiones, cambio de contraseña, perfil con foto en disco, 2FA TOTP cifrado en reposo (vectores RFC 6238 verificados).
- **Recuperación de contraseña**: token de un solo uso en BD (15 min), enfriamiento, respuesta idéntica exista o no el correo, revoca sesiones, bandeja local `/dev/correo` accesible desde otro navegador.
- **Aislamiento**: la empresa sale de la sesión (jamás de un header); IDs estables; recursos de otra empresa o centro → 404; centro activo persistido en la sesión y filtrado real; el front vacía el estado y cancela peticiones al cambiar de empresa, centro o cerrar sesión.
- **RBAC**: 34 permisos, 4 roles de sistema + roles personalizados, `requirePermission` en cada endpoint, editor de permisos conectado al backend, `*appCan` y `permissionGuard` en Angular.
- **Seguridad del cliente**: se eliminó la API key administrativa del bundle; anti-CSRF por encabezado; el token de Mapbox lo sirve el backend.
- **Integraciones con honestidad**: adaptadores RFC (local determinista / idoo) y correo (local / smtp); `IDOO_API_KEY` vacía ya no pisa la real; la UI declara «Simulado / Desarrollo».
- **Portado sin pérdida**: dispositivos, conductores, vehículos, QR de vinculación, `POST /api/mobile/link`, Carta Porte.
- **Rutas (Fase 2)**: ciclo Borrador → Pendiente de aprobación → Publicada → En ejecución (+ rechazo, cancelación, duplicado, borrado de borradores) con `revision`, concurrencia optimista, aprobación de la **versión exacta**, invalidación al editar, historial por ruta, validaciones de operador/paradas/ubicaciones, notificaciones y auditoría. Planeador y Aprobaciones conectados al servidor.
- **Catálogo (Fase 2)**: clientes y productos en el backend; importación por lotes revalidada en el servidor; bajas con protección (`CLIENT_IN_ROUTE`).
- **Dispositivos y QR (Fase 2)**: QR con la URL de vinculación (token en el fragmento), alerta de localhost y listado de IPs de la red local, servidor en `0.0.0.0`, confirmación en tiempo real (SSE), revocación inmediata y asociación conductor↔dispositivo.
- **Vista de repartidor (Fase 2)**: `/repartidor` mobile-first con el contrato `/api/mobile/v1`: vincular, iniciar sesión, descargar la ruta publicada, ver paradas e iniciar la ruta.
- **Tiempo real (Fase 2)**: `GET /api/events` (SSE) con filtro por empresa/centro/usuario; lo usan el panel, la bandeja de aprobaciones, el panel de dispositivos y la vista móvil.
- **Change detection (Fase 2)**: Zone.js + OnPush + `makeReactive()`; sin `setTimeout`/`setInterval`/`markForCheck`/`detectChanges` en la app.
- **Entregas, visitas y cobros (Fase 3 · punto 8)**: llegada con GPS y radio heredado (motivo si está fuera), entrega total/parcial/fallida con motivos y catálogo de incidencias, formulario de entrega/cobro/visita publicado con validación real, foto y firma reales (en disco, validadas por firma de archivo), cobros (efectivo/transferencia/tarjeta) con saldo FIFO y rechazo de sobrepago, bloqueo de crédito por saldo vencido, cierre de visita, «no visitada», fin de ruta con resumen, **idempotencia** (`Idempotency-Key`) y revisión de evidencias en Rutas → «Ejecución».
- **GPS y torre de control (punto 9)**: recepción de posiciones reales del teléfono (`watchPosition`), historial en BD, estado visible Real/Simulado/Desactualizado/Desconectado recalculado cada 5 s, píldora «En vivo» condicionada, simulador explícito.
- **Configuración, formularios y herencia (punto 10)**: borrador vs versiones publicadas inmutables, «recibida por X de Y» (ack del dispositivo), constructor de formularios con validación en servidor y cliente, parámetros Empresa → Centro → Zona → Ruta → Usuario con marcador de origen, y reglas aplicadas en los servicios (radio, saldo vencido, horario de embarque, versión mínima → 426).
- **Precios, inventario y liquidaciones (punto 11)**: listas con vigencia/prioridad/clientes, promociones, descuentos con nombre, cotización; stock por centro (nunca negativo, mínimos con alerta por la cola), carga y devolución de ruta; preventa, autoventa, comodato y exhibición condicionados al módulo publicado; liquidaciones automáticas con tolerancia heredada y autorización por otra persona.
- **Adaptadores e integraciones (punto 12)**: PAC local determinista (éxito/rechazo/error/timeout) sin UUID fiscal, `GET /api/integrations` con estado real y rótulos «Simulado / Desarrollo» / «No disponible en esta versión».
- **Indicadores y bitácora (punto 13)**: indicadores calculados en SQL con filtros y exportación CSV; bitácora con filtros y exportación.
- **Verificación (Fase 4)**: `scripts/verify-phase4.js`, los 20 escenarios en `backend/test/scenarios.test.js`, `env-example.test.js` y `reactivity.spec.ts`.
- **Documentación**: `README.md`, `README_LOCAL.md`, `DECISIONES_TECNICAS.md`, `PLAN_AVANCE.md`, `.env.example`.

## 4. Simulaciones (declaradas en la interfaz y en `GET /api/health`)

| Qué | Cómo se muestra | Cómo pasar a real |
|---|---|---|
| Validación de RFC | «Resultado SIMULADO… no verificada ante el SAT»; la empresa queda `fiscal_status=SIMULATED` | `RFC_MODE=idoo` + `IDOO_API_KEY=idoo_sk_live_…` |
| Correo | «MODO LOCAL — bandeja de desarrollo» | `MAIL_MODE=smtp` |
| Timbrado Carta Porte | Estado **Simulado**, sin UUID ni timbre | `PAC_MODE=live` + `PAC_API_URL` + `PAC_API_TOKEN` |
| Datos demo | Solo si ejecutas `seed:reset` | — |

El panel *Configuración* muestra el estado REAL de cada integración (`GET /api/integrations`): lo local es «Simulado / Desarrollo», lo inexistente «No disponible en esta versión», y «Conectado» solo con un servicio real verificado en 24 h. La Torre de control solo dice «En vivo» con GPS real reciente.

## 5. Pendientes y límites conocidos

1. Pendiente: historial de Carta Porte leído por completo desde la BD en la pantalla (3.E, parcial) y los límites de §5. El resto del plan (Fases 1–4) está cumplido y verificado. Ver `DECISIONES_TECNICAS.md` §9.
2. Datos que **todavía viven en el navegador** (temporal, por empresa y centro): Carta Porte generada y sus datos por defecto, preferencias de perfil, marca, notificaciones visibles y la selección de plan. Todo lo operativo (rutas, clientes, productos, precios, inventario, entregas, cobros, liquidaciones, configuración, indicadores y bitácora) viene del servidor.
3. `ScreenBoundary` no captura errores de interacción (Angular 22); sí captura fallos de renderizado.
4. La mutación en sitio de objetos anidados de `EnrutaState` no repinta por sí sola (hay que reemplazar el objeto); está acotada a eventos dentro de la propia vista.
5. SSO corporativo inexistente (botón deshabilitado y rotulado).
6. No existe proyecto Flutter; no se modificó nada móvil.
7. El repartidor necesita conexión: los reintentos son seguros (idempotentes) pero no hay cola local persistente fuera de línea. Falta historial visual del recorrido y una galería de evidencias.
8. Las rutas usan un día de la semana (texto), no una fecha; la ventana de embarque es global por ámbito (no por día).
9. El bus SSE vive en la memoria de un proceso (una sola instancia).
10. Los límites de intentos por IP viven en memoria del proceso (se reinician con el servidor); el bloqueo por cuenta sí es persistente.
11. `docker-compose.yml` sin probar.
12. No se probó con un teléfono físico ni con HTTPS: en HTTP por LAN algunos navegadores móviles restringen cámara y GPS (la vista del repartidor sí los usa: probada solo con Chromium emulado, no con un teléfono físico).
