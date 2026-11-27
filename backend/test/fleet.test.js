'use strict';
// Dispositivos, conductores, vehículos y vinculación por QR (comportamiento heredado, ahora con sesión y aislamiento).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, registerCompany, createUser } = require('./helpers');
const { sha256 } = require('../src/utils/ids');

let app; let admin;
test.before(async () => { app = await startApp(); admin = await registerCompany(app, { name: 'Flota SA', email: 'admin@flota.mx' }); });
test.after(async () => { await app.stop(); app.cleanup(); });
const link = (body) => fetch(app.baseUrl + '/api/mobile/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));   // sin cookies ni X-EnRuta-Client, como la app móvil

test('CRUD de conductores, vehículos y dispositivos con unicidad y referencias', async () => {
  const c = admin.client;
  const drv = (await c.post('/api/drivers', { name: 'Chofer Uno', email: 'c1@flota.mx' })).body; const veh = (await c.post('/api/vehicles', { plate: 'abc-123', description: 'Camioneta' })).body;
  assert.equal(veh.plate, 'ABC-123'); assert.equal((await c.post('/api/vehicles', { plate: 'ABC-123' })).body.code, 'DUPLICATE_PLATE');
  assert.equal((await c.post('/api/drivers', { name: 'Otro', email: 'C1@flota.mx' })).status, 409);
  assert.equal((await c.post('/api/devices', { alias: '', imei_serial: '123' })).status, 422); assert.equal((await c.post('/api/devices', { alias: 'X', imei_serial: '12' })).status, 422);
  const dev = await c.post('/api/devices', { alias: 'Tel 1', imei_serial: '356938035643809', brand: 'Samsung', driver_id: drv.id, vehicle_id: veh.id }); assert.equal(dev.status, 201);
  assert.equal(dev.body.driver_name, 'Chofer Uno'); assert.equal(dev.body.vehicle_plate, 'ABC-123'); assert.equal(dev.body.status, 'Activo');
  assert.equal((await c.post('/api/devices', { alias: 'Dup', imei_serial: '356938035643809' })).body.code, 'DUPLICATE_IMEI');
  assert.equal((await c.post('/api/devices', { alias: 'Mismo chofer', imei_serial: 'SERIE-0001', driver_id: drv.id })).body.code, 'DRIVER_TAKEN');
  assert.equal((await c.post('/api/devices', { alias: 'Mismo vehículo', imei_serial: 'SERIE-0002', vehicle_id: veh.id })).body.code, 'VEHICLE_TAKEN');
  assert.equal((await c.post('/api/devices', { alias: 'Ref', imei_serial: 'SERIE-0003', driver_id: '00000000-0000-4000-8000-000000000000' })).body.code, 'REFERENCE_INVALID');
  const upd = await c.put(`/api/devices/${dev.body.id}`, { alias: 'Tel 1b', imei_serial: '356938035643809', status: 'Reparación' }); assert.equal(upd.body.status, 'Reparación'); assert.equal(upd.body.driver_id, null);
  assert.equal((await c.delete(`/api/devices/${dev.body.id}`)).status, 204); assert.equal((await c.get(`/api/devices/${dev.body.id}`)).status, 404);
  const sync = (await c.post('/api/drivers/sync', { drivers: [{ name: 'Chofer Uno B', email: 'c1@flota.mx' }, { name: 'Chofer Dos', email: 'c2@flota.mx' }, { name: 'Sin correo' }] })).body; assert.deepEqual(sync.map((d) => d.name).sort(), ['Chofer Dos', 'Chofer Uno B']);
});

test('solo con devices.manage y aislado por empresa', async () => {
  const rep = await createUser(app, admin, { email: 'rep@flota.mx', role: 'Repartidor' }); for (const url of ['/api/devices', '/api/drivers', '/api/vehicles']) assert.equal((await rep.client.get(url)).status, 403);
  const other = await registerCompany(app, { name: 'Flota Dos SA', email: 'dos@flota.mx' }); const d = (await admin.client.post('/api/devices', { alias: 'Privado', imei_serial: 'PRIV-0001' })).body;
  assert.equal((await other.client.get(`/api/devices/${d.id}`)).status, 404); assert.deepEqual((await other.client.get('/api/devices')).body, []);
  assert.equal((await other.client.post(`/api/devices/${d.id}/link-token`)).status, 404); assert.equal((await other.client.post('/api/devices', { alias: 'Mismo IMEI', imei_serial: 'PRIV-0001' })).status, 201, 'el IMEI solo es único por empresa');
});

test('QR para un dispositivo registrado: un solo uso, invalida el anterior y entrega la credencial del dispositivo', async () => {
  const d = (await admin.client.post('/api/devices', { alias: 'Con QR', imei_serial: 'QR-DEVICE-1' })).body;
  const q1 = (await admin.client.post(`/api/devices/${d.id}/link-token`)).body; const q2 = (await admin.client.post(`/api/devices/${d.id}/link-token`)).body;
  assert.equal(q2.ttlSeconds, 900); assert.equal(q2.apiUrl, 'http://localhost:3000');
  const stale = await link({ token: q1.token }); assert.equal(stale.status, 410);
  const ok = await link({ token: q2.token, model: 'Pixel 8', os: 'Android', osVersion: '15', fcmToken: 'fcm-1' }); assert.equal(ok.status, 200); assert.equal(ok.body.device.alias, 'Con QR'); assert.ok(ok.body.deviceToken);
  assert.equal((await link({ token: q2.token })).status, 410, 'segundo uso');
  const now = (await admin.client.get(`/api/devices/${d.id}`)).body; assert.equal(now.reported_model, 'Pixel 8'); assert.ok(now.linked_at);
  assert.ok(app.rt.store.conn.prepare('SELECT 1 FROM device_sessions WHERE token_hash=?').get(sha256(ok.body.deviceToken))); assert.equal(app.rt.store.conn.prepare('SELECT 1 FROM device_sessions WHERE token_hash=?').get(ok.body.deviceToken), undefined);
  assert.equal((await link({ token: 'inventado' })).status, 401); assert.equal((await link({})).status, 400);
});

test('QR genérico: el dispositivo se crea al escanear y el panel lo ve como vinculado', async () => {
  const q = (await admin.client.post('/api/devices/link-qr')).body; assert.equal((await admin.client.get(`/api/devices/link-qr/${q.jti}`)).body.status, 'pending');
  const ok = await link({ token: q.token, brand: 'Samsung', model: 'Samsung Galaxy A54', os: 'Android', osVersion: '14', serial: 'RZ8T1ABCDE' }); assert.equal(ok.status, 200);
  const st = (await admin.client.get(`/api/devices/link-qr/${q.jti}`)).body; assert.equal(st.status, 'linked'); assert.equal(st.device.imei_serial, 'RZ8T1ABCDE'); assert.equal(st.device.alias, 'Samsung Galaxy A54');
  assert.equal((await admin.client.get('/api/devices')).body.filter((x) => x.imei_serial === 'RZ8T1ABCDE').length, 1);
  const again = (await admin.client.post('/api/devices/link-qr')).body; await link({ token: again.token, serial: 'RZ8T1ABCDE', model: 'Otro' });
  assert.equal((await admin.client.get('/api/devices')).body.filter((x) => x.imei_serial === 'RZ8T1ABCDE').length, 1, 'el mismo hardware no se duplica');
  const nodata = (await admin.client.post('/api/devices/link-qr')).body; await link({ token: nodata.token }); assert.ok((await admin.client.get('/api/devices')).body.some((x) => /^MOB-/.test(x.imei_serial)));
});

test('QR caducado y dispositivo robado', async () => {
  const q = (await admin.client.post('/api/devices/link-qr')).body; app.clock.advance(16 * 60_000);
  assert.equal((await link({ token: q.token })).status, 410); assert.equal((await admin.client.get(`/api/devices/link-qr/${q.jti}`)).body.status, 'expired');
  const d = (await admin.client.post('/api/devices', { alias: 'Robado', imei_serial: 'STOLEN-001', status: 'Robado' })).body;
  const r = await admin.client.post(`/api/devices/${d.id}/link-token`); assert.equal(r.status, 403); assert.equal(r.body.code, 'DEVICE_STOLEN');
  const ok = (await admin.client.post('/api/devices', { alias: 'Luego robado', imei_serial: 'STOLEN-002' })).body; const tok = (await admin.client.post(`/api/devices/${ok.id}/link-token`)).body;
  await admin.client.put(`/api/devices/${ok.id}`, { alias: 'Luego robado', imei_serial: 'STOLEN-002', status: 'Robado' }); assert.equal((await link({ token: tok.token })).status, 403);
});

test('el panel de red advierte cuando las URLs públicas apuntan a localhost', async () => {
  const n = (await app.client().get('/api/system/network')).body; assert.equal(n.isLoopback, true); assert.match(n.warning, /localhost/);
  const lan = await startApp({ publicWebUrl: 'http://192.168.1.50:4200', publicApiUrl: 'http://192.168.1.50:3000' });
  const m = (await lan.client().get('/api/system/network')).body; assert.equal(m.isLoopback, false); assert.equal(m.warning, null); await lan.stop(); lan.cleanup();
});
