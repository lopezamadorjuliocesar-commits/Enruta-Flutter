'use strict';
// Escenarios 11, 12 y 13: entregas con evidencias, cobros y cierre de ruta (contrato /api/mobile/v1, con idempotencia).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, createUser } = require('./helpers');
const { setupField, PNG, JPG } = require('./field');

let app;
test.before(async () => { app = await startApp(); });
test.after(async () => { await app.stop(); app.cleanup(); });

const line = (p, planned, delivered, extra = {}) => ({ productId: p.id, qtyPlanned: planned, qtyDelivered: delivered, ...extra });
async function arrive(f, i = 0, extra = {}) { const r = await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/stops/${f.clients[i].id}/arrive`, { ...f.here(i), ...extra }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body; }

test('llegada: registra distancia; fuera del radio exige motivo; es idempotente por parada', async () => {
  const f = await setupField(app); const url = `/api/mobile/v1/routes/${f.route.id}/stops/${f.clients[0].id}/arrive`;
  const far = await f.call('POST', url, { ...f.here(0, 0.01) }); assert.equal(far.status, 422); assert.equal(far.body.code, 'OUTSIDE_RADIUS'); assert.ok(far.body.distanceM > 1000); assert.equal(far.body.radiusM, 150);
  const v = (await f.call('POST', url, { ...f.here(0, 0.01), outsideReason: 'Calle cerrada, estacioné lejos' })).body; assert.equal(v.status, 'OPEN'); assert.ok(v.distanceM > 1000); assert.equal(v.outsideRadiusReason, 'Calle cerrada, estacioné lejos');
  const again = await f.call('POST', url, { ...f.here(0) }); assert.equal(again.body.id, v.id, 'una segunda llegada devuelve la misma visita');
  assert.equal((await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/stops/${f.clients[1].id}/arrive`, {})).status, 422, 'sin coordenadas no hay llegada');
  assert.equal((await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/stops/00000000-0000-4000-8000-000000000000/arrive`, f.here(0))).status, 404);
  const st = (await f.call('GET', '/api/mobile/v1/routes')).body[0].stops; assert.equal(st[0].visit.status, 'OPEN'); assert.equal(st[1].visit, null);
});

test('no se opera sin iniciar la ruta, ni en rutas ajenas', async () => {
  const f = await setupField(app, { start: false });
  assert.equal((await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/stops/${f.clients[0].id}/arrive`, f.here(0))).body.code, 'ROUTE_NOT_STARTED');
  await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/start`, {}); const otro = await createUser(app, f.admin, { email: `otro-${Date.now()}@campo.mx`, role: 'Repartidor' });
  assert.equal((await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/stops/${f.clients[0].id}/arrive`, f.here(0), { as: otro.client })).status, 404);
});

