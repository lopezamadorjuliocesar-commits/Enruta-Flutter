# EnRuta — Estado de implementación

Corte: **Fase 1 terminada** (2026-11-18). Este documento solo afirma lo que se ejecutó; lo demás figura como pendiente.

## 1. Resultados reales de verificación

| Comprobación | Comando | Resultado |
|---|---|---|
| Pruebas backend | `npm run test:backend` | **106 de 106 correctas** (15 archivos, ~5 s, SQLite en memoria) |
| Pruebas frontend | `npm test` (Karma + ChromeHeadless) | **22 correctas, 1 omitida (`xit`)**, 0 fallidas |
| Compilación | `ng build` (producción) | Sin errores ni advertencias; bundle inicial 870.9 kB (204 kB transferidos) |
| Humo E2E (navegador real) | `npm run e2e:phase1` | **12 de 12 pasos** (4 navegadores simultáneos contra backend + `ng serve`) |
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
| 4 | Clientes, productos y precios | ◐ | API de clientes (por centro) y productos con pruebas de alcance; **precios, listas y UI de clientes/productos → Fase 2.B/3.D** |
| 5 | Creación y aprobación de ruta | ⏳ | Fase 2.C (las rutas siguen en estado temporal del navegador) |
| 6 | Invalidación de aprobación al editar | ⏳ | Fase 2.C |
| 7 | Vinculación de dispositivo | ◐ | `fleet.test.js` (6): QR de un solo uso, caduca, invalida el anterior, genérico/por dispositivo, robado. **Confirmación en tiempo real (SSE) y revocación → Fase 2.D** |
| 8 | Acceso como repartidor | ◐ | Login con Bearer (`X-EnRuta-Client: mobile`) y permisos de rol probados; **vista de repartidor → Fase 2.D** |
| 9 | Consulta de ruta asignada | ⏳ | Fase 2.D |
| 10 | Posiciones GPS reales y simuladas | ⏳ | Fase 3.B (la Torre de control aún muestra «En vivo» fijo) |
| 11 | Entregas con evidencias | ⏳ | Fase 3.A (el almacén de archivos en disco ya existe: se usa para la foto de perfil) |
| 12 | Registro de cobros | ⏳ | Fase 3.A |
| 13 | Cierre de ruta | ⏳ | Fase 3.A |
| 14 | Liquidación y conciliación | ⏳ | Fase 3.D (la liquidación sigue siendo manual y local) |
| 15 | Indicadores y auditoría | ◐ | Auditoría persistente append-only con cadena de hashes ✅ (`audit.test.js`, 5) y visible en la UI; **indicadores desde la BD → Fase 3.F** |
| 16 | Persistencia tras reinicio de backend y frontend | ◐ | Backend: `db.test.js` (datos, sesiones y tokens sobreviven al reinicio; la cola recupera trabajos). Navegador: la sesión sobrevive a recargar (E2E 3). **El estado temporal de módulos sin API depende del navegador** |
| 17 | Acceso multi-navegador | ✅ | `tenant-isolation.test.js` («multi-navegador»), E2E pasos 6, 7, 8, 12 |
| 18 | Aislamiento total al cambiar de empresa | ✅ | `tenant-isolation.test.js` (11), Karma (empresa y centro), E2E 9 |
| 19 | Recuperación de contraseña desde otro navegador | ✅ | `auth.recovery.test.js` (9), E2E 8 y 10 |
| 20 | Actualización reactiva de UI sin recargas ni clics extra | ◐ | Verificado en: login/logout, expiración de sesión, RFC, recuperación, cambio de centro, bandeja local (Karma + E2E). **Auditoría completa de las 31 pantallas → Fase 2.A** |

## 3. Funciones terminadas en la Fase 1

- **Persistencia**: SQLite (`better-sqlite3`), migraciones con checksum, `seed:reset` con confirmación, repositorios asíncronos (listos para PostgreSQL), arranque sin borrar datos.
- **Cola sin Redis**: `jobs_queue` con estados, backoff exponencial, `dedupe_key`, reclamo atómico, recuperación al reiniciar. La usan el correo y el timbrado de Carta Porte.
- **Autenticación**: registro de empresa + administrador (transacción única), login/logout, sesiones opacas validadas en cada petición (cookie HttpOnly o Bearer), bcrypt (coste 12), bloqueo tras 5 fallos, revocación y bloqueo inmediato al inactivar, expiración por inactividad y absoluta, cierre/listado de sesiones, cambio de contraseña, perfil con foto en disco, 2FA TOTP cifrado en reposo (vectores RFC 6238 verificados).
- **Recuperación de contraseña**: token de un solo uso en BD (15 min), enfriamiento, respuesta idéntica exista o no el correo, revoca sesiones, bandeja local `/dev/correo` accesible desde otro navegador.
- **Aislamiento**: la empresa sale de la sesión (jamás de un header); IDs estables; recursos de otra empresa o centro → 404; centro activo persistido en la sesión y filtrado real; el front vacía el estado y cancela peticiones al cambiar de empresa, centro o cerrar sesión.
- **RBAC**: 34 permisos, 4 roles de sistema + roles personalizados, `requirePermission` en cada endpoint, editor de permisos conectado al backend, `*appCan` y `permissionGuard` en Angular.
- **Seguridad del cliente**: se eliminó la API key administrativa del bundle; anti-CSRF por encabezado; el token de Mapbox lo sirve el backend.
- **Integraciones con honestidad**: adaptadores RFC (local determinista / idoo) y correo (local / smtp); `IDOO_API_KEY` vacía ya no pisa la real; la UI declara «Simulado / Desarrollo».
- **Portado sin pérdida**: dispositivos, conductores, vehículos, QR de vinculación, `POST /api/mobile/link`, Carta Porte.
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

1. Fases 2–4 del plan (rutas versionadas, vista de repartidor, SSE, GPS, entregas, cobros, liquidaciones, formularios, parámetros por herencia, indicadores, E2E de los 20 escenarios).
2. Módulos que **todavía viven en el navegador** (temporal, por empresa y centro): rutas, aprobaciones, clientes/productos de la UI, precios, formularios, parámetros, liquidaciones manuales, notificaciones visibles, marca, preferencias, Carta Porte generada.
3. `ScreenBoundary` no captura errores de interacción (Angular 22); pruebas de reactividad completas en Fase 2.A.
4. Las pantallas aún declaran `ChangeDetectionStrategy.Default` de forma transitoria (Angular 22 usa OnPush por defecto).
5. SSO corporativo inexistente (botón deshabilitado y rotulado).
6. No existe proyecto Flutter; no se modificó nada móvil.
7. Los límites de intentos por IP viven en memoria del proceso (se reinician con el servidor); el bloqueo por cuenta sí es persistente.
8. `docker-compose.yml` sin probar.
