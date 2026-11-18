'use strict';
// Escenario 10: posiciones GPS reales y simuladas; estados Real / Simulado / Desactualizado / Desconectado.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, createUser, openStream } = require('./helpers');
const { setupField } = require('./field');

let app;
test.before(async () => { app = await startApp(); });
test.after(async () => { await app.stop(); app.cleanup(); });

const pos = (f, i, over = {}) => ({ lat: f.coords[i][0], lng: f.coords[i][1], accuracy: 8, speed: 5, recordedAt: new Date(app.clock()).toISOString(), ...over });
const send = (f, positions) => f.call('POST', '/api/mobile/v1/positions', { routeId: f.route.id, positions }, { key: null });
const live = async (f) => (await f.admin.client.get('/api/tracking/live')).body;
const mine = (body, f) => body.vehicles.find((v) => v.routeId === f.route.id);

test('sin datos la ruta en ejecución figura DESCONECTADA (nunca «en vivo» sin posiciones)', async () => {
  const f = await setupField(app); const l = await live(f);
  assert.deepEqual([mine(l, f).status, mine(l, f).lat, mine(l, f).source], ['OFFLINE', null, null]); assert.deepEqual(l.thresholds, { staleSeconds: 120, offlineSeconds: 900 }); assert.equal(l.simulatorEnabled, true);
});

test('posiciones REALES: validación, descarte de basura, deduplicación y estados por antigüedad', async () => {
  const f = await setupField(app);
  const r = (await send(f, [pos(f, 0), pos(f, 0, { recordedAt: new Date(app.clock() - 10_000).toISOString() }), { lat: 999, lng: 0, recordedAt: new Date(app.clock()).toISOString() }, pos(f, 1, { accuracy: 900 }), pos(f, 1, { recordedAt: 'ayer' }), pos(f, 1, { recordedAt: new Date(app.clock() + 3_600_000).toISOString() })])).body;
  assert.deepEqual([r.accepted, r.discarded], [2, 4]);
  assert.deepEqual([(await send(f, [pos(f, 0)])).body.accepted, (await send(f, [pos(f, 0)])).body.duplicates], [0, 1], 'un reintento de red no duplica puntos');
  assert.equal((await send(f, [])).status, 422); assert.equal((await send(f, Array.from({ length: 101 }, () => pos(f, 0)))).status, 422);
  let v = mine(await live(f), f); assert.deepEqual([v.status, v.source, v.ageSeconds, v.lat], ['REAL', 'REAL', 0, f.coords[0][0]]);
  app.clock.advance(100_000); assert.equal(mine(await live(f), f).status, 'REAL'); app.clock.advance(30_000); v = mine(await live(f), f); assert.deepEqual([v.status, v.ageSeconds], ['STALE', 130], 'Desactualizado: pasó el umbral de 120 s');
  app.clock.advance(800_000); assert.equal(mine(await live(f), f).status, 'OFFLINE'); await send(f, [pos(f, 1)]); assert.equal(mine(await live(f), f).status, 'REAL', 'una posición nueva lo reactiva');
  const h = (await f.admin.client.get(`/api/tracking/routes/${f.route.id}/history`)).body.points; assert.ok(h.length >= 3 && h.every((p) => p.source === 'REAL')); assert.equal((await f.admin.client.get(`/api/tracking/routes/${f.route.id}/history?from=2999-01-01T00:00:00Z`)).body.points.length, 0);
});