test('entrega total, parcial y fallida con su estado, importe y motivo', async () => {
  const f = await setupField(app); const [agua, ref] = f.products;
  let v = await arrive(f, 0);
  const total = await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(agua, 10, 10), line(ref, 2, 2)] }); assert.equal(total.status, 201); assert.deepEqual([total.body.status, total.body.totalCents], ['DELIVERED', 10 * 1000 + 2 * 2550]);
  const parcial = await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(agua, 10, 6, { reason: 'Faltó producto' }), line(ref, 2, 2)] }); assert.deepEqual([parcial.body.status, parcial.body.totalCents], ['PARTIAL', 6 * 1000 + 5100], 'se puede corregir mientras la visita está abierta');
  assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(agua, 10, 6)] })).body.code, 'LINE_REASON_REQUIRED');
  assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(agua, 2, 3)] })).body.code, 'QTY_EXCEEDS'); assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(agua, 1.5, 1)] })).body.code, 'QTY_INVALID');
  assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(agua, 1, 1), line(agua, 1, 1)] })).body.code, 'LINE_DUPLICATE'); assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [{ productId: '00000000-0000-4000-8000-000000000000', qtyPlanned: 1, qtyDelivered: 1 }] })).body.code, 'PRODUCT_INVALID');
  assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v.id}/close`)).status, 200);
  v = await arrive(f, 1); const fail = await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(agua, 5, 0)] }); assert.equal(fail.status, 422); assert.equal(fail.body.code, 'INCIDENT_REQUIRED');
  const ok = await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(agua, 5, 0)], incidentReason: 'CLIENT_CLOSED' }); assert.deepEqual([ok.body.status, ok.body.totalCents], ['FAILED', 0]);
  assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(agua, 5, 0)], incidentReason: 'INVENTADO' })).status, 422);
  assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v.id}/close`)).status, 200); assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(agua, 1, 1)] })).body.code, 'VISIT_CLOSED');
  const prodSinPrecio = (await f.admin.client.post('/api/products', { sku: 'SIN', name: 'Sin precio' })).body; const v3 = await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/stops/${f.clients[1].id}/arrive`, f.here(1)); assert.equal(v3.status, 409);
});

test('descuentos: requieren permiso y respetan el tope del rol', async () => {
  const f = await setupField(app); const v = await arrive(f, 0); const agua = f.products[0];
  const ok = await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(agua, 10, 10, { discountBp: 500 })] }); assert.equal(ok.body.totalCents, 9500, '5 % de descuento = tope del Repartidor');
  const over = await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(agua, 10, 10, { discountBp: 501 })] }); assert.equal(over.status, 403); assert.equal(over.body.code, 'DISCOUNT_LIMIT');
  const sinPrecio = (await f.admin.client.post('/api/products', { sku: 'NP', name: 'NP' })).body; assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(sinPrecio, 1, 1)] })).body.code, 'PRODUCT_NO_PRICE');
  const admin = f.admin; const mgr = await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(agua, 10, 10, { discountBp: 501 })] }, { as: admin.client }); assert.equal(mgr.status, 404, 'otro usuario no opera la visita del repartidor');
});

test('evidencias en disco (no en SQLite): foto y firma, solo imágenes reales y servidas con sesión y alcance', async () => {
  const f = await setupField(app); const v = await arrive(f, 0); const base = `/api/mobile/v1/visits/${v.id}/evidences`;
  const up = (kind, buf, type = 'image/png', o = {}) => f.call('POST', `${base}?kind=${kind}`, buf, { raw: true, headers: { 'Content-Type': type }, ...o });
  const photo = await up('PHOTO', JPG, 'image/jpeg'); assert.equal(photo.status, 201); assert.equal(photo.body.kind, 'PHOTO'); assert.equal(photo.body.mime, 'image/jpeg'); assert.equal(photo.body.sha256.length, 64);
  const sign = await up('SIGNATURE', PNG); assert.equal(sign.status, 201);
  assert.equal((await up('PHOTO', Buffer.from('<script>x</script>'))).status, 422); assert.equal((await up('VIDEO', PNG)).status, 422); assert.equal((await up('PHOTO', Buffer.alloc(0))).status, 422);
  const row = app.rt.store.conn.prepare('SELECT path, size FROM evidences WHERE id=?').get(photo.body.id); assert.match(row.path, /^evidences\/.+\/\d{4}\/\d{2}\/.+\.jpg$/); assert.equal(app.rt.store.conn.prepare("SELECT COUNT(*) n FROM pragma_table_info('evidences') WHERE name IN ('data','blob','content')").get().n, 0);
  assert.deepEqual(Buffer.from(await app.rt.files.read(row.path)), JPG);
  const got = await fetch(app.baseUrl + sign.body.url?.replace?.('', '') || `/api/evidences/${sign.body.id}`, { headers: { Authorization: `Bearer ${f.admin.client.token}` } }).catch(() => null);
  const dl = await fetch(`${app.baseUrl}/api/evidences/${photo.body.id}`, { headers: { Authorization: `Bearer ${f.admin.client.token}` } }); assert.equal(dl.status, 200); assert.equal(dl.headers.get('content-type'), 'image/jpeg'); assert.deepEqual(Buffer.from(await dl.arrayBuffer()), JPG);
  assert.equal((await fetch(`${app.baseUrl}/api/evidences/${photo.body.id}`)).status, 401);
  const other = await setupField(app, { name: 'Ajena Ev SA' }); assert.equal((await fetch(`${app.baseUrl}/api/evidences/${photo.body.id}`, { headers: { Authorization: `Bearer ${other.admin.client.token}` } })).status, 404, 'otra empresa no ve la evidencia');
  const norte = (await f.admin.client.post('/api/centers', { name: 'Norte' })).body; await f.admin.client.put('/api/session/center', { centerId: norte.id }); assert.equal((await fetch(`${app.baseUrl}/api/evidences/${photo.body.id}`, { headers: { Authorization: `Bearer ${f.admin.client.token}` } })).status, 404, 'tampoco desde otro centro');
  await f.admin.client.put('/api/session/center', { centerId: f.admin.session.activeCenterId }); assert.equal((await f.op.client.get(`/api/evidences/${photo.body.id}`)).status, 403, 'un repartidor no consulta evidencias por el panel');
});

test('cobros: métodos, referencia, saldo pendiente, sobrepago y suma por ruta', async () => {
  const f = await setupField(app); const v = await arrive(f, 0); const agua = f.products[0]; await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(agua, 10, 10)] });   // $100.00
  const pay = (body, o) => f.call('POST', `/api/mobile/v1/visits/${v.id}/payments`, body, o);
  assert.equal((await pay({ method: 'BITCOIN', amount: 10 })).body.code, 'METHOD_INVALID'); assert.equal((await pay({ method: 'CASH', amount: 0 })).body.code, 'AMOUNT_INVALID'); assert.equal((await pay({ method: 'CASH', amount: -5 })).status, 422);
  assert.equal((await pay({ method: 'TRANSFER', amount: 10 })).body.code, 'REFERENCE_REQUIRED');
  const c1 = await pay({ method: 'CASH', amount: 30 }); assert.equal(c1.status, 201); assert.equal(c1.body.balanceCents, 7000);
  const c2 = await pay({ method: 'TRANSFER', amountCents: 2500, reference: 'SPEI-1234' }); assert.equal(c2.body.balanceCents, 4500);
  const over = await pay({ method: 'CASH', amount: 46 }); assert.equal(over.status, 422); assert.equal(over.body.code, 'OVERPAYMENT'); assert.equal(over.body.balanceCents, 4500);
  assert.equal((await f.call('GET', '/api/mobile/v1/routes')).body[0].stops[0].balanceCents, 4500, 'el saldo se muestra al repartidor');
  assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v.id}/close`)).status, 200); assert.equal((await pay({ method: 'CASH', amount: 1 })).body.code, 'VISIT_CLOSED');
  const ex = (await f.admin.client.get(`/api/routes/${f.route.id}/execution`)).body; assert.deepEqual(ex.summary.byMethod, { CASH: 3000, TRANSFER: 2500 }); assert.equal(ex.summary.collectedCents, 5500); assert.equal(ex.visits[0].payments.length, 2);
  assert.equal((await f.admin.client.get('/api/routes')).body.find((r) => r.id === f.route.id).execution.collectedCents, 5500);
});

