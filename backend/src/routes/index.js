'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { isLoopbackUrl, lanAddresses } = require('../config');
const { badRequest, notFound, unprocessable } = require('../utils/errors');
const { detectImage } = require('../storage/file-store');
const h = require('../middleware/http');

module.exports = function createRoutes({ config, store, queue, services, adapters, files, clock, bus, idempotency }) {
  const { reports, integrations, auth, admin, catalog, fiscal, fleet, routes, config: cfg, execution, tracking, pricing, inventory, settlements } = services;
  const { cmpVersion } = require('../services/params');
  const { HttpError } = require('../utils/errors');
  const router = express.Router();
  const { wrap, meta, requirePermission: need, requireAnyPermission: needAny } = h;
  const authed = h.requireAuth(auth);
  const limiter = (max, windowMs, code) => (config.rateLimit
    ? rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas solicitudes. Inténtalo más tarde.', code: code || 'RATE_LIMITED' } })
    : (_q, _s, n) => n());

  // Entrega del token: cookie HttpOnly para web; en el cuerpo solo si el cliente es móvil (Authorization: Bearer).
  async function deliverSession(req, res, out, status = 200) {
    res.append('Set-Cookie', h.sessionCookie(config, out.token, { keep: out.keep, expiresAt: out.expiresAt }));
    const ctx = await auth.authenticate(out.token); ctx.ip = req.ip;
    const body = { ok: true, session: await auth.sessionInfo(ctx), expiresAt: new Date(out.expiresAt).toISOString() };
    if (req.get('x-enruta-client') === 'mobile') body.token = out.token;
    res.status(status).json(body);
  }

  // ---------- públicas ----------
  router.get('/health', wrap(async (_req, res) => {
    const jobs = await queue.stats();
    res.json({ ok: true, db: true, time: new Date(clock()).toISOString(), queue: jobs,
      modes: { rfc: adapters.rfc.describe(), mail: adapters.mail.describe(), pac: { mode: config.pacMode === 'live' ? 'live' : 'local', simulated: config.pacMode !== 'live' } } });
  }));
  router.get('/system/network', (_req, res) => {
    const loop = isLoopbackUrl(config.publicWebUrl) || isLoopbackUrl(config.publicApiUrl);
    res.json({ publicWebUrl: config.publicWebUrl, publicApiUrl: config.publicApiUrl, lanAddresses: lanAddresses(), isLoopback: loop,
      warning: loop ? 'PUBLIC_WEB_URL / PUBLIC_API_URL apuntan a localhost: un teléfono no podrá usar el QR. Configura la IP de tu red local (p. ej. http://192.168.1.50:4200 y http://192.168.1.50:3000).' : null });
  });
  // Contrato móvil: el dispositivo confirma la vinculación con el token del QR (sin sesión de usuario).
  router.post(['/mobile/link', '/mobile/v1/link'], limiter(30, 60_000), wrap(async (req, res) => res.json(await fleet.mobileLink(req.body || {}))));
  router.get('/system/client-config', wrap(async (_req, res) => {
    const localMail = config.mailMode === 'local' && !config.production;
    const demoHint = localMail && !!(await store.read((r) => r.users.findByEmail('demo@enruta.mx')));   // solo si `seed:reset` sembró el perfil de prueba
    res.json({ mapboxToken: config.mapboxPublicToken, mailMode: config.mailMode, localMail, demoHint });
  }));

  router.post('/companies/validate-rfc', limiter(6, 60_000), wrap(async (req, res) => { const r = await auth.validateRfc(req.body || {}); res.status(r.httpStatus).json(r.body); }));
  router.post('/companies/register', limiter(10, 60_000), wrap(async (req, res) => {
    const out = await auth.register(req.body || {}, meta(req)); out.keep = false;
    await deliverSession(req, res, out, 201);
  }));

  router.post('/auth/login', limiter(config.loginIpMax, 15 * 60_000, 'LOGIN_RATE_LIMITED'), wrap(async (req, res) => {
    const out = await auth.login(req.body || {}, meta(req));
    if (out.mfaRequired) return res.json({ ok: true, mfaRequired: true, challengeId: out.challengeId });
    await deliverSession(req, res, out);
  }));
  router.post('/auth/mfa/verify', limiter(config.loginIpMax, 15 * 60_000, 'LOGIN_RATE_LIMITED'), wrap(async (req, res) => deliverSession(req, res, await auth.verifyMfa(req.body || {}, meta(req)))));
  router.post('/auth/forgot-password', limiter(5, 15 * 60_000), wrap(async (req, res) => res.json(await auth.forgotPassword(req.body || {}, meta(req)))));
  router.get('/auth/reset-password/validate', limiter(60, 15 * 60_000), wrap(async (req, res) => { res.set('Cache-Control', 'no-store'); const r = await auth.validateResetToken(req.query.token); res.status(r.valid ? 200 : (r.reason === 'EXPIRED' || r.reason === 'USED' ? 410 : 400)).json(r); }));
  router.post('/auth/reset-password', limiter(10, 15 * 60_000), wrap(async (req, res) => { res.set('Cache-Control', 'no-store'); res.json(await auth.resetPassword(req.body || {}, meta(req))); }));

  // Bandeja de correo local: SOLO existe en modo local y fuera de producción; sin sesión para poder abrirla desde otro navegador.
  if (config.mailMode === 'local' && !config.production) {
    router.get('/dev/mailbox', wrap(async (req, res) => {
      res.set('Cache-Control', 'no-store');
      const to = req.query.to ? String(req.query.to).trim().toLowerCase() : null;
      const rows = await store.read((r) => r.mailbox.list(50, to));
      res.json({ mode: 'LOCAL', notice: 'MODO LOCAL — bandeja de desarrollo: estos mensajes NO se enviaron por correo real.', messages: rows.map((m) => ({ id: m.id, to: m.to_email, subject: m.subject, text: m.text, html: m.html, at: m.created_at })) });
    }));
  }

  // ---------- autenticadas ----------
  router.use(authed);
  router.post('/auth/logout', wrap(async (req, res) => { await auth.logout(req.ctx); res.append('Set-Cookie', h.clearCookie(config)); res.json({ ok: true }); }));
  router.get('/session', wrap(async (req, res) => res.json(await auth.sessionInfo(req.ctx))));
  router.put('/session/center', wrap(async (req, res) => { await auth.setActiveCenter(req.ctx, req.body?.centerId ?? null); res.json(await auth.sessionInfo({ ...req.ctx, centerId: req.body?.centerId ?? null })); }));

  router.get('/auth/sessions', wrap(async (req, res) => res.json(await auth.listSessions(req.ctx))));
  router.delete('/auth/sessions', wrap(async (req, res) => { if (req.query.others !== '1') throw badRequest('Usa ?others=1 para cerrar las demás sesiones.'); res.json(await auth.revokeOtherSessions(req.ctx)); }));
  router.delete('/auth/sessions/:id', wrap(async (req, res) => { const r = await auth.revokeSession(req.ctx, req.params.id); if (r.current) res.append('Set-Cookie', h.clearCookie(config)); res.json({ ok: true, ...r }); }));

  router.put('/me', wrap(async (req, res) => res.json(await auth.updateProfile(req.ctx, req.body || {}))));
  router.put('/me/password', limiter(10, 15 * 60_000), wrap(async (req, res) => res.json(await auth.changePassword(req.ctx, req.body || {}))));
  router.post('/auth/mfa/setup', wrap(async (req, res) => res.json(await auth.mfaSetup(req.ctx))));
  router.post('/auth/mfa/confirm', limiter(20, 15 * 60_000), wrap(async (req, res) => res.json(await auth.mfaConfirm(req.ctx, req.body || {}))));
  router.post('/auth/mfa/disable', limiter(20, 15 * 60_000), wrap(async (req, res) => res.json(await auth.mfaDisable(req.ctx, req.body || {}))));

  router.get('/me/security-events', wrap(async (req, res) => res.json(await admin.audits.mine(req.ctx))));
  router.delete('/me/avatar', wrap(async (req, res) => {
    const u = await store.read((r) => r.users.getById(req.ctx.userId));
    if (u.avatar_path) { await files.remove(u.avatar_path); await store.tx((r) => r.users.update(req.ctx.companyId, req.ctx.userId, { avatar_path: null })); }
    res.json({ ok: true });
  }));
  router.post('/me/avatar', express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '2mb' }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw unprocessable('Envía una imagen PNG, JPEG o WebP (máx. 2 MB).', 'IMAGE_REQUIRED');
    const kind = detectImage(req.body); if (!kind) throw unprocessable('El archivo no es una imagen válida.', 'IMAGE_INVALID');
    const rel = `avatars/${req.ctx.companyId}/${req.ctx.userId}.${kind.ext}`;
    const old = await store.read((r) => r.users.getById(req.ctx.userId));
    await files.save(rel, req.body);
    if (old.avatar_path && old.avatar_path !== rel) await files.remove(old.avatar_path);
    await store.tx((r) => r.users.update(req.ctx.companyId, req.ctx.userId, { avatar_path: rel }));
    res.json({ ok: true });
  }));
  router.get('/me/avatar', wrap(async (req, res) => {
    const u = await store.read((r) => r.users.getById(req.ctx.userId)); if (!u.avatar_path) throw notFound('Sin foto de perfil.');
    const buf = await files.read(u.avatar_path); const kind = detectImage(buf);
    res.set({ 'Content-Type': kind?.mime || 'application/octet-stream', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(buf);
  }));

  // Usuarios, roles y permisos
  router.get('/users', needAny('users.read', 'users.manage'), wrap(async (req, res) => res.json(await admin.users.list(req.ctx))));
  router.post('/users', need('users.manage'), wrap(async (req, res) => res.status(201).json(await admin.users.create(req.ctx, req.body || {}))));
  router.put('/users/:id', need('users.manage'), wrap(async (req, res) => res.json(await admin.users.update(req.ctx, req.params.id, req.body || {}))));
  router.patch('/users/:id/status', need('users.manage'), wrap(async (req, res) => res.json(await admin.users.setStatus(req.ctx, req.params.id, req.body?.status))));
  router.get('/permissions', wrap(async (_req, res) => res.json(await admin.roles.catalog())));
  router.get('/roles', needAny('users.read', 'users.manage', 'roles.manage'), wrap(async (req, res) => res.json(await admin.roles.list(req.ctx))));
  router.post('/roles', need('roles.manage'), wrap(async (req, res) => res.status(201).json(await admin.roles.create(req.ctx, req.body || {}))));
  router.put('/roles/:id', need('roles.manage'), wrap(async (req, res) => res.json(await admin.roles.update(req.ctx, req.params.id, req.body || {}))));
  router.put('/roles/:id/permissions', need('roles.manage'), wrap(async (req, res) => res.json(await admin.roles.setPermissions(req.ctx, req.params.id, req.body?.permissions))));
  router.delete('/roles/:id', need('roles.manage'), wrap(async (req, res) => res.json(await admin.roles.remove(req.ctx, req.params.id))));

  // Centros y zonas
  router.get('/centers', wrap(async (req, res) => res.json(await admin.org.centers(req.ctx))));
  router.post('/centers', need('centers.manage'), wrap(async (req, res) => res.status(201).json(await admin.org.createCenter(req.ctx, req.body || {}))));
  router.put('/centers/:id', need('centers.manage'), wrap(async (req, res) => res.json(await admin.org.updateCenter(req.ctx, req.params.id, req.body || {}))));
  router.get('/zones', wrap(async (req, res) => res.json(await admin.org.zones(req.ctx))));
  router.post('/zones', need('centers.manage'), wrap(async (req, res) => res.status(201).json(await admin.org.createZone(req.ctx, req.body || {}))));

  // Datos operativos con alcance por empresa/centro
  router.get('/clients', need('clients.read'), wrap(async (req, res) => res.json(await catalog.clients.list(req.ctx, req.query))));
  router.get('/clients/:id', need('clients.read'), wrap(async (req, res) => res.json(await catalog.clients.get(req.ctx, req.params.id))));
  router.post('/clients', need('clients.write'), wrap(async (req, res) => res.status(201).json(await catalog.clients.create(req.ctx, req.body || {}))));
  router.put('/clients/:id', need('clients.write'), wrap(async (req, res) => res.json(await catalog.clients.update(req.ctx, req.params.id, req.body || {}))));
  router.get('/products', need('catalog.read'), wrap(async (req, res) => res.json(await catalog.products.list(req.ctx, req.query))));
  router.post('/products', need('catalog.write'), wrap(async (req, res) => res.status(201).json(await catalog.products.create(req.ctx, req.body || {}))));
  router.delete('/clients/:id', need('clients.write'), wrap(async (req, res) => res.json(await catalog.clients.remove(req.ctx, req.params.id))));
  router.delete('/products/:id', need('catalog.write'), wrap(async (req, res) => res.json(await catalog.products.remove(req.ctx, req.params.id))));
  router.post('/import/clients', need('import.run', 'clients.write'), wrap(async (req, res) => res.json(await catalog.importer.clients(req.ctx, req.body || {}))));
  router.post('/import/products', need('import.run', 'catalog.write'), wrap(async (req, res) => res.json(await catalog.importer.products(req.ctx, req.body || {}))));
  router.put('/products/:id', need('catalog.write'), wrap(async (req, res) => res.json(await catalog.products.update(req.ctx, req.params.id, req.body || {}))));

  // Rutas: ciclo con revisiones (la aprobación valida la versión exacta)
  router.get('/routes', need('routes.read'), wrap(async (req, res) => res.json(await routes.list(req.ctx))));
  router.post('/routes', need('routes.write'), wrap(async (req, res) => res.status(201).json(await routes.create(req.ctx, req.body || {}))));
  router.get('/routes/:id', need('routes.read'), wrap(async (req, res) => res.json(await routes.get(req.ctx, req.params.id))));
  router.put('/routes/:id', need('routes.write'), wrap(async (req, res) => res.json(await routes.update(req.ctx, req.params.id, req.body || {}))));
  router.put('/routes/:id/stops', need('routes.write'), wrap(async (req, res) => res.json(await routes.setStops(req.ctx, req.params.id, req.body || {}))));
  router.post('/routes/:id/duplicate', need('routes.write'), wrap(async (req, res) => res.status(201).json(await routes.duplicate(req.ctx, req.params.id))));
  router.post('/routes/:id/submit', need('routes.submit'), wrap(async (req, res) => res.json(await routes.submit(req.ctx, req.params.id, req.body || {}))));
  router.post('/routes/:id/approve', need('routes.approve'), wrap(async (req, res) => res.json(await routes.approve(req.ctx, req.params.id, req.body || {}))));
  router.post('/routes/:id/reject', need('routes.approve'), wrap(async (req, res) => res.json(await routes.reject(req.ctx, req.params.id, req.body || {}))));
  router.post('/routes/:id/cancel', need('routes.cancel'), wrap(async (req, res) => res.json(await routes.cancel(req.ctx, req.params.id, req.body || {}))));
  router.delete('/routes/:id', need('routes.write'), wrap(async (req, res) => res.json(await routes.remove(req.ctx, req.params.id))));
  router.get('/approvals', need('routes.approve'), wrap(async (req, res) => res.json(await routes.approvals(req.ctx))));

  // Tiempo real (SSE): el navegador se entera de QR vinculados, revocaciones, cambios de rutas y cierres de sesión sin sondear
  router.get('/events', (req, res) => {
    const scope = { companyId: req.ctx.companyId, userId: req.ctx.userId, centerIds: req.ctx.can('centers.all') ? 'all' : new Set(req.ctx.accessibleCenterIds) };
    bus.subscribe(res, scope);
  });

  // Contrato móvil v1 (repartidor): requiere sesión de usuario + credencial de dispositivo vinculado (X-Device-Token)
  const deviceGuard = wrap(async (req, _res, next) => {
    const d = await fleet.deviceFromToken(req.get('x-device-token'));
    if (d.companyId !== req.ctx.companyId) throw new (require('../utils/errors').HttpError)(403, 'DEVICE_REQUIRED', 'Este dispositivo pertenece a otra empresa.');
    if (d.driverEmail && d.driverEmail !== req.ctx.email.toLowerCase()) throw new (require('../utils/errors').HttpError)(403, 'DEVICE_DRIVER_MISMATCH', `Este dispositivo está asignado a ${d.driverName}.`);
    // Versión mínima de la app (parámetro heredado): 426 si el cliente es más viejo o no declara su versión.
    const eff = await cfg.effective(req.ctx, { userId: req.ctx.userId, centerId: req.ctx.centerId || undefined });
    const min = eff.values.min_client_version; const have = req.get('x-client-version');
    if (min && (!have || cmpVersion(have, min) < 0)) throw new HttpError(426, 'UPGRADE_REQUIRED', `Actualiza la aplicación: se requiere la versión ${min} o superior${have ? ` (tienes la ${have})` : ''}.`, { minVersion: min });
    req.device = d; next();
  });
  router.get('/mobile/v1/me', need('deliveries.execute'), deviceGuard, (req, res) => res.json({ user: { id: req.ctx.userId, name: req.ctx.name, email: req.ctx.email, role: req.ctx.roleName }, company: { id: req.ctx.companyId, name: req.ctx.company.legal_name }, device: { id: req.device.id, alias: req.device.alias, vehiclePlate: req.device.vehiclePlate } }));
  router.get('/mobile/v1/routes', need('deliveries.execute'), deviceGuard, wrap(async (req, res) => res.json(await routes.assignedTo(req.ctx))));
  router.post('/mobile/v1/routes/:id/start', need('deliveries.execute'), deviceGuard, wrap(async (req, res) => res.json(await routes.start(req.ctx, req.params.id))));
  // Ejecución en campo: todas las acciones que escriben exigen Idempotency-Key.
  const field = [need('deliveries.execute'), deviceGuard];
  router.get('/mobile/v1/products', ...field, wrap(async (req, res) => res.json(await execution.catalog(req.ctx, req.query.clientId ? String(req.query.clientId) : null))));
  router.post('/mobile/v1/visits/:id/display-audit', ...field, idempotency, wrap(async (req, res) => res.status(201).json(await execution.displayAudit(req.ctx, req.params.id, req.body || {}))));
  router.post('/mobile/v1/visits/:id/assets/:action', ...field, idempotency, wrap(async (req, res) => res.status(201).json(await execution.assetAction(req.ctx, req.params.id, req.params.action, req.body || {}))));
  router.get('/mobile/v1/incident-reasons', ...field, (_req, res) => res.json(execution.incidentCatalog()));
  router.get('/mobile/v1/config', ...field, wrap(async (req, res) => res.json(await cfg.forDevice(req.ctx))));
  router.post('/mobile/v1/config/ack', ...field, wrap(async (req, res) => res.json(await cfg.ack(req.ctx, req.device.id, req.body?.version))));
  router.post('/mobile/v1/routes/:id/stops/:clientId/arrive', ...field, idempotency, wrap(async (req, res) => res.status(201).json(await execution.arrive(req.ctx, req.params.id, req.params.clientId, req.body || {}))));
  router.post('/mobile/v1/routes/:id/stops/:clientId/skip', ...field, idempotency, wrap(async (req, res) => res.json(await execution.skip(req.ctx, req.params.id, req.params.clientId, req.body || {}))));
  router.post('/mobile/v1/visits/:id/delivery', ...field, idempotency, wrap(async (req, res) => res.status(201).json(await execution.delivery(req.ctx, req.params.id, req.body || {}))));
  router.post('/mobile/v1/visits/:id/evidences', ...field, express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '8mb' }), idempotency, wrap(async (req, res) => res.status(201).json(await execution.evidence(req.ctx, req.params.id, String(req.query.kind || '').toUpperCase(), req.body))));
  router.post('/mobile/v1/visits/:id/payments', ...field, idempotency, wrap(async (req, res) => res.status(201).json(await execution.payment(req.ctx, req.params.id, req.body || {}))));
  router.post('/mobile/v1/visits/:id/close', ...field, idempotency, wrap(async (req, res) => res.json(await execution.closeVisit(req.ctx, req.params.id))));
  router.post('/mobile/v1/routes/:id/finish', ...field, idempotency, wrap(async (req, res) => res.json(await execution.finish(req.ctx, req.params.id))));
  router.post('/mobile/v1/incidents', ...field, idempotency, wrap(async (req, res) => res.status(201).json(await execution.incident(req.ctx, req.body || {}))));
  router.post('/mobile/v1/positions', ...field, wrap(async (req, res) => res.json(await tracking.ingest(req.ctx, req.body?.routeId, req.body?.positions))));

  // Panel: ejecución de una ruta, evidencias, torre de control y simulador
  router.get('/routes/:id/execution', need('tracking.read'), wrap(async (req, res) => res.json(await execution.executionOf(req.ctx, req.params.id, require('../services/context').scopeCenterIds(req.ctx)))));
  router.get('/evidences/:id', need('tracking.read'), wrap(async (req, res) => {
    const f = await execution.evidenceFile(req.ctx, req.params.id, require('../services/context').scopeCenterIds(req.ctx));
    res.set({ 'Content-Type': f.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(f.buffer);
  }));
  router.get('/tracking/live', need('tracking.read'), wrap(async (req, res) => res.json(await tracking.live(req.ctx))));
  router.get('/tracking/routes/:id/history', need('tracking.read'), wrap(async (req, res) => res.json(await tracking.history(req.ctx, req.params.id, req.query))));
  router.post('/routes/:id/simulation', need('simulator.run'), wrap(async (req, res) => res.status(201).json(await tracking.startSimulation(req.ctx, req.params.id, req.body || {}))));
  router.delete('/routes/:id/simulation', need('simulator.run'), wrap(async (req, res) => res.json(await tracking.stopSimulation(req.ctx, req.params.id))));

  // Configuración versionada, formularios y parámetros con herencia
  router.get('/config', needAny('config.manage', 'config.publish'), wrap(async (req, res) => res.json(await cfg.get(req.ctx))));
  router.put('/config/draft', need('config.manage'), wrap(async (req, res) => res.json(await cfg.saveDraft(req.ctx, req.body || {}))));
  router.post('/config/publish', need('config.publish'), wrap(async (req, res) => res.status(201).json(await cfg.publish(req.ctx, req.body || {}))));
  router.get('/config/versions', needAny('config.manage', 'config.publish'), wrap(async (req, res) => res.json(await cfg.versions(req.ctx))));
  router.get('/config/versions/:v', need('config.manage'), wrap(async (req, res) => res.json(await cfg.versionPayload(req.ctx, req.params.v))));
  router.get('/parameters/effective', needAny('config.manage', 'routes.read'), wrap(async (req, res) => res.json(await cfg.effective(req.ctx, req.query))));

  // Auditoría y notificaciones
  router.get('/audit', need('audit.read'), wrap(async (req, res) => res.json(await admin.audits.list(req.ctx, req.query))));
  router.get('/audit/export.csv', need('audit.read'), wrap(async (req, res) => {
    const rows = await admin.audits.list(req.ctx, { ...req.query, limit: 500 }); const { csv } = require('../services/reports.service');
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bitacora.csv"', 'Cache-Control': 'private, no-store' })
      .send(csv([['Fecha', 'Actor', 'Acción', 'Entidad', 'Id entidad', 'Detalle', 'IP'], ...rows.map((e) => [e.at, e.actor, e.action, e.entity, e.entityId, e.detail ? JSON.stringify(e.detail) : '', e.ip])]));
  }));
  router.get('/reports/summary', need('reports.read'), wrap(async (req, res) => res.json(await reports.summary(req.ctx, req.query))));
  router.get('/reports/export.csv', need('reports.read'), wrap(async (req, res) => res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="indicadores.csv"', 'Cache-Control': 'private, no-store' }).send(await reports.exportCsv(req.ctx, req.query))));
  router.get('/audit/verify', need('audit.read'), wrap(async (req, res) => res.json(await admin.audits.verify(req.ctx))));
  router.get('/notifications', wrap(async (req, res) => res.json(await admin.notifications.list(req.ctx, req.query))));
  router.patch('/notifications/:id/read', wrap(async (req, res) => res.json(await admin.notifications.markRead(req.ctx, req.params.id))));

  // Carta Porte (timbrado en la cola local)
  router.post('/fiscal/carta-porte', need('fiscal.manage'), wrap(async (req, res) => res.status(202).json(await fiscal.submit(req.ctx, req.body))));
  router.get('/fiscal/carta-porte', need('fiscal.manage'), wrap(async (req, res) => res.json(await fiscal.list(req.ctx))));
  router.get('/fiscal/carta-porte/:id', need('fiscal.manage'), wrap(async (req, res) => res.json(await fiscal.get(req.ctx, req.params.id))));
  router.get('/fiscal/carta-porte/:id/xml', need('fiscal.manage'), wrap(async (req, res) => res.json(await fiscal.stampedXml(req.ctx, req.params.id))));

  // Conductores, vehículos y dispositivos (puerto de la versión anterior; la Fase 2 añade SSE, revocación y vista de repartidor)
  const dev = need('devices.manage');
  router.get('/drivers', dev, wrap(async (req, res) => res.json(await fleet.drivers.list(req.ctx))));
  router.post('/drivers', dev, wrap(async (req, res) => res.status(201).json(await fleet.drivers.create(req.ctx, req.body || {}))));
  router.post('/drivers/sync', dev, wrap(async (req, res) => res.json(await fleet.drivers.sync(req.ctx, req.body?.drivers))));
  router.put('/drivers/:id', dev, wrap(async (req, res) => res.json(await fleet.drivers.update(req.ctx, req.params.id, req.body || {}))));
  router.delete('/drivers/:id', dev, wrap(async (req, res) => { await fleet.drivers.remove(req.ctx, req.params.id); res.status(204).end(); }));
  router.get('/vehicles', dev, wrap(async (req, res) => res.json(await fleet.vehicles.list(req.ctx))));
  router.post('/vehicles', dev, wrap(async (req, res) => res.status(201).json(await fleet.vehicles.create(req.ctx, req.body || {}))));
  router.put('/vehicles/:id', dev, wrap(async (req, res) => res.json(await fleet.vehicles.update(req.ctx, req.params.id, req.body || {}))));
  router.delete('/vehicles/:id', dev, wrap(async (req, res) => { await fleet.vehicles.remove(req.ctx, req.params.id); res.status(204).end(); }));
  router.get('/devices', dev, wrap(async (req, res) => res.json(await fleet.devices.list(req.ctx))));
  router.post('/devices/link-qr', dev, wrap(async (req, res) => res.status(201).json(await fleet.devices.linkQr(req.ctx))));
  router.get('/devices/link-qr/:jti', dev, wrap(async (req, res) => res.json(await fleet.devices.linkQrStatus(req.ctx, req.params.jti))));
  router.get('/devices/:id', dev, wrap(async (req, res) => res.json(await fleet.devices.get(req.ctx, req.params.id))));
  router.post('/devices', dev, wrap(async (req, res) => res.status(201).json(await fleet.devices.create(req.ctx, req.body || {}))));
  router.put('/devices/:id', dev, wrap(async (req, res) => res.json(await fleet.devices.update(req.ctx, req.params.id, req.body || {}))));
  router.delete('/devices/:id', dev, wrap(async (req, res) => { await fleet.devices.remove(req.ctx, req.params.id); res.status(204).end(); }));
  router.post('/devices/:id/revoke', dev, wrap(async (req, res) => res.json(await fleet.devices.revoke(req.ctx, req.params.id))));
  router.post('/devices/:id/link-token', dev, wrap(async (req, res) => res.json(await fleet.devices.linkToken(req.ctx, req.params.id))));

  // Estado de la cola de la empresa
  router.get('/queue/jobs', need('config.manage'), wrap(async (req, res) => {
    const rows = await store.read((r) => r.jobs.list({ companyId: req.ctx.companyId, status: req.query.status, type: req.query.type, limit: 100 }));
    res.json(rows.map((j) => ({ id: j.id, type: j.type, status: j.status, attempts: j.attempts, maxAttempts: j.max_attempts, runAt: j.run_at, lastError: j.last_error, createdAt: j.created_at })));
  }));

  router.get('/integrations', need('config.manage'), (_req, res) => res.json(integrations.list()));

  // ---------- Precios, promociones y descuentos (DT-46) ----------
  router.get('/price-lists', need('prices.read'), wrap(async (req, res) => res.json(await pricing.lists(req.ctx))));
  router.get('/price-lists/:id', need('prices.read'), wrap(async (req, res) => res.json(await pricing.list(req.ctx, req.params.id))));
  router.post('/price-lists', need('prices.write'), wrap(async (req, res) => res.status(201).json(await pricing.saveList(req.ctx, null, req.body || {}))));
  router.put('/price-lists/:id', need('prices.write'), wrap(async (req, res) => res.json(await pricing.saveList(req.ctx, req.params.id, req.body || {}))));
  router.delete('/price-lists/:id', need('prices.write'), wrap(async (req, res) => res.json(await pricing.deleteList(req.ctx, req.params.id))));
  router.get('/promotions', need('prices.read'), wrap(async (req, res) => res.json(await pricing.promotions(req.ctx))));
  router.post('/promotions', need('prices.write'), wrap(async (req, res) => res.status(201).json(await pricing.savePromotion(req.ctx, null, req.body || {}))));
  router.put('/promotions/:id', need('prices.write'), wrap(async (req, res) => res.json(await pricing.savePromotion(req.ctx, req.params.id, req.body || {}))));
  router.delete('/promotions/:id', need('prices.write'), wrap(async (req, res) => res.json(await pricing.deletePromotion(req.ctx, req.params.id))));
  router.get('/discount-rules', need('prices.read'), wrap(async (req, res) => res.json(await pricing.discounts(req.ctx))));
  router.post('/discount-rules', need('prices.write'), wrap(async (req, res) => res.status(201).json(await pricing.saveDiscount(req.ctx, null, req.body || {}))));
  router.put('/discount-rules/:id', need('prices.write'), wrap(async (req, res) => res.json(await pricing.saveDiscount(req.ctx, req.params.id, req.body || {}))));
  router.delete('/discount-rules/:id', need('prices.write'), wrap(async (req, res) => res.json(await pricing.deleteDiscount(req.ctx, req.params.id))));
  router.get('/pricing/quote', need('prices.read'), wrap(async (req, res) => res.json(await pricing.quote(req.ctx, req.query))));

  // ---------- Inventario, carga de ruta, preventa, comodato y exhibición (DT-46b) ----------
  router.get('/inventory/stock', need('inventory.read'), wrap(async (req, res) => res.json(await inventory.stock(req.ctx, req.query))));
  router.post('/inventory/adjust', need('inventory.manage'), wrap(async (req, res) => res.json(await inventory.adjust(req.ctx, req.body || {}))));
  router.get('/inventory/movements', need('inventory.read'), wrap(async (req, res) => res.json(await inventory.movements(req.ctx, req.query))));
  router.get('/routes/:id/load', need('inventory.read'), wrap(async (req, res) => res.json(await inventory.routeLoad(req.ctx, req.params.id))));
  router.post('/routes/:id/load', need('inventory.manage'), wrap(async (req, res) => res.status(201).json(await inventory.loadRoute(req.ctx, req.params.id, req.body || {}))));
  router.get('/orders', needAny('orders.manage', 'inventory.read'), wrap(async (req, res) => res.json(await inventory.orders(req.ctx, req.query))));
  router.post('/orders', need('orders.manage'), wrap(async (req, res) => res.status(201).json(await inventory.createOrder(req.ctx, req.body || {}))));
  router.post('/orders/:id/cancel', need('orders.manage'), wrap(async (req, res) => res.json(await inventory.cancelOrder(req.ctx, req.params.id))));
  router.get('/assets', need('inventory.read'), wrap(async (req, res) => res.json(await inventory.assets(req.ctx, req.query))));
  router.post('/assets', need('inventory.manage'), wrap(async (req, res) => res.status(201).json(await inventory.createAsset(req.ctx, req.body || {}))));
  router.post('/assets/:id/:action(loan|return|retire)', need('inventory.manage'), wrap(async (req, res) => res.json(await inventory.assetAction(req.ctx, req.params.id, req.params.action, req.body || {}))));
  router.get('/assets/:id/events', need('inventory.read'), wrap(async (req, res) => res.json(await inventory.assetEvents(req.ctx, req.params.id))));
  router.get('/display-audits', need('tracking.read'), wrap(async (req, res) => res.json(await inventory.displayAudits(req.ctx))));

  // ---------- Liquidaciones (DT-47) ----------
  router.get('/settlements', need('settlements.read'), wrap(async (req, res) => res.json(await settlements.list(req.ctx))));
  router.get('/settlements/:id', need('settlements.read'), wrap(async (req, res) => res.json(await settlements.get(req.ctx, req.params.id))));
  router.post('/routes/:id/settlement', need('settlements.manage'), wrap(async (req, res) => res.status(201).json(await settlements.openForRoute(req.ctx, req.params.id))));
  router.post('/settlements/:id/deposits', need('settlements.manage'), idempotency, wrap(async (req, res) => res.status(201).json(await settlements.addDeposit(req.ctx, req.params.id, req.body || {}))));
  router.post('/settlements/:id/submit', need('settlements.manage'), idempotency, wrap(async (req, res) => res.json(await settlements.submit(req.ctx, req.params.id))));
  router.post('/settlements/:id/authorize', need('settlements.authorize'), idempotency, wrap(async (req, res) => res.json(await settlements.decide(req.ctx, req.params.id, true, req.body || {}))));
  router.post('/settlements/:id/reject', need('settlements.authorize'), idempotency, wrap(async (req, res) => res.json(await settlements.decide(req.ctx, req.params.id, false, req.body || {}))));

  router.use((_req, _res, next) => next(notFound('Ruta no encontrada.')));
  return router;
};