test('solo el operador de una ruta EN EJECUCIÓN envía posiciones', async () => {
  const f = await setupField(app, { start: false }); assert.equal((await send(f, [pos(f, 0)])).body.code, 'ROUTE_NOT_STARTED');
  await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/start`, {}); const otro = await createUser(app, f.admin, { email: `gps-${Date.now()}@campo.mx`, role: 'Repartidor' });
  assert.equal((await f.call('POST', '/api/mobile/v1/positions', { routeId: f.route.id, positions: [pos(f, 0)] }, { as: otro.client })).status, 404); assert.equal((await send(f, [pos(f, 0)])).status, 200);
  const sinDisp = await f.op.client.post('/api/mobile/v1/positions', { routeId: f.route.id, positions: [pos(f, 0)] }); assert.equal(sinDisp.body.code, 'DEVICE_REQUIRED');
});

test('SIMULADOR explícito: posiciones SIMULATED recorren la ruta, se distinguen de las reales y no sobreviven a un reinicio', async () => {
  const f = await setupField(app); const url = `/api/routes/${f.route.id}/simulation`; const a = f.admin.client;
  assert.equal((await f.op.client.post(url, {})).status, 403, 'solo con simulator.run'); assert.equal((await a.post(url, { speedKmh: 500 })).body.code, 'SPEED_INVALID');
  const start = await a.post(url, { speedKmh: 60 }); assert.equal(start.status, 201); assert.equal(start.body.source, 'SIMULATED');
  let v = mine(await live(f), f); assert.deepEqual([v.status, v.source], ['SIMULATED', 'SIMULATED'], 'se rotula Ubicación simulada, no real'); assert.deepEqual((await live(f)).simulationsRunning, [f.route.id]);
  const first = { lat: v.lat, lng: v.lng }; app.clock.advance(5_000); await app.rt.services.tracking.tick(f.route.id); v = mine(await live(f), f); assert.ok(v.lat !== first.lat || v.lng !== first.lng, 'el vehículo avanza'); assert.ok(v.lat >= f.coords[0][0] && v.lat <= f.coords[1][0]);
  await send(f, [pos(f, 0, { recordedAt: new Date(app.clock() + 1000).toISOString() })]); assert.equal(mine(await live(f), f).source, 'REAL', 'la posición más reciente manda y conserva su origen');
  const h = (await a.get(`/api/tracking/routes/${f.route.id}/history`)).body.points; assert.ok(h.some((p) => p.source === 'SIMULATED') && h.some((p) => p.source === 'REAL'));
  for (let i = 0; i < 400; i++) { app.clock.advance(5000); if (!(await app.rt.services.tracking.tick(f.route.id))) break; }
  assert.deepEqual((await live(f)).simulationsRunning, [], 'al llegar al final la simulación termina'); assert.equal(app.rt.store.conn.prepare('SELECT status FROM simulations WHERE route_id=?').get(f.route.id).status, 'DONE');
  await a.post(url, {}); assert.equal((await a.delete(url)).body.status, 'STOPPED'); assert.deepEqual((await live(f)).simulationsRunning, []);
  await a.post(url, {}); await app.rt.services.tracking.resetSimulations(); assert.equal(app.rt.store.conn.prepare('SELECT status FROM simulations WHERE route_id=?').get(f.route.id).status, 'STOPPED', 'al arrancar, ninguna simulación queda activa');
  assert.ok((await a.get('/api/audit?action=simulation.')).body.length >= 3);
});

test('el simulador exige ruta en ejecución con 2+ paradas ubicadas y puede desactivarse', async () => {
  const f = await setupField(app, { start: false }); assert.equal((await f.admin.client.post(`/api/routes/${f.route.id}/simulation`, {})).body.code, 'ROUTE_NOT_STARTED');
  const one = await setupField(app, { stops: 1 }); assert.equal((await one.admin.client.post(`/api/routes/${one.route.id}/simulation`, {})).body.code, 'PATH_TOO_SHORT');
  const off = await startApp({ simulatorEnabled: false }); const g = await setupField(off); assert.equal((await g.admin.client.post(`/api/routes/${g.route.id}/simulation`, {})).body.code, 'SIMULATOR_DISABLED'); assert.equal((await live(g)).simulatorEnabled, false); await off.stop(); off.cleanup();
});

test('eventos en vivo y aislamiento por empresa/centro/permiso', async () => {
  const f = await setupField(app); const s = await openStream(app, f.admin.client); await send(f, [pos(f, 0)]);
  const ev = await s.waitFor('position'); assert.deepEqual([ev.routeId, ev.source], [f.route.id, 'REAL']); s.close();
  const other = await setupField(app, { name: 'Ajena GPS SA' }); assert.equal(mine(await live(other), f), undefined, 'otra empresa no ve vehículos ajenos'); assert.equal((await other.admin.client.get(`/api/tracking/routes/${f.route.id}/history`)).status, 404);
  assert.equal((await f.op.client.get('/api/tracking/live')).status, 403);
  const norte = (await f.admin.client.post('/api/centers', { name: 'Norte' })).body; await f.admin.client.put('/api/session/center', { centerId: norte.id }); assert.equal(mine(await live(f), f), undefined, 'otro centro no ve la ruta'); await f.admin.client.put('/api/session/center', { centerId: f.admin.session.activeCenterId });
});
