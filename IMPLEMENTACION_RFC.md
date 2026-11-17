# Validación fiscal de RFC (idoo.dev) en EnRuta

## Hallazgos (Fase 1)
- Angular 22 (Template-driven Forms, estado en `EnrutaState`), backend Express + PostgreSQL. **No hay Firebase.**
- El alta de empresa original vivía solo en `localStorage`; no existía endpoint de registro. Se creó `POST /api/companies/register` (guarda la empresa en PostgreSQL; la contraseña sigue local, como antes).
- Documentación confirmada de https://idoo.dev/apis/valida-rfc : `POST https://idoo.dev/v1/valida-rfc/validar`, `Authorization: Bearer`, body `{rfc, nombre?, cp?}`, veredicto en `data.valido` (no en `status`), `simulado`, key `idoo_sk_test_` = sandbox (siempre válido, simulado) / `idoo_sk_live_` = producción, plan gratis 50/mes y 2/min, timeout recomendado ≥30 s, 402 cuota, 429 rate limit, 502/503/504 transitorios.
- **Limitación del proveedor**: no distingue "RFC inexistente" de "datos no coinciden" salvo por el texto `resultado`. Solo se conoce el texto "...no coinciden..." → `MISMATCH`; cualquier otro `valido:false` → `REJECTED` (no se inventó otro texto). Con nombre y CP juntos no se sabe cuál falló. El nombre se compara literal (sin "SA DE CV" si no está inscrito así).

## Archivos creados
backend/src/services/companyValidation.service.js · controllers/companyValidation.controller.js · routes/companyValidation.routes.js · utils/rfc.js · test/companyValidation.test.js · src/app/core/company-validation.service.ts · IMPLEMENTACION_RFC.md
## Archivos modificados
backend/src/server.js (dotenv, trust proxy, ruta) · backend/package.json (dotenv, express-rate-limit, script test) · backend/sql/schema.sql (tablas) · backend/.env.example · docker-compose.yml · .gitignore · src/app/core/enruta-state.service.ts · src/app/screens/register-screen.component.html · src/styles.css

## Cómo funciona
1. Angular → `POST /api/companies/validate-rfc` `{rfc, razonSocial, codigoPostal}` (el front no envía ambiente ni estado).
2. Backend: formato persona moral + fecha → RFC duplicado → caché (24 h válidos / 15 min rechazados) → límite local 2/min → proveedor (timeout 30 s, 1 reintento en 5xx/red) → guarda en `company_validations`.
3. Una respuesta real satisfactoria (`VERIFIED`, key live + `simulado:false` + `valido:true`) devuelve un token de validación real. Una respuesta satisfactoria de sandbox devuelve un token distinto, limitado al modo de prueba.
4. "Continuar" se habilita con cualquiera de esos resultados satisfactorios. Al finalizar el alta, `POST /api/companies/register` valida el token, el ambiente, la fila de validación no usada y que los datos no hayan cambiado; RFC y correo siguen siendo únicos.
5. El alta con sandbox queda marcada `companies.fiscal_status='SIMULATED'` y sin fecha de verificación. Solo una validación de producción puede crear una empresa `VERIFIED`; un token sandbox no se acepta al cambiar a producción.

## Variables de entorno (backend/.env, ya ignorado por git)
`IDOO_API_KEY` (obligatoria), `IDOO_BASE_URL`, `IDOO_TIMEOUT_MS=30000`, `IDOO_MAX_RETRIES=1`, `IDOO_LOCAL_RATE_PER_MIN=2`, `RFC_VALIDATION_TTL_SECONDS=1800`, `VALIDATE_RFC_MAX_PER_MIN=6`, `JWT_SECRET`, `ADMIN_API_KEY`, `DATABASE_URL`.

## API Key
Suscríbete al plan Gratis en https://idoo.dev/apis/valida-rfc, crea la key en https://idoo.dev/panel/apikeys. Pon `IDOO_API_KEY=idoo_sk_live_...` en `backend/.env` para verificar RFC reales. Con `idoo_sk_test_...` se puede completar el flujo de prueba, pero las empresas quedan `SIMULATED`, no verificadas ante el SAT.

## Ejecutar
`docker compose up --build` (API :3000) y `npm install && npm start` (Angular :4200). Migración automática al iniciar la API (`npm run migrate` en backend/).
## Pruebas
`cd backend && npm install && DATABASE_URL=postgres://... npm test` — 13 pruebas (escenarios 1–12) con un servidor local que imita el contrato del proveedor (NO consultan al SAT). La prueba real (escenario 3/4 con SAT) requiere tu key live; consume 1 de las 50 consultas mensuales.
El frontend se verificó con `ngc` (tipos y plantillas); `ng build` no pudo ejecutarse en este entorno por binarios de esbuild de otra plataforma en `node_modules` (reinstala con `npm ci`).
## PostgreSQL
`schema.sql` crea `company_validations` y `companies` con índices únicos por RFC y correo, y amplía los estados fiscales permitidos para incluir `SIMULATED`. No elimina datos.
## Notas
La `API_KEY` de la app (`x-api-key`) ya estaba en el bundle de Angular; no es un secreto real. La key de idoo nunca sale del backend.

## Solución a `ERR_CONNECTION_REFUSED`
El navegador no alcanza la API. 1) Levanta backend + BD: `docker compose up --build` (o API local con PostgreSQL y `cd backend && npm start`). 2) Comprueba `http://localhost:3000/api/health` → `{"ok":true}`. 3) En GitHub Codespaces, abre la pestaña Puertos y pon el puerto 3000 en **Público**; `config.ts` ya calcula la URL `-3000.app.github.dev` automáticamente.

## Cliente reutilizable de idoo.dev (`backend/src/clients/idoo.client.js`)
Creado tras releer https://idoo.dev/apis/valida-rfc.md. `createIdooClient()` lee `IDOO_API_KEY` (solo servidor) y expone `validar({rfc,nombre,cp})`, `efos(rfc)`, `listas(rfc)`, `salud()` y `request()`. El veredicto sale de `data.valido`, no del status HTTP. Errores → `IdooError` con `code`:
401/403 `AUTH` · 402 `QUOTA_EXHAUSTED` (sin reintento) · 429 `RATE_LIMIT` (si `Retry-After` ≤ 5 s espera y reintenta una vez; si no, lanza con `retryAfter`) · 400/422 `INVALID_INPUT` · 502/503/504 `UPSTREAM` y `TIMEOUT`/`NETWORK` (backoff exponencial 1 s, 2 s; 3 intentos máx.).
`companyValidation.service.js` ahora usa este cliente (misma API pública y mismos códigos de respuesta). Ejemplo: `cd backend && npm run example:idoo -- FCA130603EX5` (con sandbox es gratis y la respuesta es simulada). Pruebas: `backend/test/idooClient.test.js` (10, sin red).
La key `idoo_sk_test_...` va en `backend/.env` (ignorado por git); `.env.example` solo tiene `IDOO_API_KEY=` vacío.
