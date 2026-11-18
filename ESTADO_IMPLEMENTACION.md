# EnRuta — Estado de implementación

Corte: **Fase 2 terminada** (2026-11-18; incluye la Fase 1). Este documento solo afirma lo que se ejecutó; lo demás figura como pendiente.

## 1. Resultados reales de verificación

| Comprobación | Comando | Resultado |
|---|---|---|
| Pruebas backend | `npm run test:backend` | **165 de 165 correctas** (23 archivos, ~20 s, SQLite en memoria) |
| Pruebas frontend | `npm test` (Karma + ChromeHeadless) | **38 correctas, 1 omitida (`xit`)**, 0 fallidas (sin cambios en Karma al añadir las pantallas de 11–13) |
| Compilación frontend | `ng build` (producción) | Sin errores ni advertencias; bundle inicial 918 kB (212 kB transferidos); la vista de repartidor es un chunk diferido de ~18 kB |
| Compilación backend | `node -e "require('./src/runtime')"` + las 165 pruebas | Sin errores (JavaScript, sin paso de compilación) |
| Humo E2E Fase 1 | `npm run e2e:phase1` | **12 de 12 pasos** (sin regresiones tras migrar a OnPush) |
| Humo E2E Fase 2 | `npm run e2e:phase2` | **15 de 15 pasos** (administrador, supervisor y un móvil emulado de 390 px, simultáneos, contra backend + `ng serve`) |
| Humo E2E Fase 3b (puntos 11–13) | `npm run e2e:phase3b` | **14 de 14 pasos** (precios, inventario, preventa/autoventa/comodato/exhibición, liquidación con autorización de otro usuario, indicadores, bitácora, integraciones) |
| Humo E2E Fase 3 (puntos 8–10) | `npm run e2e:phase3` | **17 de 17 pasos** (administrador + móvil con geolocalización: formularios, parámetros, publicación, entrega parcial con foto y firma, cobro, GPS real, simulador, versión mínima) |
| Chequeo de tipos | `tsc -p tsconfig.app.json --noEmit` | Sin errores |

La prueba omitida es `ScreenBoundaryComponent … interaction failure` (preexistente: bajo Angular 22 los errores de listeners no llegan al `ErrorHandler` del componente; ver DECISIONES_TECNICAS §6). Antes de esta fase **las 11 pruebas Karma originales fallaban** en este entorno (falta de `ActivatedRoute`, input `app` no declarado en el doble de prueba, etc.).

No se probó: `docker compose up` (sin Docker en el entorno), SMTP real, `idoo` real, PAC real, dispositivos físicos, HTTPS/móvil por LAN.

## 2. Los 20 escenarios críticos

Leyenda: ✅ verificado · ◐ parcial · ⏳ pendiente (fase indicada)

