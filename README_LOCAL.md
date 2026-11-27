# EnRuta · Guía local

## Requisitos
- Node.js 22 o superior y npm 10+.
- Chrome/Chromium solo para las pruebas del frontend y el humo E2E.
- Internet solo para los mosaicos del mapa (Mapbox). Sin Internet el resto funciona.

## 1. Instalar

```bash
npm install
npm install --prefix backend
cp backend/.env.example backend/.env     # opcional: los valores por defecto sirven para desarrollo
```

`backend/.env` está ignorado por git. **No guardes secretos en `.env.example`.**
Una variable vacía (`IDOO_API_KEY=`) cuenta como *no definida*: nunca pisa una clave real.

## 2. Datos

La base es un archivo SQLite (`backend/data/enruta.sqlite`) y las fotos/evidencias van a disco (`backend/storage/`).
**Arrancar nunca borra datos**: solo aplica migraciones pendientes.

```bash
npm run migrate      # opcional: aplica migraciones sin arrancar el servidor
npm run seed:reset   # REINICIA los datos demo (borra BD y storage). Detén el backend antes.
```

`seed:reset` crea dos empresas ficticias (contraseña de todos: `Demo12345678`):

| Empresa | Usuarios |
|---|---|
| EnRuta Demo SA de CV (centros Matriz, Norte, Sur) | `demo@enruta.mx` (Administrador), `supervisor@enruta.mx`, `repartidor@enruta.mx`, `repartidor2@enruta.mx`, `preventista@enruta.mx` |
| Distribuidora Norte SA de CV (Matriz, Monterrey) | `admin@norte.mx`, `repartidor@norte.mx` |

Se niega a correr con `NODE_ENV=production`.

## 3. Arrancar

```bash
npm run start:backend    # API en 0.0.0.0:3000
npm start                # web en 0.0.0.0:4200 (proxy /api → 127.0.0.1:3000)
```

Abre http://localhost:4200. La sesión es una cookie HttpOnly validada por el backend; no hay llaves en el navegador.

## 4. Correo local (recuperación de contraseña)

Con `MAIL_MODE=local` (por defecto fuera de producción) **no se envía ningún correo**. Los mensajes quedan en la bandeja de desarrollo:
- Vista: http://localhost:4200/dev/correo (sin sesión: ábrela desde **otro navegador** para probar la recuperación)
- API: `GET /api/dev/mailbox[?to=correo]`

Está rotulada «MODO LOCAL». Con `MAIL_MODE=smtp` la bandeja no existe.

## 5. Red local / QR desde el teléfono

Backend y web escuchan en `0.0.0.0` (puertos 3000 y 4200): cualquier equipo de tu red puede alcanzarlos por tu IP.

1. Averigua la IP de tu equipo (el backend la lista en `GET /api/system/network`, p. ej. `192.168.1.50`).
2. En `backend/.env`:
   ```
   PUBLIC_WEB_URL=http://192.168.1.50:4200
   PUBLIC_API_URL=http://192.168.1.50:3000
   ```
3. Reinicia el backend. Si esas URLs apuntan a `localhost`, el arranque, `GET /api/system/network` y el panel **Dispositivos** (aviso «Red local» y el diálogo del QR) muestran una advertencia: el teléfono no podría abrir el QR.
4. Permite los puertos 3000 y 4200 en el firewall y conecta el móvil a la misma red.

**Flujo:** *Dispositivos → Vincular dispositivo QR* muestra un QR con `http://<IP>:4200/repartidor/vincular#t=<token>` (un solo uso, 15 min). Al escanearlo con la cámara, el teléfono abre la vista de repartidor, se registra como dispositivo y **el panel lo confirma al instante** (SSE). Después el repartidor inicia sesión y ve su ruta. *Desvincular* corta su acceso de inmediato.
Para la app Flutter, la respuesta de `POST /api/devices/link-qr` incluye también `apiUrl` y `token` (formato histórico `{ v:1, api, token }`).

### Vista de repartidor
`/repartidor` (móvil, una columna): sin dispositivo vinculado muestra las instrucciones; con él pide correo y contraseña de un usuario con permiso de **Repartidor**, descarga las rutas que le asignaron y estén **Publicadas**, muestra sus paradas (llamar, cómo llegar) y permite **iniciar la ruta**. Visitas, entregas, cobros y evidencias llegan en la Fase 3 y la vista **no los simula**.

## 6. Modos simulados (honestidad operativa)

| Integración | Local (por defecto) | Real |
|---|---|---|
| Validación de RFC | `RFC_MODE=local`: determinista. Prefijo `REJ…` rechaza, `MIS…` no coincide, `ERR…` error, `TMO…` timeout; otro → **SIMULADO** | `RFC_MODE=idoo` + `IDOO_API_KEY` (`idoo_sk_live_…` consulta real; `idoo_sk_test_…` sigue siendo simulado) |
| Correo | `MAIL_MODE=local` | `MAIL_MODE=smtp` + `SMTP_*` |
| Timbrado Carta Porte | `PAC_MODE=local`: estado **Simulado**, sin UUID fiscal | `PAC_MODE=live` + `PAC_API_URL` + `PAC_API_TOKEN` |

