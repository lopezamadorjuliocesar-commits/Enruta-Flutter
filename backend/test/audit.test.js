'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, registerCompany, createUser } = require('./helpers');

let app; let admin;
test.before(async () => { app = await startApp(); admin = await registerCompany(app, { name: 'Bitácora SA', email: 'admin@bitacora.mx' }); });
test.after(async () => { await app.stop(); app.cleanup(); });

test('las acciones relevantes quedan en la bitácora persistente con actor, entidad y hora del servidor', async () => {
  const u = await createUser(app, admin, { email: 'u@bitacora.mx' });
  await u.client.post('/api/auth/logout'); await admin.client.post('/api/clients', { name: 'Cliente Bitácora' });
  const log = (await admin.client.get('/api/audit')).body; const actions = log.map((e) => e.action);
  for (const a of ['company.registered', 'auth.login', 'user.created', 'auth.logout', 'client.created']) assert.ok(actions.includes(a), a);
  const created = log.find((e) => e.action === 'user.created'); assert.equal(created.actor, 'Admin Prueba'); assert.equal(created.entity, 'user'); assert.equal(created.entityId, u.user.id); assert.equal(created.detail.email, 'u@bitacora.mx');
  assert.equal(created.at, new Date(app.clock()).toISOString()); assert.ok(log[0].id > log[log.length - 1].id, 'más reciente primero');
});

test('filtros por acción, actor y rango; paginación', async () => {
  const me = (await admin.client.get('/api/session')).body.user.id;
  assert.ok((await admin.client.get('/api/audit?action=client.')).body.every((e) => e.action.startsWith('client.')));
  assert.ok((await admin.client.get(`/api/audit?actorId=${me}`)).body.every((e) => e.actorId === me));
  assert.equal((await admin.client.get('/api/audit?from=2999-01-01T00:00:00Z')).body.length, 0);
  assert.equal((await admin.client.get('/api/audit?limit=2')).body.length, 2);
  const p2 = (await admin.client.get('/api/audit?limit=2&offset=2')).body; const p1 = (await admin.client.get('/api/audit?limit=2')).body; assert.ok(p2[0].id < p1[1].id);
});

test('es de solo agregar (triggers) y la cadena de hashes detecta manipulación', async () => {
  const conn = app.rt.store.conn;
  assert.throws(() => conn.prepare("UPDATE audit_log SET action='x'").run(), /solo agregar/); assert.throws(() => conn.prepare('DELETE FROM audit_log').run(), /solo agregar/);
  assert.deepEqual((await admin.client.get('/api/audit/verify')).body, { ok: true });
  conn.exec('DROP TRIGGER audit_log_no_update');                                  // un atacante con acceso a la BD…
  conn.prepare("UPDATE audit_log SET actor_name='Otro' WHERE id=(SELECT MIN(id) FROM audit_log WHERE company_id=?)").run(admin.company.id);
  const v = (await admin.client.get('/api/audit/verify')).body; assert.equal(v.ok, false); assert.ok(v.brokenAt > 0);   // …queda en evidencia
});

test('la bitácora y las notificaciones pertenecen a su empresa', async () => {
  const other = await registerCompany(app, { name: 'Otra Bitácora SA', email: 'o@bitacora.mx' });
  assert.ok((await other.client.get('/api/audit')).body.every((e) => e.actor !== 'Cliente Bitácora' && e.entity !== 'client'));
  assert.deepEqual((await other.client.get('/api/notifications')).body, []);
});

test('notificaciones: filtro por categoría y marcar como leída', async () => {
  for (let i = 0; i < 5; i++) await app.client().post('/api/auth/login', { email: 'admin@bitacora.mx', password: 'Incorrecta-123' });
  const all = (await admin.client.get('/api/notifications')).body; assert.ok(all.length >= 1);
  assert.ok((await admin.client.get('/api/notifications?category=Críticas')).body.length >= 1); assert.equal((await admin.client.get('/api/notifications?category=Sistema')).body.length, 0);
  assert.equal((await admin.client.patch(`/api/notifications/${all[0].id}/read`)).body.updated, 1);
  assert.equal((await admin.client.get('/api/notifications')).body.find((n) => n.id === all[0].id).read, true);
});
