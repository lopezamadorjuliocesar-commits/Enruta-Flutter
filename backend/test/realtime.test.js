'use strict';
// Confirmación en tiempo real (SSE): QR vinculado, revocación, rutas y cierres de sesión.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, registerCompany, createUser, openStream, PASSWORD } = require('./helpers');

let app; let admin;
test.before(async () => { app = await startApp(); admin = await registerCompany(app, { name: 'Vivo SA', email: 'admin@vivo.mx' }); });
test.after(async () => { app.rt.bus.closeAll(); await app.stop(); app.cleanup(); });
const link = (body) => fetch(app.baseUrl + '/api/mobile/v1/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

test('el panel recibe la confirmación del QR en el instante en que el móvil lo escanea', async () => {
  const s = await openStream(app, admin.client); assert.equal(s.status, 200);
  const q = (await admin.client.post('/api/devices/link-qr')).body; await link({ token: q.token, model: 'Pixel', serial: 'RT-DEVICE-01' });
  const ev = await s.waitFor('device.linked', (e) => e.jti === q.jti); assert.equal(ev.alias, 'Pixel');
  const dev = (await admin.client.get('/api/devices')).body.find((d) => d.imei_serial === 'RT-DEVICE-01'); await admin.client.post(`/api/devices/${dev.id}/revoke`);
  assert.equal((await s.waitFor('device.revoked')).deviceId, dev.id); s.close();
});

test('requiere sesión y no mezcla empresas', async () => {
  const anon = await fetch(app.baseUrl + '/api/events'); assert.equal(anon.status, 401); await anon.body.cancel();
  const other = await registerCompany(app, { name: 'Otra Vivo SA', email: 'o@vivo.mx' }); const mine = await openStream(app, admin.client); const theirs = await openStream(app, other.client);
  const q = (await admin.client.post('/api/devices/link-qr')).body; await link({ token: q.token, serial: 'RT-DEVICE-02' }); await mine.waitFor('device.linked');
  await theirs.quiet(); assert.equal(theirs.events.length, 0, 'otra empresa no recibe nada'); mine.close(); theirs.close();
});

test('los cambios de rutas llegan solo a quienes ven ese centro', async () => {
  const norte = (await admin.client.post('/api/centers', { name: 'Norte' })).body; const matriz = admin.session.activeCenterId;
  const sup = await createUser(app, admin, { email: 'sup@vivo.mx', role: 'Supervisor', centerIds: [norte.id] });
  const s = await openStream(app, sup.client); const a = await openStream(app, admin.client);
  await admin.client.post('/api/routes', { name: 'Ruta de Matriz' });                          // centro Matriz: el supervisor (solo Norte) no la ve
  await a.waitFor('route.updated'); await s.quiet(); assert.equal(s.events.filter((e) => e.type === 'route.updated').length, 0);
  await admin.client.put('/api/session/center', { centerId: norte.id }); const r = (await admin.client.post('/api/routes', { name: 'Ruta de Norte' })).body;
  const ev = await s.waitFor('route.updated', (e) => e.routeId === r.id); assert.equal(ev.status, 'DRAFT'); assert.equal(ev.what, 'created'); await admin.client.put('/api/session/center', { centerId: matriz }); s.close(); a.close();
});

test('el operador recibe aviso de su ruta asignada y de su cancelación', async () => {
  const rep = await createUser(app, admin, { email: 'rep@vivo.mx', role: 'Repartidor' }); const s = await openStream(app, rep.client);
  const c = (await admin.client.post('/api/clients', { name: 'Cliente RT', lat: 19, lng: -96 })).body; let r = (await admin.client.post('/api/routes', { name: 'Ruta RT', operatorId: rep.user.id })).body;
  r = (await admin.client.put(`/api/routes/${r.id}/stops`, { revision: r.revision, clientIds: [c.id] })).body; await admin.client.post(`/api/routes/${r.id}/submit`, { revision: r.revision }); await admin.client.post(`/api/routes/${r.id}/approve`, { revision: r.revision });
  assert.equal((await s.waitFor('route.assigned')).routeId, r.id); await admin.client.post(`/api/routes/${r.id}/cancel`); assert.equal((await s.waitFor('route.cancelled')).routeId, r.id); s.close();
});

test('al inactivar un usuario sus navegadores reciben session.revoked y la sesión ya no sirve', async () => {
  const u = await createUser(app, admin, { email: 'baja@vivo.mx', role: 'Repartidor' }); const s = await openStream(app, u.client);
  await admin.client.patch(`/api/users/${u.user.id}/status`, { status: 'INACTIVE' });
  assert.equal((await s.waitFor('session.revoked')).reason, 'USER_INACTIVE'); assert.equal((await u.client.get('/api/session')).body.code, 'USER_INACTIVE'); s.close();
  const v = await createUser(app, admin, { email: 'pwd@vivo.mx', role: 'Repartidor' }); const s2 = await openStream(app, v.client);
  await app.client().post('/api/auth/forgot-password', { email: 'pwd@vivo.mx' }); await app.rt.queue.idle();
  const token = new URL((await app.client().get('/api/dev/mailbox?to=pwd@vivo.mx')).body.messages[0].text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
  await app.client().post('/api/auth/reset-password', { token, newPassword: 'Otra-Clave-789' }); assert.equal((await s2.waitFor('session.revoked')).reason, 'PASSWORD_RESET'); s2.close();
});

test('los streams no cuentan como actividad y se liberan al cerrar', async () => {
  await new Promise((r) => setTimeout(r, 300)); const before = app.rt.bus.count(); const s = await openStream(app, admin.client); assert.equal(app.rt.bus.count(), before + 1); s.close(); await new Promise((r) => setTimeout(r, 150)); assert.equal(app.rt.bus.count(), before);
});
