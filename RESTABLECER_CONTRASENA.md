> **Documento histórico.** La recuperación de contraseña ya no usa JWT en memoria ni cuentas en `localStorage`: el token es de un solo uso, vive en la base de datos y el correo local se consulta en `/dev/correo`. Ver `README_LOCAL.md` §4.

# Restablecimiento de contraseña (JWT + Nodemailer, sin base de datos)

## Flujo
1. `/forgot-password` (Reactive Forms): `POST /api/auth/forgot-password {email}` → el backend firma un JWT HS256 `{email, jti}` de **15 min** y envía un correo HTML (botón **"Restablecer"**) a `FRONTEND_URL/reset-password?token=<JWT>`.
2. `/reset-password?token=…`: sin token → redirige a `/login`. Con token → `GET /api/auth/validate-reset-token`. Expirado, firma inválida o `jti` ya usado → mensaje de enlace inválido con botón "Solicitar un enlace nuevo". Si el servidor no responde se muestra "Reintentar" (no se declara el enlace inválido).
3. Formulario (nueva + confirmar, mostrar/ocultar, mínimo 12 caracteres, mayúscula y número —misma política de la app—, coincidencia) → `POST /api/auth/reset-password {token,newPassword}`. El backend verifica, registra el `jti` en un `Map` en memoria (un solo uso, sin carreras) y responde `200 {ok,email}`.
4. Como las cuentas de EnRuta viven en `localStorage`, el frontend actualiza el hash PBKDF2 de la cuenta local (`EnrutaState.applyPasswordReset`), muestra "Contraseña restablecida con éxito" y navega a `/login`.

## Archivos creados
backend: `src/services/passwordReset.service.js`, `src/controllers/passwordReset.controller.js`, `src/routes/auth.routes.js`, `test/passwordReset.test.js`
frontend: `src/app/app.routes.ts`, `src/app/core/auth.service.ts`, `src/app/auth/forgot-password.component.{ts,html}`, `src/app/auth/reset-password.component.{ts,html}`
## Archivos modificados
`backend/src/server.js` (monta `/api/auth`), `backend/package.json` (nodemailer), `backend/.env.example`, `src/app/app.config.ts` (provideRouter), `src/app/app.component.{ts,html}` (router-outlet dentro del layout de acceso), `src/app/core/enruta-state.service.ts` (`announce`, `hasAccount`, `applyPasswordReset`), `src/app/screens/login-screen.component.{ts,html}` (enlace a /forgot-password), `src/styles.css`.

## Variables de entorno (backend/.env)
`FRONTEND_URL` (http://localhost:4200; en Codespaces la URL pública del puerto 4200), `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, opcional `PASSWORD_RESET_SECRET` (si falta usa `JWT_SECRET`; **cámbialo en producción**), `FORGOT_PASSWORD_MAX_PER_15MIN`.
Gmail: activa verificación en 2 pasos y crea una "contraseña de aplicación" → `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=tu@gmail.com`, `SMTP_PASS=<contraseña de aplicación>`. Mailtrap/Resend: usa los datos SMTP que te dan. Sin SMTP configurado la API responde 503 (no se simula el envío).

## Ejecutar y probar
`cd backend && npm install && npm start` · `npm install && npm start` (Angular). Pruebas sin BD: `cd backend && node --test test/passwordReset.test.js` (8 pruebas: correo con botón y JWT de 15 min, token inválido/expirado/usado, un solo uso incluso con peticiones simultáneas, contraseña débil, fallo SMTP).

## Limitaciones (por no usar base de datos)
- El backend no conoce las cuentas: enviará el correo a cualquier dirección válida (limitado por rate limit por IP y 1 envío/min por correo). La cuenta debe existir en el navegador donde se abre el enlace; si no, se informa sin consumir el token.
- Los `jti` usados viven en memoria: reiniciar el servidor los olvida (el token sigue limitado a 15 min).
- El backend recibe la nueva contraseña en claro solo para validar la política; no la almacena ni la registra.