| # | Escenario | Estado | Evidencia / qué falta |
|---|---|---|---|
| 1 | Registro de empresa y admin | ✅ | `auth.register.test.js` (7), E2E paso 11 (RFC **simulado** declarado) |
| 2 | Usuarios con distintos permisos | ✅ | `rbac.test.js` (7): matriz por rol, roles personalizados, cambios inmediatos, protección del último administrador |
| 3 | Bloqueo de usuario inactivo | ✅ | `auth.inactive.test.js` (4); E2E paso 7: la sesión de otro navegador cae sola |
| 4 | Clientes, productos y precios | ✅ | Clientes y productos con importación revalidada (`import.test.js`, `tenant-isolation.test.js`) y listas de precios con vigencia, promociones y cotización (`commerce.test.js`), E2E-3b pasos 11a–11b |
| 5 | Creación y aprobación de ruta | ✅ | `routes.test.js` (10), `realtime.test.js`; Karma (aprobación con la revisión mostrada); E2E-2 pasos 3–6 (crear, paradas, enviar, aprobar entre dos navegadores) |
| 6 | Invalidación de aprobación al editar | ✅ | `routes.test.js`: editar una ruta pendiente o publicada la regresa a Borrador, invalida la solicitud y `REVISION_MISMATCH` impide aprobar la versión vieja; E2E-2 pasos 7–8 (la solicitud desaparece de la bandeja del aprobador en vivo) |
| 7 | Vinculación de dispositivo | ✅ | `fleet.test.js` (6), `mobile.test.js`, `realtime.test.js`: QR de un solo uso, caduca, URL con alerta de localhost, revocación, confirmación SSE; E2E-2 pasos 9, 10 y 14 (el móvil escanea la URL, el panel confirma sin recargar; desvincular bloquea el teléfono) |
| 8 | Acceso como repartidor | ✅ | `mobile.test.js` (permisos, dispositivo requerido, conductor asignado, otra empresa, CSRF); E2E-2 paso 11 (login desde la vista móvil) |
| 9 | Consulta de ruta asignada | ✅ | `mobile.test.js` (solo rutas **Publicadas** del operador; borrador y pendiente no se descargan); E2E-2 pasos 11 y 13 (una ruta nueva aprobada llega al teléfono en vivo) |
| 10 | Posiciones GPS reales y simuladas | ✅ | `tracking.test.js` (6: lotes, descartes, estados REAL/SIMULATED/STALE/OFFLINE, simulador, reinicio), Karma `tracking.store.spec` (5), E2E-3 pasos 9a/9b/9c: «En vivo» solo con GPS real reciente; «Ubicación simulada» y «Simulación activa» rotulados |
| 11 | Entregas con evidencias | ✅ | `execution.test.js` (12: total/parcial/fallida, motivos, foto/firma obligatorias según el formulario, aislamiento), E2E-3 pasos 8a–8c y 8g (foto real y firma dibujada; la evidencia solo se sirve con sesión) |
| 12 | Registro de cobros | ✅ | `execution.test.js` (saldo FIFO, sobrepago, referencia, idempotencia), Karma `driver.service.spec` (clave reutilizada en el reintento), E2E-3 paso 8d (doble clic no duplica) |
| 13 | Cierre de ruta | ✅ | `execution.test.js` (`VISITS_PENDING`, resumen, notificación, bloqueo por saldo vencido), E2E-3 pasos 8e–8f |
| 14 | Liquidación y conciliación | ✅ | `commerce.test.js` (apertura automática, depósitos idempotentes, tolerancia heredada, autorización por otra persona, inmutabilidad, doble liquidación), E2E-3b pasos 11e–11f |
| 15 | Indicadores y auditoría | ✅ | `adapters-reports.test.js` (cifras desde la BD, filtros, CSV, aislamiento, bitácora con filtros y cadena de hashes), E2E-3b pasos 13a–13b |
| 16 | Persistencia tras reinicio de backend y frontend | ◐ | Backend: `db.test.js`. Navegador: la sesión sobrevive a recargar (E2E-1 y 2). Rutas, clientes, productos, usuarios y dispositivos ya vienen del servidor; **siguen temporales en el navegador** los módulos listados en §5 |
| 17 | Acceso multi-navegador | ✅ | `tenant-isolation.test.js` («multi-navegador»), E2E pasos 6, 7, 8, 12 |
| 18 | Aislamiento total al cambiar de empresa | ✅ | `tenant-isolation.test.js` (11), Karma (empresa y centro), E2E 9 |
| 19 | Recuperación de contraseña desde otro navegador | ✅ | `auth.recovery.test.js` (9), E2E 8 y 10 |
| 20 | Actualización reactiva de UI sin recargas ni clics extra | ✅ | Zone.js + OnPush + signals en las 31 pantallas. Karma (error visible sin clics, RFC, cambio de centro, aprobación, importación) y E2E-1/2: login fallido, rutas, bandeja del aprobador, QR, panel de dispositivos y vista móvil se actualizan solos. Límite: la mutación en sitio de objetos anidados no notifica (usar reemplazo) |

## 3. Funciones terminadas (Fases 1 y 2 y puntos 8–10 de la Fase 3)

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
- **Documentación**: `README.md`, `README_LOCAL.md`, `DECISIONES_TECNICAS.md`, `PLAN_AVANCE.md`, `.env.example`.

## 4. Simulaciones (declaradas en la interfaz y en `GET /api/health`)

| Qué | Cómo se muestra | Cómo pasar a real |
|---|---|---|
| Validación de RFC | «Resultado SIMULADO… no verificada ante el SAT»; la empresa queda `fiscal_status=SIMULATED` | `RFC_MODE=idoo` + `IDOO_API_KEY=idoo_sk_live_…` |
| Correo | «MODO LOCAL — bandeja de desarrollo» | `MAIL_MODE=smtp` |
| Timbrado Carta Porte | Estado **Simulado**, sin UUID ni timbre | `PAC_MODE=live` + `PAC_API_URL` + `PAC_API_TOKEN` |
| Datos demo | Solo si ejecutas `seed:reset` | — |

Siguen **sin simular correctamente** (Fase 3.E): el panel *Configuración* aún muestra integraciones como «conectadas» con un booleano local, y la Torre de control muestra «En vivo» sin recibir GPS.

## 5. Pendientes y límites conocidos

1. Pendiente del plan: historial de Carta Porte íntegro desde la BD (3.E, parcial) y la Fase 4 (los 20 escenarios con archivos de prueba dedicados). Ver `DECISIONES_TECNICAS.md` §9.
2. Módulos que **todavía viven en el navegador** (temporal, por empresa y centro): Carta Porte (parcialmente), preferencias de perfil y marca, notificaciones visibles, marca, preferencias y Carta Porte generada.
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