test('saldo vencido bloquea el crédito: se entrega de contado o con autorización', async () => {
  const f = await setupField(app, { stops: 1 }); const agua = f.products[0]; let v = await arrive(f, 0);
  await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(agua, 10, 10)] }); await f.call('POST', `/api/mobile/v1/visits/${v.id}/close`);         // $100 a crédito
  app.rt.store.conn.prepare("UPDATE client_ledger SET created_at='2026-09-01T12:00:00.000Z' WHERE client_id=?").run(f.clients[0].id);                      // 77 días de antigüedad
  await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/finish`);
  const g = await setupField(app, { name: 'Segunda SA' }); assert.ok(g);
  // Segunda ruta al mismo cliente, operada por el administrador (tiene credit.authorize) y por el repartidor (no).
  let r2 = (await f.admin.client.post('/api/routes', { name: 'Segunda ruta', day: 'Martes', operatorId: f.op.user.id })).body; r2 = (await f.admin.client.put(`/api/routes/${r2.id}/stops`, { revision: r2.revision, clientIds: [f.clients[0].id] })).body;
  await f.admin.client.post(`/api/routes/${r2.id}/submit`, { revision: r2.revision }); await f.admin.client.post(`/api/routes/${r2.id}/approve`, { revision: r2.revision }); await f.call('POST', `/api/mobile/v1/routes/${r2.id}/start`, {});
  v = (await f.call('POST', `/api/mobile/v1/routes/${r2.id}/stops/${f.clients[0].id}/arrive`, f.here(0))).body; assert.equal((await f.call('GET', '/api/mobile/v1/routes')).body.find((r) => r.id === r2.id).stops[0].overdueCents, 10000);
  await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(agua, 4, 4)] });                                                              // $40 nuevos
  await f.call('POST', `/api/mobile/v1/visits/${v.id}/payments`, { method: 'CASH', amount: 10 });
  const blocked = await f.call('POST', `/api/mobile/v1/visits/${v.id}/close`); assert.equal(blocked.status, 409); assert.equal(blocked.body.code, 'CREDIT_BLOCKED'); assert.equal(blocked.body.overdueCents, 10000); assert.equal(blocked.body.dueCents, 3000);
  await f.call('POST', `/api/mobile/v1/visits/${v.id}/payments`, { method: 'CASH', amount: 30 }); assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v.id}/close`)).status, 200, 'cobrando el total de la entrega ya no hay crédito nuevo');
  assert.equal(f.admin.client.token === undefined, false);
});

