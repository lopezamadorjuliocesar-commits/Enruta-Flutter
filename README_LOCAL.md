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

1. Averigua la IP de tu equipo (el backend la lista en `GET /api/system/network`, p. ej. `192.168.1.50`).
2. En `backend/.env`:
   ```
   PUBLIC_WEB_URL=http://192.168.1.50:4200
   PUBLIC_API_URL=http://192.168.1.50:3000
   ```
3. Reinicia el backend. Si esas URLs apuntan a `localhost`, el arranque y la pantalla **Dispositivos** muestran una advertencia: el teléfono no podría alcanzarlas.
4. Permite los puertos 3000 y 4200 en el firewall y conecta el móvil a la misma red.

El QR contiene `{ v:1, api: <PUBLIC_API_URL>, token }` (token de 15 min y un solo uso). La app móvil confirma con `POST /api/mobile/link`.

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
npm run test:backend                         # 106 pruebas node:test
npm test                                     # Karma (CHROME_BIN=/ruta/a/chrome si no está en el PATH)
npm run seed:reset && npm run start:backend  # y en otra terminal: npm start
npm run e2e:phase1                           # humo E2E con Playwright
```

## 9. Contrato REST para el móvil (Flutter)

No hay proyecto Flutter en este repositorio. Disponible hoy:
- `POST /api/mobile/link` (también `/api/mobile/v1/link`) — cuerpo `{ token, model, os, osVersion, brand?, serial?, fcmToken? }` → `{ ok, deviceToken, device, driver, vehicle }`. Sin cookies ni `X-EnRuta-Client`.
- Autenticación de usuario repartidor: `POST /api/auth/login` con el encabezado `X-EnRuta-Client: mobile` devuelve `token` en el cuerpo; envíalo como `Authorization: Bearer <token>`.
- El resto del contrato (ruta del día, visitas, entregas, evidencias, cobros, GPS) llega en las Fases 2 y 3.

## 10. Producción (resumen)
Define `NODE_ENV=production`, `DATA_ENCRYPTION_KEY`, `MAIL_MODE=smtp`, `COOKIE_SECURE=true` y sirve web y API bajo el mismo dominio HTTPS (proxy inverso). La migración a PostgreSQL está en DECISIONES_TECNICAS.md §4.

## 11. Migración desde la versión anterior
Las cuentas, contraseñas y datos que la versión anterior guardaba en `localStorage` **no se importan** (hashes incompatibles y datos no verificables). Al primer arranque el navegador los elimina.
Mientras las Fases 2–3 no migren cada módulo, los datos operativos de rutas, clientes del planeador, precios, formularios, etc. se guardan **temporalmente en este navegador**, separados por empresa y centro (`enruta.interim.v1.<empresaId>.<centroId>`).
