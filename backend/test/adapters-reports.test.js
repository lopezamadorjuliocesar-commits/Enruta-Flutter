'use strict';
// Puntos 12 y 13: escenarios deterministas del PAC local, estado REAL de integraciones, indicadores desde la BD y bitácora con filtros/exportación.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, registerCompany, createUser } = require('./helpers');
const { setupField } = require('./field');

let app;
test.before(async () => { app = await startApp({ queueMaxAttempts: 2 }); });
test.after(async () => { await app.stop(); app.cleanup(); });

const IDS = ['A1B2C-1234-4234-8234-123456789AB', 'A1B2D-1234-4234-8234-123456789AB', 'A1B2E-1234-4234-8234-123456789AB', 'A1B2F-1234-4234-8234-123456789AB'];
const cp = (folio, i) => { const id = `CCC${IDS[i]}C`; return { folio, idCcp: id, data: { tipo: 'T' }, xml: `<?xml version="1.0"?><cfdi:Comprobante><cartaporte31:CartaPorte Version="3.1" IdCCP="${id}"/></cfdi:Comprobante>` }; };

test('PAC local determinista: éxito simulado, rechazo permanente, error y timeout con reintentos; nunca hay UUID fiscal', async () => {
  const admin = await registerCompany(app, { name: 'Pac SA' }); const a = admin.client; const docs = {};
  for (const [i, folio] of ['OK-1', 'REJ-1', 'ERR-1', 'TMO-1'].entries()) { const r = await a.post('/api/fiscal/carta-porte', cp(folio, i)); assert.equal(r.status, 202, r.text); docs[folio] = r.body.document.id; }
  await app.rt.queue.idle(); app.clock.advance(10 * 60_000); await app.rt.queue.recover?.(); await app.rt.queue.idle(); app.clock.advance(10 * 60_000); await app.rt.queue.idle();
  const get = async (f) => (await a.get(`/api/fiscal/carta-porte/${docs[f]}`)).body;
  const ok = await get('OK-1'); assert.deepEqual([ok.status, ok.simulated, ok.pac_uuid], ['Simulado', true, null]);
  const rej = await get('REJ-1'); assert.equal(rej.status, 'Error'); assert.match(rej.error_message, /rechaz/i); assert.equal(rej.attempts, 1, 'un rechazo no se reintenta');
  for (const f of ['ERR-1', 'TMO-1']) { const d = await get(f); assert.equal(d.status, 'Error', f); assert.equal(d.pac_uuid, null); assert.ok(d.attempts >= 1); }
  const jobs = (await a.get('/api/queue/jobs?type=CARTA_PORTE_STAMP')).body; assert.ok(jobs.some((j) => j.status === 'DEAD'), 'el rechazo pasó a DEAD sin reintentos');
});

test('/api/integrations: lo local es «Simulado», lo inexistente «No disponible» y nunca «Conectado» por un booleano', async () => {
  const admin = await registerCompany(app, { name: 'Integraciones SA' }); const list = (await admin.client.get('/api/integrations')).body; const by = Object.fromEntries(list.map((i) => [i.key, i]));
  assert.deepEqual([by.rfc.status, by.rfc.simulated, by.mail.status, by.pac.status], ['SIMULATED', true, 'SIMULATED', 'SIMULATED']); assert.match(by.pac.label, /Simulado \/ Desarrollo/);
  for (const k of ['sms', 'whatsapp', 'push', 'webhooks', 'erp', 'telemetry', 'cards', 'sso']) { assert.equal(by[k].status, 'UNAVAILABLE', k); assert.match(by[k].label, /No disponible/); }
  assert.ok(['EXTERNAL', 'NOT_CONFIGURED'].includes(by.mapbox.status)); assert.ok(list.every((i) => i.status !== 'CONNECTED'));
  const rep = await createUser(app, admin, { role: 'Repartidor', email: `r-${Date.now()}@int.mx` }); assert.equal((await rep.client.get('/api/integrations')).status, 403);
});

async function day(name, extra = {}) {
  const f = await setupField(app, { name }); const [agua] = f.products; const v1 = (await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/stops/${f.clients[0].id}/arrive`, f.here(0, extra.far ? 0.01 : 0))).body;
  if (extra.far) { const r = await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/stops/${f.clients[0].id}/arrive`, { ...f.here(0, 0.01), outsideReason: 'tráfico' }); assert.ok([200, 201].includes(r.status)); }
  const visit = extra.far ? (await f.call('GET', '/api/mobile/v1/routes')).body[0].stops[0].visit : v1;
  const del = await f.call('POST', `/api/mobile/v1/visits/${visit.id}/delivery`, { lines: [{ productId: agua.id, qtyPlanned: 4, qtyDelivered: 3, reason: 'faltó' }] }); assert.equal(del.status, 201, del.text);
  await f.call('POST', `/api/mobile/v1/visits/${visit.id}/payments`, { method: 'CASH', amountCents: 2000 }); await f.call('POST', `/api/mobile/v1/visits/${visit.id}/payments`, { method: 'TRANSFER', amountCents: 500, reference: 'SPEI-9999' });
  await f.call('POST', `/api/mobile/v1/visits/${visit.id}/close`, {});
  const v2 = (await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/stops/${f.clients[1].id}/arrive`, f.here(1))).body;
  await f.call('POST', `/api/mobile/v1/visits/${v2.id}/delivery`, { lines: [{ productId: agua.id, qtyPlanned: 2, qtyDelivered: 0, reason: 'cerrado' }], incidentReason: 'CLIENT_CLOSED' }); await f.call('POST', `/api/mobile/v1/visits/${v2.id}/close`, {});
  assert.equal((await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/finish`, {})).status, 200); return f;
}