Una empresa registrada con validación simulada queda con `fiscal_status=SIMULATED` y la interfaz lo declara.

## 7. Cola de trabajos

`jobs_queue` (SQLite) con estados `PENDING/RUNNING/SUCCEEDED/DEAD`, reintentos con backoff exponencial (2 s, 4 s… tope 5 min, 5 intentos) y recuperación al reiniciar (un trabajo interrumpido vuelve a `PENDING` cuando vence su lease). Consulta: `GET /api/queue/jobs` (permiso `config.manage`).

## 8. Pruebas

```bash
npm run test:backend                         # 189 pruebas node:test (BD SQLite temporal)
npm run test:scenarios                       # los 20 escenarios críticos como un solo recorrido (BD en archivo, con reinicio del backend)
npm run verify:phase4                        # build + backend + 20 escenarios + Karma, con informe (código 1 si algo falla)
npm test                                     # Karma (CHROME_BIN=/ruta/a/chrome si no está en el PATH)
npm run seed:reset && npm run start:backend  # y en otra terminal: npm start
npm run e2e:phase1                           # humo E2E (Fase 1, 12 pasos) con Playwright
npm run e2e:phase2                           # humo E2E (Fase 2, 15 pasos: rutas, QR, móvil, tiempo real)
npm run e2e:phase3b                          # humo E2E (Fase 3 · puntos 11–13, 14 pasos: precios, inventario, módulos, liquidación, indicadores)
npm run e2e:phase3                           # humo E2E (Fase 3 · puntos 8–10, 17 pasos: formularios, publicación, entrega, cobro, GPS, simulador)
```

### Resultados verificados (Fase 4)
| Comprobación | Resultado |
|---|---|
| `ng build` producción | sin errores ni advertencias (bundle inicial 976 kB) |
| Backend (`test:backend`) | 189 de 189 |
| Escenarios críticos (`test:scenarios`) | 20 de 20 |
| Karma (`npm test`) | 42 correctas, 1 omitida |
| E2E fases 1 / 2 / 3 / 3b | 12/12 · 15/15 · 17/17 · 14/14 |

Los E2E necesitan el stack levantado (`seed:reset`, `npm run start:backend`, `npm start`) y Playwright con un Chromium (`CHROME_BIN` si no está en el PATH). El detalle por escenario está en `ESTADO_IMPLEMENTACION.md` §2. `.env.example` se valida automáticamente (`backend/test/env-example.test.js`): toda variable nueva del backend debe documentarse ahí.

## 9. Contrato REST para el móvil (Flutter)

No hay proyecto Flutter en este repositorio. Contrato `/api/mobile/v1` disponible (lo consume la vista web de repartidor):
- `POST /api/mobile/v1/link` (también `/api/mobile/link`) — `{ token, model, os, osVersion, brand?, serial?, fcmToken? }` → `{ ok, deviceToken, device, driver, vehicle }`. Sin cookies ni `X-EnRuta-Client`.
- Autenticación de usuario: `POST /api/auth/login` con `X-EnRuta-Client: mobile` devuelve `token` en el cuerpo → `Authorization: Bearer <token>`.
- Con sesión **y** `X-Device-Token: <deviceToken>`:
  - `GET /api/mobile/v1/me` — usuario, empresa y dispositivo.
  - `GET /api/mobile/v1/routes` — rutas **Publicadas** o **En ejecución** asignadas al usuario, con sus paradas (`seq`, nombre, dirección, teléfono, lat/lng).
  - `POST /api/mobile/v1/routes/:id/start` — inicia la ruta (idempotente; solo la versión aprobada).
- Errores de dispositivo: `403 DEVICE_REQUIRED`, `401 DEVICE_REVOKED`, `403 DEVICE_BLOCKED`, `403 DEVICE_DRIVER_MISMATCH`.
- Tiempo real: `GET /api/events` (SSE).
- Ejecución en campo (todas las que escriben exigen `Idempotency-Key`, 8–80 caracteres; reenviarla devuelve la respuesta original con `Idempotent-Replay: true`):
  - `GET /api/mobile/v1/products` · `GET /api/mobile/v1/incident-reasons` · `GET /api/mobile/v1/config` (versión publicada: módulos, formularios y parámetros efectivos) · `POST /api/mobile/v1/config/ack` `{ version }`.
  - `POST /api/mobile/v1/routes/:id/stops/:clientId/arrive` `{ lat, lng, outsideReason?, form?, formVersion? }` (`422 OUTSIDE_RADIUS` fuera del radio) · `…/skip` `{ reason }`.
  - `POST /api/mobile/v1/visits/:id/delivery` `{ lines:[{productId, qtyPlanned, qtyDelivered, discountBp?, reason?}], incidentReason?, notes?, form?, formVersion? }` · `…/evidences?kind=PHOTO|SIGNATURE` (cuerpo = imagen PNG/JPEG/WebP, `Content-Type` de la imagen) · `…/payments` `{ method: CASH|TRANSFER|CARD, amountCents, reference?, form? }` · `…/close`.
  - `POST /api/mobile/v1/routes/:id/finish` · `POST /api/mobile/v1/incidents` `{ routeId, reason, visitId?, detail? }`.
  - `POST /api/mobile/v1/positions` `{ routeId, positions:[{lat, lng, accuracy?, speed?, heading?, recordedAt}] }` (≤ 100; solo con la ruta en ejecución).
  - Cabecera `X-Client-Version`: si la versión mínima publicada es mayor → `426 UPGRADE_REQUIRED`. Otros códigos: `OUTSIDE_LOADING_WINDOW`, `CREDIT_BLOCKED`, `OVERPAYMENT`, `VISITS_PENDING`, `DELIVERY_REQUIRED`, `FORM_INVALID`.
