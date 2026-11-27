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
const { createConfigService } = require('./services/config.service');
const { createExecutionService } = require('./services/execution.service');
const { createTrackingService } = require('./services/tracking.service');
const { createPricingService } = require('./services/pricing.service');
const { createInventoryService } = require('./services/inventory.service');
const { createReportsService } = require('./services/reports.service');
const { createIntegrations } = require('./services/integrations');
const { createSettlementsService } = require('./services/settlements.service');
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
  const integrations = createIntegrations({ config, adapters, clock });
  const rfcValidate = adapters.rfc.validate.bind(adapters.rfc);
  adapters.rfc.validate = async (input) => { const out = await rfcValidate(input); if (!out.simulated) integrations.record('rfc', ['VERIFIED', 'REJECTED', 'MISMATCH'].includes(out.status), out.message); return out; };
  const queue = createQueue({ store, config, now: clock, logger });
  const bus = new EventBus({ logger });
  const auth = createAuthService({ config, store, queue, adapters, clock, bus });
  const admin = createAdminService({ store, clock, auth, bus });
  const catalog = createCatalogService({ store, clock });
  const fiscal = createFiscalService({ store, queue, clock });
  const fleet = createFleetService({ config, store, clock, bus });
  const configSvc = createConfigService({ store, clock, bus });
  const execution = createExecutionService({ store, clock, bus, files, config: configSvc });
  const reports = createReportsService({ store, clock });
  const pricing = createPricingService({ store, clock });
  const inventory = createInventoryService({ store, clock, queue, config: configSvc });
  const settlements = createSettlementsService({ store, clock, config: configSvc });
  const routes = createRoutesService({ store, clock, bus, config: configSvc, execution });
  const tracking = createTrackingService({ store, clock, bus, config });
  await tracking.resetSimulations();
  queue.register('SEND_MAIL', async (payload) => { try { await adapters.mail.send(payload); integrations.record('mail', true); } catch (e) { integrations.record('mail', false, e); throw e; } return { scrubPayload: true }; });
  queue.register('NOTIFY', async ({ companyId, centerId = null, category = 'Sistema', title, detail = null }) => { await store.tx((r) => r.notifications.add({ companyId, centerId, category, title, detail, createdAt: new Date(clock()).toISOString() })); });
  queue.register('CARTA_PORTE_STAMP', async (payload, job) => { try { const out = await fiscal.stampJob(payload, job); if (config.pacMode === 'live') integrations.record('pac', true); return out; } catch (e) { if (config.pacMode === 'live') integrations.record('pac', false, e); throw e; } });
  queue.register('STOCK_ALERT', (payload) => inventory.stockAlertJob(payload));

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)), credentials: true, allowedHeaders: ['Content-Type', 'Authorization', 'X-EnRuta-Client', 'Idempotency-Key', 'X-Client-Version'] }));
  app.use('/api', (req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', http.csrfGuard);
  const services = { reports, integrations, auth, admin, catalog, fiscal, fleet, routes, config: configSvc, execution, tracking, pricing, inventory, settlements };
  app.use('/api', createRoutes({ config, store, queue, services, adapters, files, clock, bus, idempotency: require('./middleware/idempotency')({ store, clock }) }));
  app.use(http.errorHandler(logger));

  return { app, config, store, queue, services, adapters, files, clock, bus,
    async close() { tracking.stopAll(); bus.closeAll(); await queue.stop(); store.close(); } };
}
module.exports = { createRuntime };
