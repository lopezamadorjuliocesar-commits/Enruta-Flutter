# EnRuta · Panel administrador

Panel web Angular (22) con backend Node.js (22) y **SQLite local**. Sin servicios externos para operar en local (solo el mapa usa Mapbox).

- Instalación, arranque, datos demo y red local (QR desde el móvil): **[README_LOCAL.md](README_LOCAL.md)**
- Decisiones técnicas y arquitectura: [DECISIONES_TECNICAS.md](DECISIONES_TECNICAS.md)
- Plan por fases y avance: [PLAN_AVANCE.md](PLAN_AVANCE.md)
- Estado real (pruebas, funciones terminadas, simulaciones y pendientes): [ESTADO_IMPLEMENTACION.md](ESTADO_IMPLEMENTACION.md)

## Arranque rápido

```bash
npm install && npm install --prefix backend
npm run seed:reset      # datos demo (borra y repone ./backend/data y ./backend/storage)
npm run start:backend   # terminal 1 → http://localhost:3000
npm start               # terminal 2 → http://localhost:4200
```

Perfil demo: `demo@enruta.mx` / `Demo12345678` (solo existe tras `seed:reset`).

## Pruebas

```bash
npm run test:backend    # node:test · SQLite en memoria
npm test                # Karma/Jasmine (requiere Chrome; CHROME_BIN opcional)
npm run e2e:phase1      # humo en navegador real (requiere backend + web en marcha y Playwright)
```

## Estructura

- `src/app/` — Angular. `core/` (HTTP, sesión, RBAC, estado), `screens/` (una pantalla = un componente), `auth/`, `dev/` (bandeja de correo local).
- `backend/` — Express: `src/{config,db,repositories,services,adapters,queue,routes,middleware}`, `migrations/`, `scripts/`, `test/`.
- `backend/sql/legacy-postgres-schema.sql` — esquema PostgreSQL anterior (solo referencia para la migración futura).

> Nota: el repositorio no contiene proyecto Flutter. El contrato REST para el móvil se documenta en README_LOCAL.md.
