'use strict';
// Escenario 3: bloqueo inmediato de un usuario que pasa a inactivo.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, registerCompany, createUser, PASSWORD } = require('./helpers');

let app; let admin;
test.before(async () => { app = await startApp(); admin = await registerCompany(app, { name: 'Inactivos SA', email: 'admin@inactivos.mx' }); });
test.after(async () => { await app.stop(); app.cleanup(); });

test('al inactivar, TODAS las sesiones del usuario caen de inmediato (varios navegadores) y no puede volver a entrar', async () => {
  const u = await createUser(app, admin, { email: 'baja@inactivos.mx', mode: 'web' });
  const second = app.client({ mode: 'web' }); await second.post('/api/auth/login', { email: 'baja@inactivos.mx', password: PASSWORD });
  assert.equal((await u.client.get('/api/clients')).status, 200); assert.equal((await second.get('/api/session')).status, 200);

  const off = await admin.client.patch(`/api/users/${u.user.id}/status`, { status: 'INACTIVE' }); assert.equal(off.status, 200); assert.equal(off.body.sessionsRevoked, 2);
  for (const c of [u.client, second]) { const r = await c.get('/api/clients'); assert.equal(r.status, 401); assert.equal(r.body.code, 'USER_INACTIVE'); }
  const relog = await app.client().post('/api/auth/login', { email: 'baja@inactivos.mx', password: PASSWORD }); assert.equal(relog.status, 401);
  assert.equal((await app.client().post('/api/auth/forgot-password', { email: 'baja@inactivos.mx' })).status, 200);
  await app.rt.queue.idle(); assert.equal((await app.client().get('/api/dev/mailbox?to=baja@inactivos.mx')).body.messages.length, 0, 'un usuario inactivo no recibe enlace de recuperación');

  assert.equal((await admin.client.patch(`/api/users/${u.user.id}/status`, { status: 'ACTIVE' })).status, 200);
  assert.equal((await app.client().post('/api/auth/login', { email: 'baja@inactivos.mx', password: PASSWORD })).status, 200);
  const acts = (await admin.client.get('/api/audit?action=user.')).body.map((e) => e.action); assert.ok(acts.includes('user.deactivated') && acts.includes('user.activated'));
});

test('un usuario sin permiso no puede cambiar estados y no puede desactivarse a sí mismo', async () => {
  const sup = await createUser(app, admin, { email: 'sup@inactivos.mx', role: 'Supervisor' });
  const rep = await createUser(app, admin, { email: 'rep@inactivos.mx', role: 'Repartidor' });
  assert.equal((await sup.client.patch(`/api/users/${rep.user.id}/status`, { status: 'INACTIVE' })).status, 403);
  assert.equal((await rep.client.get('/api/users')).status, 403);
  const me = (await admin.client.get('/api/session')).body.user.id;
  const r = await admin.client.patch(`/api/users/${me}/status`, { status: 'INACTIVE' }); assert.equal(r.status, 409); assert.equal(r.body.code, 'SELF_DEACTIVATE');
  assert.equal((await admin.client.patch(`/api/users/${rep.user.id}/status`, { status: 'LOQUESEA' })).status, 422);
  assert.equal((await rep.client.get('/api/session')).status, 200);
});

test('no se puede dejar la empresa sin administradores activos', async () => {
  const sec = await createUser(app, admin, { email: 'segundo@inactivos.mx', role: 'Administrador' });
  assert.equal((await sec.client.patch(`/api/users/${sec.user.id}/status`, { status: 'INACTIVE' })).status, 409);    // es él mismo
  assert.equal((await admin.client.patch(`/api/users/${sec.user.id}/status`, { status: 'INACTIVE' })).status, 200);   // queda 1 admin
  const roles = (await admin.client.get('/api/roles')).body; const supRole = roles.find((r) => r.name === 'Supervisor');
  const me = (await admin.client.get('/api/session')).body.user.id;
  const r = await admin.client.put(`/api/users/${me}`, { roleId: supRole.id }); assert.equal(r.status, 409); assert.equal(r.body.code, 'LAST_ADMIN');
  assert.equal((await admin.client.get('/api/users')).body.find((u) => u.id === me).role, 'Administrador', 'el rollback conservó el rol');
});

test('cambiar el rol o la contraseña desde administración cierra las sesiones del usuario afectado', async () => {
  const u = await createUser(app, admin, { email: 'rol@inactivos.mx' }); const roles = (await admin.client.get('/api/roles')).body;
  assert.equal((await admin.client.put(`/api/users/${u.user.id}`, { roleId: roles.find((r) => r.name === 'Supervisor').id })).status, 200);
  assert.equal((await u.client.get('/api/session')).status, 401);
  const l = await app.client().post('/api/auth/login', { email: 'rol@inactivos.mx', password: PASSWORD }); assert.equal(l.body.session.user.role, 'Supervisor');
});
