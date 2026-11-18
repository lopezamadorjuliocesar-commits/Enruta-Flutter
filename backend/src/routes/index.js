'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { isLoopbackUrl, lanAddresses } = require('../config');
const { badRequest, notFound, unprocessable } = require('../utils/errors');
const { detectImage } = require('../storage/file-store');
const h = require('../middleware/http');

module.exports = function createRoutes({ config, store, queue, services, adapters, files, clock }) {
  const { auth, admin, catalog, fiscal } = services;
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
    const loop = isLoopbackUrl(config.publicWebUrl);
    res.json({ publicWebUrl: config.publicWebUrl, lanAddresses: lanAddresses(), isLoopback: loop,
      warning: loop ? 'PUBLIC_WEB_URL apunta a localhost: un teléfono no podrá abrir el QR. Configura la IP de tu red local (p. ej. http://192.168.1.50:4200).' : null });
  });
  router.get('/system/client-config', (_req, res) => res.json({ mapboxToken: config.mapboxPublicToken, mailMode: config.mailMode, localMail: config.mailMode === 'local' && !config.production }));

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
  router.put('/products/:id', need('catalog.write'), wrap(async (req, res) => res.json(await catalog.products.update(req.ctx, req.params.id, req.body || {}))));

  // Auditoría y notificaciones
  router.get('/audit', need('audit.read'), wrap(async (req, res) => res.json(await admin.audits.list(req.ctx, req.query))));
  router.get('/audit/verify', need('audit.read'), wrap(async (req, res) => res.json(await admin.audits.verify(req.ctx))));
  router.get('/notifications', wrap(async (req, res) => res.json(await admin.notifications.list(req.ctx, req.query))));
  router.patch('/notifications/:id/read', wrap(async (req, res) => res.json(await admin.notifications.markRead(req.ctx, req.params.id))));

  // Carta Porte (timbrado en la cola local)
  router.post('/fiscal/carta-porte', need('fiscal.manage'), wrap(async (req, res) => res.status(202).json(await fiscal.submit(req.ctx, req.body))));
  router.get('/fiscal/carta-porte', need('fiscal.manage'), wrap(async (req, res) => res.json(await fiscal.list(req.ctx))));
  router.get('/fiscal/carta-porte/:id', need('fiscal.manage'), wrap(async (req, res) => res.json(await fiscal.get(req.ctx, req.params.id))));
  router.get('/fiscal/carta-porte/:id/xml', need('fiscal.manage'), wrap(async (req, res) => res.json(await fiscal.stampedXml(req.ctx, req.params.id))));

  // Estado de la cola de la empresa
  router.get('/queue/jobs', need('config.manage'), wrap(async (req, res) => {
    const rows = await store.read((r) => r.jobs.list({ companyId: req.ctx.companyId, status: req.query.status, type: req.query.type, limit: 100 }));
    res.json(rows.map((j) => ({ id: j.id, type: j.type, status: j.status, attempts: j.attempts, maxAttempts: j.max_attempts, runAt: j.run_at, lastError: j.last_error, createdAt: j.created_at })));
  }));

  router.use((_req, _res, next) => next(notFound('Ruta no encontrada.')));
  return router;
};