- Panel (sesión + permisos): `GET /api/routes/:id/execution`, `GET /api/evidences/:id` (`tracking.read`); `GET /api/tracking/live`, `GET /api/tracking/routes/:id/history`; `POST|DELETE /api/routes/:id/simulation` (`simulator.run`); `GET /api/config`, `PUT /api/config/draft` (`config.manage`), `POST /api/config/publish` (`config.publish`), `GET /api/config/versions[/:v]`, `GET /api/parameters/effective?routeId=&zoneId=&userId=&centerId=&source=draft&inheritedFor=ZONA`.

### Precios, inventario, liquidaciones, indicadores
- Panel (permisos): `GET/POST/PUT/DELETE /api/price-lists|promotions|discount-rules` (`prices.*`), `GET /api/pricing/quote?clientId=&items=productoId:cantidad,…`; `GET /api/inventory/stock|movements`, `POST /api/inventory/adjust`, `GET|POST /api/routes/:id/load` (`inventory.*`); `GET|POST /api/orders`, `GET|POST /api/assets` y `/assets/:id/loan|return|retire`; `GET /api/display-audits`.
- Móvil: `GET /api/mobile/v1/products?clientId=` (precio efectivo), `POST …/visits/:id/delivery` con `orderId` (preventa) o `sale:true` (autoventa), `POST …/visits/:id/display-audit`, `POST …/visits/:id/assets/verify|loan|return`.
- Liquidaciones: `GET /api/settlements[/:id]`, `POST /api/routes/:id/settlement`, `POST /api/settlements/:id/deposits|submit|authorize|reject` (con `Idempotency-Key`).
- Indicadores y bitácora: `GET /api/reports/summary|export.csv?from=&to=&centerId=&routeId=&operatorId=`, `GET /api/audit?action=&entity=&q=&from=&to=`, `GET /api/audit/export.csv`; estado real de integraciones: `GET /api/integrations`.
- PAC local determinista: un folio que empiece por `REJ-`, `ERR-` o `TMO-` simula rechazo, error o timeout; cualquier otro queda «Simulado» (sin UUID fiscal).
- Nota: las empresas creadas antes de esta versión deben asignar `inventory.read`, `inventory.manage` y `orders.manage` a sus roles (o ejecutar `npm run seed:reset`).

### GPS, simulador y configuración
- Estado de un vehículo: **Ubicación real** (GPS del teléfono, dato de ≤ `GPS_STALE_SECONDS`), **Ubicación simulada** (simulador), **Desactualizado** (hasta `GPS_OFFLINE_SECONDS`) y **Desconectado**. «En vivo» solo aparece con al menos un vehículo real reciente.
- Simulador: Torre de control → «Simular recorrido» en una ruta **en ejecución** (requiere `SIMULATOR_ENABLED=true`, activo por defecto fuera de producción). Se rotula como simulado en la interfaz.
- Configuración: edita módulos, formularios y parámetros (se guardan como **borrador**) y publícalos en «Configuración → Revisar publicación». Los dispositivos solo ven lo **publicado** y confirman su recepción.

## 10. Producción (resumen)
Define `NODE_ENV=production`, `DATA_ENCRYPTION_KEY`, `MAIL_MODE=smtp`, `COOKIE_SECURE=true` y sirve web y API bajo el mismo dominio HTTPS (proxy inverso). La migración a PostgreSQL está en DECISIONES_TECNICAS.md §4.

## 11. Migración desde la versión anterior
Las cuentas, contraseñas y datos que la versión anterior guardaba en `localStorage` **no se importan** (hashes incompatibles y datos no verificables). Al primer arranque el navegador los elimina.
Clientes, productos, rutas, aprobaciones, usuarios, roles y dispositivos ya viven en el backend. Mientras la Fase 3 no migre el resto, los datos de precios, formularios, parámetros, liquidaciones manuales, marca, etc. se guardan **temporalmente en este navegador**, separados por empresa y centro (`enruta.interim.v1.<empresaId>.<centroId>`).
