'use strict';
const express = require('express');
const cors = require('cors');
const { openConnection, migrate, Store } = require('./db/sqlite');
const createRepositories = require('./repositories');
const { createQueue } = require('./queue/queue');
const { createRfcAdapter } = require('./adapters/rfc');
const { createMailAdapter } = require('./adapters/mail');
const { createFileStore } = require('./storage/file-store');
const { createAuthService } = require('./services/auth.service');
const { createAdminService } = require('./services/admin.service');
const { createCatalogService } = require('./services/catalog.service');
const { createFiscalService } = require('./services/fiscal.service');
const { createFleetService } = require('./services/fleet.service');
const { createRoutesService } = require('./services/routes.service');
const { EventBus } = require('./realtime/bus');
const { CATALOG } = require('./services/permissions');
const http = require('./middleware/http');
const createRoutes = require('./routes');

/**
 * Compone toda la aplicación (BD, cola, adaptadores, servicios, Express) sin abrir el puerto.
 * Las pruebas la usan con DB_PATH=':memory:' y un directorio de storage temporal.
 */
async function createRuntime(config, { clock = () => Date.now(), logger = console, fetchImpl } = {}) {
  const conn = openConnection(config.dbPath);
  migrate(conn);
  const store = new Store(conn, createRepositories);
  await store.tx((r) => r.permissions.sync(CATALOG));

  const files = createFileStore(config.storageDir);
  const adapters = { rfc: createRfcAdapter(config, { fetchImpl }), mail: createMailAdapter(config, store) };
  const queue = createQueue({ store, config, now: clock, logger });
  const bus = new EventBus({ logger });
  const auth = createAuthService({ config, store, queue, adapters, clock, bus });
  const admin = createAdminService({ store, clock, auth, bus });
  const catalog = createCatalogService({ store, clock });
  const fiscal = createFiscalService({ store, queue, clock });
  const fleet = createFleetService({ config, store, clock, bus });
  const routes = createRoutesService({ store, clock, bus });
  queue.register('SEND_MAIL', async (payload) => { await adapters.mail.send(payload); return { scrubPayload: true }; });
  queue.register('CARTA_PORTE_STAMP', (payload, job) => fiscal.stampJob(payload, job));

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)), credentials: true, allowedHeaders: ['Content-Type', 'Authorization', 'X-EnRuta-Client', 'Idempotency-Key', 'X-Client-Version'] }));
  app.use('/api', (req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', http.csrfGuard);
  const services = { auth, admin, catalog, fiscal, fleet, routes };
  app.use('/api', createRoutes({ config, store, queue, services, adapters, files, clock, bus }));
  app.use(http.errorHandler(logger));

  return { app, config, store, queue, services, adapters, files, clock, bus,
    async close() { bus.closeAll(); await queue.stop(); store.close(); } };
}
module.exports = { createRuntime };