test('indicadores desde la BD real: entregas, cumplimiento, tiempos, cobros, diferencias e incidencias, con filtros', async () => {
  const f = await day('Indicadores SA', { far: true }); const a = f.admin.client;
  const st = (await a.get('/api/settlements')).body[0]; await a.post(`/api/settlements/${st.id}/deposits`, { amount: 18 }, { headers: { 'Idempotency-Key': 'ind-deposit-1' } }); await a.post(`/api/settlements/${st.id}/submit`, {}, { headers: { 'Idempotency-Key': 'ind-submit-0001' } });
  const s = (await a.get('/api/reports/summary')).body;
  assert.deepEqual([s.visits.total, s.visits.closed, s.visits.outsideRadius, s.visits.outsideRadiusPct], [2, 2, 1, 50]);
  assert.deepEqual([s.deliveries.partial, s.deliveries.failed, s.deliveries.delivered, s.deliveries.compliancePct, s.deliveries.completionPct], [1, 1, 0, 0, 50]);
  assert.deepEqual([s.deliveries.unitsPlanned, s.deliveries.unitsDelivered, s.deliveries.fillRatePct, s.deliveries.salesCents], [6, 3, 50, 3000]);
  assert.deepEqual([s.payments.totalCents, s.payments.byMethod.CASH.cents, s.payments.byMethod.TRANSFER.cents], [2500, 2000, 500]);
  assert.deepEqual([s.settlements.expectedCents, s.settlements.depositedCents, s.settlements.diffCents, s.settlements.withDifference], [2000, 1800, -200, 1]);
  assert.deepEqual(s.incidents, [{ reason: 'CLIENT_CLOSED', label: 'Cliente cerrado', count: 1 }]); assert.equal(s.byRoute.length, 1); assert.equal(s.byRoute[0].collectedCents, 2500); assert.equal(s.byDay.length, 1); assert.equal(typeof s.visits.avgVisitMinutes, 'number');
  const none = (await a.get('/api/reports/summary?from=2020-01-01&to=2020-01-31')).body; assert.deepEqual([none.visits.total, none.payments.totalCents, none.deliveries.compliancePct], [0, 0, null], 'sin datos en el periodo: ceros, no inventados');
  const day0 = new Date(app.clock()).toISOString().slice(0, 10); assert.equal((await a.get(`/api/reports/summary?from=${day0}&to=${day0}`)).body.visits.total, 2);
  assert.equal((await a.get(`/api/reports/summary?routeId=${f.route.id}`)).body.visits.total, 2); assert.equal((await a.get(`/api/reports/summary?operatorId=${f.op.user.id}`)).body.visits.total, 2);
  assert.equal((await a.get('/api/reports/summary?operatorId=00000000-0000-4000-8000-000000000000')).body.visits.total, 0);
  assert.equal((await a.get(`/api/reports/summary?centerId=${f.admin.session.activeCenterId}`)).body.visits.total, 2); assert.equal((await a.get('/api/reports/summary?centerId=00000000-0000-4000-8000-000000000000')).status, 404);
  assert.equal((await a.get('/api/reports/summary?from=2026-12-01&to=2026-01-01')).status, 422); assert.equal((await a.get('/api/reports/summary?from=ayer')).status, 422);
  assert.equal((await f.op.client.get('/api/reports/summary')).status, 403, 'el repartidor no ve indicadores');
  const other = await registerCompany(app, { name: 'Otra SA' }); assert.equal((await other.client.get('/api/reports/summary')).body.visits.total, 0, 'aislamiento por empresa');
  const csv = await a.get('/api/reports/export.csv'); assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type'), /text\/csv/); assert.ok(csv.text.includes('Cobrado (MXN),25.00') && csv.text.includes('Diferencia (MXN),-2.00') && csv.text.includes('Incidencia: Cliente cerrado,1'), csv.text);
});

test('bitácora persistente: filtros por acción, entidad, texto y fechas, exportación CSV y cadena de hashes íntegra', async () => {
  const f = await day('Bitácora SA'); const a = f.admin.client;
  const act = (await a.get('/api/audit?action=delivery')).body; assert.ok(act.length >= 2 && act.every((e) => e.action.startsWith('delivery')));
  assert.ok((await a.get('/api/audit?entity=route')).body.every((e) => e.entity === 'route'));
  assert.ok((await a.get('/api/audit?q=settlement')).body.length >= 1); assert.equal((await a.get('/api/audit?q=zzz-no-existe')).body.length, 0);
  const day0 = new Date(app.clock()).toISOString().slice(0, 10); assert.ok((await a.get(`/api/audit?from=${day0}&to=${day0}`)).body.length > 5, 'el día final es inclusivo'); assert.equal((await a.get('/api/audit?from=2030-01-01')).body.length, 0);
  const csv = await a.get('/api/audit/export.csv?action=visit'); assert.equal(csv.status, 200); assert.ok(csv.text.replace(/^\uFEFF/, '').startsWith('Fecha,Actor,Acción') && csv.text.includes('visit.closed'));
  assert.equal((await a.get('/api/audit/verify')).body.ok, true); assert.equal((await f.op.client.get('/api/audit')).status, 403);
});
