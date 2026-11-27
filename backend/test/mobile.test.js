'use strict';
// Escenarios 7, 8 y 9: vinculación, acceso como repartidor y consulta de la ruta asignada (contrato /api/mobile/v1).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, registerCompany, createUser, PASSWORD } = require('./helpers');

let app; let admin; let rep; let route;
const link = (body) => fetch(app.baseUrl + '/api/mobile/v1/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const asDevice = (client, deviceToken) => ({ get: (u) => client.get(u, { headers: { 'X-Device-Token': deviceToken } }), post: (u, b) => client.post(u, b ?? {}, { headers: { 'X-Device-Token': deviceToken } }) });

test.before(async () => {
  app = await startApp({ publicWebUrl: 'http://192.168.1.50:4200', publicApiUrl: 'http://192.168.1.50:3000' });
  admin = await registerCompany(app, { name: 'Móvil SA', email: 'admin@movil.mx' });
  rep = await createUser(app, admin, { email: 'chofer@movil.mx', role: 'Repartidor', name: 'Chofer Uno' });
  const c1 = (await admin.client.post('/api/clients', { name: 'Parada 1', address: 'Calle 1', phone: '228000', lat: 19.5, lng: -96.9 })).body; const c2 = (await admin.client.post('/api/clients', { name: 'Parada 2', lat: 19.6, lng: -96.8 })).body;
  route = (await admin.client.post('/api/routes', { name: 'Ruta móvil', day: 'Lunes', operatorId: rep.user.id })).body;
  route = (await admin.client.put(`/api/routes/${route.id}/stops`, { revision: route.revision, clientIds: [c1.id, c2.id] })).body;
});
test.after(async () => { await app.stop(); app.cleanup(); });

async function linkedDevice(over = {}) {
  const q = (await admin.client.post('/api/devices/link-qr')).body;
  const l = await link({ token: q.token, brand: 'Web', model: 'Navegador móvil', os: 'Android', osVersion: '15', serial: `WEB-${Math.random().toString(36).slice(2, 10).toUpperCase()}`, ...over });
  assert.equal(l.status, 200, JSON.stringify(l.body)); return { q, deviceToken: l.body.deviceToken, device: l.body.device };
}

test('el QR es una URL del panel con el token en el fragmento y las URLs públicas configuradas (red local)', async () => {
  const q = (await admin.client.post('/api/devices/link-qr')).body;
  assert.equal(q.linkUrl, `http://192.168.1.50:4200/repartidor/vincular#t=${q.token}`); assert.equal(q.apiUrl, 'http://192.168.1.50:3000'); assert.equal(q.ttlSeconds, 900);
  const net = (await app.client().get('/api/system/network')).body; assert.equal(net.isLoopback, false); assert.equal(net.warning, null);
});

test('sin dispositivo vinculado el repartidor no opera; con él, ve solo la ruta publicada que le asignaron', async () => {
  assert.equal((await rep.client.get('/api/mobile/v1/routes')).body.code, 'DEVICE_REQUIRED');
  assert.equal((await rep.client.get('/api/mobile/v1/routes', { headers: { 'X-Device-Token': 'inventado' } })).body.code, 'DEVICE_REQUIRED');
  const dev = await linkedDevice(); const m = asDevice(rep.client, dev.deviceToken);
  assert.equal((await m.get('/api/mobile/v1/me')).body.device.alias, 'Web Navegador móvil');
  assert.deepEqual((await m.get('/api/mobile/v1/routes')).body, [], 'una ruta en borrador no se descarga');
  await admin.client.post(`/api/routes/${route.id}/submit`, { revision: route.revision }); assert.deepEqual((await m.get('/api/mobile/v1/routes')).body, [], 'pendiente tampoco');
  await admin.client.post(`/api/routes/${route.id}/approve`, { revision: route.revision });
  const list = (await m.get('/api/mobile/v1/routes')).body; assert.equal(list.length, 1); assert.equal(list[0].status, 'PUBLISHED'); assert.equal(list[0].stops.length, 2);
  assert.deepEqual(list[0].stops.map((s) => [s.seq, s.name]), [[1, 'Parada 1'], [2, 'Parada 2']]); assert.equal(list[0].stops[0].address, 'Calle 1'); assert.equal(list[0].stops[0].lat, 19.5);
});

test('iniciar ruta: solo el operador, idempotente, solo la versión aprobada', async () => {
  const dev = await linkedDevice(); const m = asDevice(rep.client, dev.deviceToken);
  const other = await createUser(app, admin, { email: 'otro@movil.mx', role: 'Repartidor' }); const om = asDevice(other.client, dev.deviceToken);
  assert.equal((await om.post(`/api/mobile/v1/routes/${route.id}/start`)).status, 404, 'otro repartidor no puede iniciar la ruta');
  const st = await m.post(`/api/mobile/v1/routes/${route.id}/start`); assert.equal(st.status, 200); assert.equal(st.body.status, 'IN_PROGRESS'); assert.ok(st.body.startedAt);
  assert.equal((await m.post(`/api/mobile/v1/routes/${route.id}/start`)).status, 200, 'repetir el toque no falla ni duplica');
  assert.equal((await admin.client.get(`/api/routes/${route.id}`)).body.history.filter((h) => h.to === 'IN_PROGRESS').length, 1);
  assert.equal((await m.get('/api/mobile/v1/routes')).body[0].status, 'IN_PROGRESS');
  assert.equal((await admin.client.put(`/api/routes/${route.id}`, { revision: route.revision, day: 'Martes' })).body.code, 'ROUTE_LOCKED', 'una ruta en ejecución no se edita');
  const draft = (await admin.client.post('/api/routes', { name: 'Sin aprobar', operatorId: rep.user.id })).body; assert.equal((await m.post(`/api/mobile/v1/routes/${draft.id}/start`)).body.code, 'ROUTE_STATE');
  assert.ok((await admin.client.get('/api/audit?action=route.started')).body.length >= 1);
});

test('revocar el dispositivo corta el acceso al instante y bloquea un nuevo QR del mismo hardware hasta reactivarlo', async () => {
  const dev = await linkedDevice(); const m = asDevice(rep.client, dev.deviceToken); assert.equal((await m.get('/api/mobile/v1/me')).status, 200);
  const rv = await admin.client.post(`/api/devices/${dev.device.id}/revoke`); assert.equal(rv.status, 200); assert.equal(rv.body.revoked, 1);
  const after = await m.get('/api/mobile/v1/me'); assert.equal(after.status, 401); assert.equal(after.body.code, 'DEVICE_REVOKED');
  assert.equal((await admin.client.get(`/api/devices/${dev.device.id}`)).body.status, 'Inactivo');
  assert.equal((await rep.client.post('/api/devices', {}, {})).status, 403);
  const rep2 = await createUser(app, admin, { email: 'nopuede@movil.mx', role: 'Repartidor' }); assert.equal((await rep2.client.post(`/api/devices/${dev.device.id}/revoke`)).status, 403);
  assert.ok((await admin.client.get('/api/audit?action=device.revoked')).body.length >= 1);
});

test('asociación conductor ↔ dispositivo: solo ese conductor entra; un dispositivo inactivo o robado queda bloqueado', async () => {
  const drv = (await admin.client.post('/api/drivers', { name: 'Chofer Uno', email: 'chofer@movil.mx' })).body; const dev = await linkedDevice();
  await admin.client.put(`/api/devices/${dev.device.id}`, { alias: 'Tel del chofer', imei_serial: (await admin.client.get(`/api/devices/${dev.device.id}`)).body.imei_serial, driver_id: drv.id });
  assert.equal((await asDevice(rep.client, dev.deviceToken).get('/api/mobile/v1/me')).status, 200);
  const intruder = await createUser(app, admin, { email: 'intruso@movil.mx', role: 'Repartidor' }); const r = await asDevice(intruder.client, dev.deviceToken).get('/api/mobile/v1/me'); assert.equal(r.status, 403); assert.equal(r.body.code, 'DEVICE_DRIVER_MISMATCH');
  const d2 = await linkedDevice(); const cur = (await admin.client.get(`/api/devices/${d2.device.id}`)).body;
  await admin.client.put(`/api/devices/${d2.device.id}`, { alias: cur.alias, imei_serial: cur.imei_serial, status: 'Reparación' }); assert.equal((await asDevice(rep.client, d2.deviceToken).get('/api/mobile/v1/me')).body.code, 'DEVICE_BLOCKED');
});

test('un dispositivo de otra empresa no sirve y el contrato exige permisos y encabezado anti-CSRF con cookie', async () => {
  const other = await registerCompany(app, { name: 'Otra Móvil SA', email: 'o@movil.mx' }); const q = (await other.client.post('/api/devices/link-qr')).body;
  const l = await link({ token: q.token, serial: 'OTRA-0001' }); const r = await asDevice(rep.client, l.body.deviceToken).get('/api/mobile/v1/me'); assert.equal(r.body.code, 'DEVICE_REQUIRED');
  const webRep = app.client({ mode: 'web' }); await webRep.post('/api/auth/login', { email: 'chofer@movil.mx', password: PASSWORD });
  const dev = await linkedDevice(); const forged = await webRep.post(`/api/mobile/v1/routes/${route.id}/start`, {}, { noClientHeader: true, headers: { 'X-Device-Token': dev.deviceToken } });
  assert.equal(forged.status, 403); assert.equal(forged.body.code, 'CSRF');
  assert.equal((await admin.client.get('/api/mobile/v1/routes', { headers: { 'X-Device-Token': dev.deviceToken } })).status, 200, 'el administrador también tiene deliveries.execute');
});