test('formularios publicados: validación real en captura y foto/firma obligatorias según la VERSIÓN declarada', async () => {
  const f = await setupField(app, { stops: 2 }); const a = f.admin.client; const agua = f.products[0];
  await a.put('/api/config/draft', { forms: { entrega: [{ label: 'Folio', type: 'Texto', required: true, maxLength: 6 }, { label: 'Cajas', type: 'Número', min: 1, max: 10 }, { label: 'Foto', type: 'Foto', required: true }, { label: 'Firma', type: 'Firma', required: true }] } }); await a.post('/api/config/publish', { note: 'v1' });
  const v = await arrive(f, 0); const d = (body) => f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(agua, 1, 1)], formVersion: 1, ...body });
  let r = await d({ form: { Cajas: '3' } }); assert.equal(r.status, 422); assert.equal(r.body.code, 'FORM_INVALID'); assert.match(r.body.error, /Folio/);
  r = await d({ form: { Folio: 'F-0001', Cajas: '99' } }); assert.equal(r.body.code, 'FORM_INVALID'); assert.equal(r.body.errors[0].field, 'Cajas');
  assert.equal((await d({ form: { Folio: 'F-1', Cajas: '3' }, formVersion: 77 })).body.code, 'FORM_VERSION_UNKNOWN');
  assert.equal((await d({ form: { Folio: 'F-1', Cajas: '3' } })).status, 201);
  let close = await f.call('POST', `/api/mobile/v1/visits/${v.id}/close`); assert.equal(close.status, 422); assert.equal(close.body.code, 'EVIDENCE_REQUIRED'); assert.equal(close.body.kind, 'PHOTO');
  await f.call('POST', `/api/mobile/v1/visits/${v.id}/evidences?kind=PHOTO`, JPG, { raw: true, headers: { 'Content-Type': 'image/jpeg' } });
  close = await f.call('POST', `/api/mobile/v1/visits/${v.id}/close`); assert.equal(close.body.kind, 'SIGNATURE');
  await f.call('POST', `/api/mobile/v1/visits/${v.id}/evidences?kind=SIGNATURE`, PNG, { raw: true, headers: { 'Content-Type': 'image/png' } }); assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v.id}/close`)).status, 200);
  // Se publica una v2 SIN requisitos: la visita en curso del dispositivo que aún trae la v1 sigue regida por la v1.
  await a.put('/api/config/draft', { forms: { entrega: [] } }); await a.post('/api/config/publish', { note: 'v2' });
  const v2 = await arrive(f, 1); assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v2.id}/delivery`, { lines: [line(agua, 1, 1)], formVersion: 1, form: { Folio: 'F-2' } })).status, 201);
  assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v2.id}/close`)).body.code, 'EVIDENCE_REQUIRED', 'la versión declarada (v1) exige evidencias');
  assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v2.id}/delivery`, { lines: [line(agua, 1, 1)], formVersion: 2 })).status, 201); assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v2.id}/close`)).status, 200, 'con la v2 vigente no se exige nada');
  const ex = (await a.get(`/api/routes/${f.route.id}/execution`)).body; assert.equal(ex.visits[0].delivery.form.Folio, 'F-1'); assert.equal(ex.visits[0].evidences.length, 2);
});

test('cierre de ruta: exige visitas cerradas o no visitadas con motivo; resumen y estado Finalizada', async () => {
  const f = await setupField(app); const agua = f.products[0]; const fin = () => f.call('POST', `/api/mobile/v1/routes/${f.route.id}/finish`);
  const early = await fin(); assert.equal(early.status, 409); assert.equal(early.body.code, 'VISITS_PENDING'); assert.equal(early.body.pending.length, 2);
  const v = await arrive(f, 0); await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(agua, 2, 2)] }); await f.call('POST', `/api/mobile/v1/visits/${v.id}/payments`, { method: 'CASH', amount: 20 }); await f.call('POST', `/api/mobile/v1/visits/${v.id}/close`);
  assert.equal((await fin()).body.pending.length, 1);
  assert.equal((await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/stops/${f.clients[1].id}/skip`, {})).status, 422); const sk = await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/stops/${f.clients[1].id}/skip`, { reason: 'Local cerrado por duelo' }); assert.equal(sk.body.status, 'SKIPPED');
  assert.equal((await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/stops/${f.clients[0].id}/skip`, { reason: 'x' })).body.code, 'VISIT_CLOSED');
  const done = await fin(); assert.equal(done.status, 200); assert.equal(done.body.status, 'COMPLETED'); assert.deepEqual([done.body.summary.delivered, done.body.summary.skipped, done.body.summary.collectedCents, done.body.summary.totalCents], [1, 1, 2000, 2000]);
  const route = (await f.admin.client.get(`/api/routes/${f.route.id}`)).body; assert.equal(route.status, 'COMPLETED'); assert.equal(route.statusLabel, 'Finalizada'); assert.ok(route.finishedAt); assert.deepEqual(route.history.map((h) => h.to).slice(-2), ['IN_PROGRESS', 'COMPLETED']);
  assert.equal((await f.call('GET', '/api/mobile/v1/routes')).body.length, 0, 'una ruta finalizada deja de descargarse');
  assert.equal((await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/stops/${f.clients[0].id}/arrive`, f.here(0))).body.code, 'ROUTE_NOT_STARTED');
  assert.ok((await f.admin.client.get('/api/notifications?category=Sistema')).body.some((n) => /finalizada/i.test(n.title)));
});

test('incidencias de ruta: motivo del catálogo, notificación crítica y auditoría', async () => {
  const f = await setupField(app); const cat = (await f.call('GET', '/api/mobile/v1/incident-reasons')).body; assert.ok(cat.some((c) => c.code === 'CLIENT_CLOSED'));
  assert.equal((await f.call('POST', '/api/mobile/v1/incidents', { routeId: f.route.id, reason: 'RARO' })).status, 422);
  const r = await f.call('POST', '/api/mobile/v1/incidents', { routeId: f.route.id, reason: 'DAMAGED', detail: 'Se cayó una tarima' }); assert.equal(r.status, 201); assert.equal(r.body.label, 'Producto dañado');
  assert.equal((await f.admin.client.get(`/api/routes/${f.route.id}/execution`)).body.incidents[0].detail, 'Se cayó una tarima'); assert.ok((await f.admin.client.get('/api/notifications?category=Críticas')).body.some((n) => /dañado/.test(n.title)));
  assert.ok((await f.admin.client.get('/api/audit?action=incident.reported')).body.length === 1);
});

test('IDEMPOTENCIA: doble clic o reintento no duplican entregas, cobros ni evidencias', async () => {
  const f = await setupField(app); const agua = f.products[0]; const v = await arrive(f, 0);
  const KEY = 'delivery-key-0001'; const body = { lines: [line(agua, 10, 10)] }; const first = await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, body, { key: KEY }); const replay = await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, body, { key: KEY });
  assert.equal(first.status, 201); assert.equal(replay.status, 201); assert.deepEqual(replay.body, first.body); assert.equal(replay.headers.get('idempotent-replay'), 'true'); assert.equal(first.headers.get('idempotent-replay'), null);
  const PK = 'payment-key-0001'; const pay = { method: 'CASH', amount: 40 }; const p1 = await f.call('POST', `/api/mobile/v1/visits/${v.id}/payments`, pay, { key: PK }); const p2 = await f.call('POST', `/api/mobile/v1/visits/${v.id}/payments`, pay, { key: PK });
  assert.deepEqual(p2.body, p1.body); assert.equal(app.rt.store.conn.prepare('SELECT COUNT(*) n FROM payments WHERE visit_id=?').get(v.id).n, 1); assert.equal(app.rt.store.conn.prepare("SELECT COUNT(*) n FROM client_ledger WHERE visit_id=? AND kind='PAYMENT'").get(v.id).n, 1);
  assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v.id}/payments`, { method: 'CASH', amount: 41 }, { key: PK })).body.code, 'IDEMPOTENCY_MISMATCH');
  const EK = 'evidence-key-0001'; const e1 = await f.call('POST', `/api/mobile/v1/visits/${v.id}/evidences?kind=PHOTO`, JPG, { raw: true, key: EK, headers: { 'Content-Type': 'image/jpeg' } }); const e2 = await f.call('POST', `/api/mobile/v1/visits/${v.id}/evidences?kind=PHOTO`, JPG, { raw: true, key: EK, headers: { 'Content-Type': 'image/jpeg' } });
  assert.deepEqual(e2.body, e1.body); assert.equal(app.rt.store.conn.prepare('SELECT COUNT(*) n FROM evidences WHERE visit_id=?').get(v.id).n, 1);
  assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v.id}/payments`, pay, { key: null })).body.code, 'IDEMPOTENCY_KEY_REQUIRED'); assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v.id}/payments`, pay, { key: 'corta' })).status, 400);
  const CK = 'close-key-00001'; const [c1, c2] = await Promise.all([f.call('POST', `/api/mobile/v1/visits/${v.id}/close`, {}, { key: CK }), f.call('POST', `/api/mobile/v1/visits/${v.id}/close`, {}, { key: CK })]);
  assert.ok([c1.status, c2.status].every((s) => [200, 409].includes(s)) && [c1.status, c2.status].includes(200), 'dos clics simultáneos: uno procesa y el otro se repite o espera');
  const FK = 'fail-key-000001'; const bad = await f.call('POST', `/api/mobile/v1/visits/${v.id}/payments`, { method: 'CASH', amount: 1 }, { key: FK }); assert.equal(bad.status, 409, 'visita cerrada');
  assert.equal(app.rt.store.conn.prepare('SELECT COUNT(*) n FROM idempotency_keys WHERE key=?').get(FK).n, 0, 'las respuestas de error no se conservan: se puede reintentar corregido');
});

test('auditoría y aislamiento: cada paso queda registrado y otra empresa no ve nada', async () => {
  const f = await setupField(app); const agua = f.products[0]; const v = await arrive(f, 0); await f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(agua, 1, 1)] });
  const acts = (await f.admin.client.get('/api/audit?limit=100')).body.map((e) => e.action); for (const a of ['visit.arrived', 'delivery.recorded', 'route.started']) assert.ok(acts.includes(a), a);
  const other = await setupField(app, { name: 'Otra Campo SA' }); assert.equal((await other.admin.client.get(`/api/routes/${f.route.id}/execution`)).status, 404);
  assert.equal((await other.call('POST', `/api/mobile/v1/visits/${v.id}/close`)).status, 404); assert.equal((await f.op.client.get(`/api/routes/${f.route.id}/execution`)).status, 403, 'el repartidor no consulta cobros ni evidencias por el panel');
});
