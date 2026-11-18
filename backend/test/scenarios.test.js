'use strict';
// FASE 4 — Regresión de los 20 escenarios críticos como UN solo recorrido de punta a punta, sobre una BD SQLite TEMPORAL EN ARCHIVO
// (para poder reiniciar el backend de verdad). Cada prueba se titula «Escenario N — …» y `scripts/scenarios-report.js` las resume.
// El escenario 20 tiene aquí su contraparte de servidor (eventos en tiempo real que mueven la UI sin recargar); su parte visual vive en
// Karma (`src/app/reactivity.spec.ts`, `app.component.spec.ts`) y en los humos E2E.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startApp, registerCompany, createUser, openStream, makeClock, PASSWORD } = require('./helpers');
const { PNG, JPG } = require('./field');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enruta-fase4-'));
const dbPath = path.join(dir, 'enruta.sqlite'); const storageDir = path.join(dir, 'storage'); const clock = makeClock();
let app; let admin; let sup; let op; let prev; let readonly; let device; let center2;
const S = {};   // estado compartido entre escenarios

test.before(async () => { app = await startApp({ dbPath, storageDir, clock }); });
test.after(async () => { await app.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

const mobile = (method, url, body, { key, raw = false, headers = {}, as = () => op.client, dev = () => device } = {}) =>
  as().request(method, url, body, { raw, headers: { 'X-Device-Token': dev(), ...(method !== 'GET' && key !== null ? { 'Idempotency-Key': key || crypto.randomUUID() } : {}), ...headers } });
const A = () => admin.client;
const here = (i, dLat = 0) => ({ lat: S.coords[i][0] + dLat, lng: S.coords[i][1] });
const idem = () => `reg-${crypto.randomUUID()}`;

test('Escenario 1 — Registro de empresa y administrador (RFC simulado, sin verificación fiscal falsa)', async () => {
  const c = app.client();
  const bad = await c.post('/api/companies/validate-rfc', { rfc: 'ABC123', razonSocial: 'X SA', codigoPostal: '91000' }); assert.equal(bad.status, 422);
  const rej = await c.post('/api/companies/validate-rfc', { rfc: 'REJ200101AA1', razonSocial: 'Rechazada SA de CV', codigoPostal: '91000' }); assert.ok(!rej.body.validationToken, 'un RFC rechazado no genera token de registro');
  const v = await c.post('/api/companies/validate-rfc', { rfc: 'DRE200101AA1', razonSocial: 'Distribuidora Regresión SA de CV', codigoPostal: '91000' });
  assert.deepEqual([v.status, v.body.simulated, v.body.verified], [200, true, false]);
  const weak = await c.post('/api/companies/register', { validationToken: v.body.validationToken, rfc: 'DRE200101AA1', razonSocial: 'Distribuidora Regresión SA de CV', adminName: 'Ana', adminEmail: 'ana@regresion.mx', password: 'debil', industry: 'Distribución', country: 'México', plan: 'Operación' });
  assert.equal(weak.status, 422, 'contraseña débil rechazada');
  admin = await registerCompany(app, { name: 'Distribuidora Regresión SA de CV', rfc: 'DRE200101AA1', email: 'ana@regresion.mx', adminName: 'Ana Admin' });
  assert.equal(admin.session.company.fiscalStatus, 'SIMULATED'); assert.match(admin.session.company.fiscalLabel, /Simulado/);
  assert.equal(admin.session.user.role, 'Administrador'); assert.ok(admin.session.permissions.length >= 30);
  await assert.rejects(registerCompany(app, { name: 'Otra', rfc: 'DRE200101AA1', email: 'otra@regresion.mx' }), /409/, 'el RFC ya registrado no se duplica');
  assert.equal((await app.client().post('/api/auth/login', { email: 'ana@regresion.mx', password: 'Clave-Mala-999' })).status, 401);
});

test('Escenario 2 — Usuarios con distintos permisos (matriz por rol y cambios de permisos inmediatos)', async () => {
  sup = await createUser(app, admin, { role: 'Supervisor', email: 'sara@regresion.mx', name: 'Sara Supervisora', mode: 'web' });
  op = await createUser(app, admin, { role: 'Repartidor', email: 'rafa@regresion.mx', name: 'Rafa Repartidor' });
  prev = await createUser(app, admin, { role: 'Preventista', email: 'pablo@regresion.mx', name: 'Pablo Preventista' });
  const code = async (who, method, url, body) => (await who.client.request(method, url, body)).status;
  assert.deepEqual([await code(admin, 'GET', '/api/users'), await code(sup, 'GET', '/api/users'), await code(op, 'GET', '/api/users'), await code(prev, 'GET', '/api/users')], [200, 200, 403, 403]);
  assert.deepEqual([await code(admin, 'PUT', '/api/config/draft', {}), await code(sup, 'PUT', '/api/config/draft', {})], [200, 403], 'solo el administrador edita la configuración');
  assert.deepEqual([await code(op, 'GET', '/api/reports/summary'), await code(sup, 'GET', '/api/reports/summary')], [403, 200]);
  assert.equal(await code(op, 'POST', '/api/products', { sku: 'X1', name: 'X' }), 403);
  const role = (await A().post('/api/roles', { name: 'Solo lectura', permissions: ['catalog.read', 'clients.read'] })).body; readonly = await createUser(app, admin, { role: 'Solo lectura', email: 'lee@regresion.mx' });
  assert.equal(await code(readonly, 'POST', '/api/products', { sku: 'RO-1', name: 'RO', price: 1 }), 403);
  assert.equal((await A().put(`/api/roles/${role.id}/permissions`, { permissions: ['catalog.read', 'clients.read', 'catalog.write'] })).status, 200);
  assert.equal(await code(readonly, 'POST', '/api/products', { sku: 'RO-1', name: 'RO', price: 1 }), 201, 'el nuevo permiso rige de inmediato, sin volver a iniciar sesión');
});

test('Escenario 3 — Bloqueo de usuario inactivo (todas sus sesiones caen y no puede volver a entrar)', async () => {
  const u = await createUser(app, admin, { email: 'baja@regresion.mx', mode: 'web' }); const second = app.client({ mode: 'web' }); await second.post('/api/auth/login', { email: 'baja@regresion.mx', password: PASSWORD });
  assert.equal((await u.client.get('/api/clients')).status, 200);
  const off = await A().patch(`/api/users/${u.user.id}/status`, { status: 'INACTIVE' }); assert.equal(off.body.sessionsRevoked, 2);
  for (const c of [u.client, second]) { const r = await c.get('/api/clients'); assert.deepEqual([r.status, r.body.code], [401, 'USER_INACTIVE']); }
  assert.equal((await app.client().post('/api/auth/login', { email: 'baja@regresion.mx', password: PASSWORD })).status, 401);
  assert.equal((await A().patch(`/api/users/${u.user.id}/status`, { status: 'INACTIVE' })).status, 200); assert.equal((await sup.client.patch(`/api/users/${u.user.id}/status`, { status: 'ACTIVE' })).status, 403);
});

test('Escenario 4 — Clientes, productos y precios (importación, lista por cliente, promoción y cotización)', async () => {
  S.coords = [[19.5438, -96.9102], [19.5321, -96.9145], [19.5203, -96.9301]];
  const imp = (await A().post('/api/import/clients', { mode: 'omitir', records: S.coords.map(([lat, lng], i) => ({ name: `Cliente ${i + 1}`, code: `R-${i + 1}`, lat, lng, address: `Calle ${i + 1}` })).concat([{ name: 'Sin nombre válido', lat: 200, lng: 0 }]) })).body;
  assert.deepEqual([imp.created, imp.invalid.length], [3, 1], 'la importación revalida en el servidor y rechaza coordenadas inválidas');
  S.clients = (await A().get('/api/clients')).body.filter((c) => c.code?.startsWith('R-')).sort((a, b) => a.code.localeCompare(b.code));
  S.agua = (await A().post('/api/products', { sku: 'AGU', name: 'Agua 600 ml', price: 10 })).body; S.ref = (await A().post('/api/products', { sku: 'REF', name: 'Refresco 2 L', price: 25.5 })).body;
  assert.equal((await A().post('/api/products', { sku: 'AGU', name: 'Repetido' })).status, 409, 'SKU único por empresa');
  await A().post('/api/price-lists', { name: 'Mayoreo', priority: 3, prices: [{ productId: S.agua.id, price: 8 }], clientIds: [S.clients[0].id] }); await A().post('/api/promotions', { name: '25% agua', productId: S.agua.id, kind: 'PERCENT', value: 25 });
  const q = async (c) => (await A().get(`/api/pricing/quote?clientId=${c.id}&items=${S.agua.id}:2`)).body.lines[0];
  assert.deepEqual([(await q(S.clients[0])).unitPriceCents, (await q(S.clients[1])).unitPriceCents], [600, 750], 'lista del cliente + promoción vs. precio base + promoción');
});

test('Escenario 5 — Creación y aprobación de ruta (supervisor aprueba la revisión exacta)', async () => {
  const r = (await A().post('/api/routes', { name: 'Ruta Regresión', day: 'Lunes', operatorId: op.user.id })).body; assert.deepEqual([r.status, r.revision], ['DRAFT', 1]);
  S.route = (await A().put(`/api/routes/${r.id}/stops`, { revision: r.revision, clientIds: S.clients.slice(0, 2).map((c) => c.id) })).body; assert.equal(S.route.stopIds.length, 2);
  assert.equal((await A().put(`/api/routes/${r.id}/stops`, { revision: 1, clientIds: [] })).body.code, 'REVISION_CONFLICT', 'edición con revisión vieja rechazada');
  const sub = await A().post(`/api/routes/${S.route.id}/submit`, { revision: S.route.revision }); assert.equal(sub.body.status, 'PENDING_APPROVAL');
  assert.ok((await sup.client.get('/api/approvals')).body.some((x) => x.id === S.route.id), 'el supervisor ve la solicitud');
  const ok = await sup.client.post(`/api/routes/${S.route.id}/approve`, { revision: sub.body.revision }); assert.deepEqual([ok.status, ok.body.status], [200, 'PUBLISHED']); S.route = ok.body;
  assert.equal((await op.client.post(`/api/routes/${S.route.id}/approve`, { revision: S.route.revision })).status, 403, 'el repartidor no aprueba');
});

test('Escenario 6 — Invalidación de la aprobación al editar una ruta publicada', async () => {
  const edited = (await A().put(`/api/routes/${S.route.id}/stops`, { revision: S.route.revision, clientIds: S.clients.slice(0, 3).map((c) => c.id) })).body;
  assert.deepEqual([edited.status, edited.revision > S.route.revision], ['DRAFT', true], 'editar una ruta publicada la regresa a Borrador con nueva revisión');
  assert.equal((await sup.client.post(`/api/routes/${S.route.id}/approve`, { revision: S.route.revision })).status, 409, 'la aprobación vieja ya no sirve');
  assert.equal((await op.client.get('/api/mobile/v1/routes', { headers: { 'X-Device-Token': 'x' } })).status, 403, 'sin dispositivo no hay descarga (ver escenario 7)');
  const sub = (await A().post(`/api/routes/${S.route.id}/submit`, { revision: edited.revision })).body;
  assert.equal((await sup.client.post(`/api/routes/${S.route.id}/approve`, { revision: edited.revision - 1 })).body.code, 'REVISION_MISMATCH');
  S.route = (await sup.client.post(`/api/routes/${S.route.id}/approve`, { revision: sub.revision })).body; assert.equal(S.route.status, 'PUBLISHED');
  assert.ok((await A().get(`/api/routes/${S.route.id}`)).body.history.some((h) => h.to === 'DRAFT'), 'el historial conserva el regreso a Borrador');
});

test('Escenario 7 — Vinculación de dispositivo por QR (un solo uso, caducidad y revocación)', async () => {
  const q = (await A().post('/api/devices/link-qr')).body; assert.match(q.linkUrl, /\/repartidor\/vincular#t=/);
  const link = (token) => fetch(app.baseUrl + '/api/mobile/v1/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, model: 'Pixel 8', os: 'Android', osVersion: '14', serial: `REG-${crypto.randomUUID().slice(0, 8)}` }) });
  const ok = await link(q.token); const body = await ok.json(); assert.equal(ok.status, 200, JSON.stringify(body)); device = body.deviceToken; S.deviceId = body.device.id;
  assert.ok([409, 410].includes((await link(q.token)).status), 'el QR es de un solo uso');
  const old = (await A().post('/api/devices/link-qr')).body; clock.advance(16 * 60_000); assert.equal((await link(old.token)).status, 410); assert.equal((await A().get(`/api/devices/link-qr/${old.jti}`)).body.status, 'expired');
  assert.ok((await A().get('/api/devices')).body.some((d) => d.id === S.deviceId));
  const tmp = (await A().post('/api/devices/link-qr')).body; const t2 = await (await link(tmp.token)).json(); assert.equal((await A().post(`/api/devices/${t2.device.id}/revoke`)).status, 200);
  const rev = await mobile('GET', '/api/mobile/v1/routes', undefined, { dev: () => t2.deviceToken }); assert.equal(rev.status, 401); assert.equal(rev.body.code, 'DEVICE_REVOKED');
});

test('Escenario 8 — Acceso como repartidor (sesión + dispositivo + permiso)', async () => {
  assert.equal((await op.client.get('/api/mobile/v1/routes')).body.code, 'DEVICE_REQUIRED', 'sin credencial de dispositivo no entra');
  assert.equal((await mobile('GET', '/api/mobile/v1/me')).status, 200);
  assert.equal((await mobile('GET', '/api/mobile/v1/routes', undefined, { as: () => readonly.client })).status, 403, 'sin deliveries.execute no entra aunque tenga dispositivo');
  assert.equal((await app.client().get('/api/mobile/v1/routes')).status, 401, 'sin sesión no entra');
  assert.equal((await op.client.get('/api/users')).status, 403, 'el repartidor no ve el panel');
});

test('Escenario 9 — Consulta de ruta asignada (solo rutas PUBLICADAS del operador, con sus paradas)', async () => {
  const draft = (await A().post('/api/routes', { name: 'Ruta Borrador', day: 'Martes', operatorId: op.user.id })).body;
  const list = (await mobile('GET', '/api/mobile/v1/routes')).body; assert.deepEqual(list.map((r) => r.name), ['Ruta Regresión'], 'el borrador no se descarga');
  assert.deepEqual(list[0].stops.map((s) => s.name), S.clients.map((c) => c.name)); assert.ok(list[0].stops.every((s) => s.lat !== null && s.visit === null));
  assert.equal((await mobile('GET', '/api/mobile/v1/routes', undefined, { as: () => prev.client })).body.length, 0, 'otro usuario no ve rutas ajenas');
  await A().delete(`/api/routes/${draft.id}`);
});

test('Escenario 10 — Posiciones GPS reales y simuladas (Real / Simulado / Desactualizado / Desconectado)', async () => {
  const start = await mobile('POST', `/api/mobile/v1/routes/${S.route.id}/start`, {}); assert.equal(start.status, 200);
  const live = async () => (await sup.client.get('/api/tracking/live')).body.vehicles.find((v) => v.routeId === S.route.id);
  assert.equal((await live()).status, 'OFFLINE', 'sin posiciones no hay «en vivo»');
  const now = () => new Date(clock()).toISOString();
  const sent = (await mobile('POST', '/api/mobile/v1/positions', { routeId: S.route.id, positions: [{ ...here(0), accuracy: 8, recordedAt: now() }, { lat: 999, lng: 0, recordedAt: now() }] }, { key: null })).body; assert.deepEqual([sent.accepted, sent.discarded], [1, 1]);
  assert.deepEqual([(await live()).status, (await live()).source], ['REAL', 'REAL']);
  clock.advance(130_000); assert.equal((await live()).status, 'STALE', 'dato viejo: Desactualizado'); clock.advance(800_000); assert.equal((await live()).status, 'OFFLINE', 'sin datos recientes: Desconectado');
  assert.equal((await A().post(`/api/routes/${S.route.id}/simulation`, { speedKmh: 40 })).status, 201); await app.rt.services.tracking.tick(S.route.id);
  const sim = await live(); assert.deepEqual([sim.status, sim.source], ['SIMULATED', 'SIMULATED']); assert.equal((await A().delete(`/api/routes/${S.route.id}/simulation`)).status, 200);
  assert.equal((await op.client.post(`/api/routes/${S.route.id}/simulation`, {})).status, 403, 'el simulador exige permiso');
  assert.ok((await A().get(`/api/tracking/routes/${S.route.id}/history`)).body.points.length >= 2, 'historial de coordenadas');
  await mobile('POST', '/api/mobile/v1/positions', { routeId: S.route.id, positions: [{ ...here(0), recordedAt: now() }] }, { key: null });
});

test('Escenario 11 — Entregas con evidencias (foto y firma obligatorias según el formulario publicado)', async () => {
  await A().put('/api/config/draft', { forms: { entrega: [{ id: '1', label: 'Foto de entrega', type: 'Foto', required: true }, { id: '2', label: 'Firma del cliente', type: 'Firma', required: true }, { id: '3', label: 'Recibe', type: 'Texto', required: true }] } });
  assert.equal((await A().post('/api/config/publish', { note: 'formulario con evidencias' })).status, 201);
  await mobile('GET', '/api/mobile/v1/config');   // el repartidor descarga la configuración publicada
  const v = (await mobile('POST', `/api/mobile/v1/routes/${S.route.id}/stops/${S.clients[0].id}/arrive`, here(0))).body; S.v1 = v;
  const line = (p, planned, delivered, extra = {}) => ({ productId: p.id, qtyPlanned: planned, qtyDelivered: delivered, ...extra });
  const bad = await mobile('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(S.agua, 5, 3, { reason: 'faltó' })] }); assert.equal(bad.status, 422, 'el formulario exige «Recibe»');
  const d = await mobile('POST', `/api/mobile/v1/visits/${v.id}/delivery`, { lines: [line(S.agua, 5, 3, { reason: 'faltó' })], form: { Recibe: 'Don Beto' }, formVersion: 1 }); assert.equal(d.status, 201, d.text); assert.equal(d.body.status, 'PARTIAL');
  assert.equal((await mobile('POST', `/api/mobile/v1/visits/${v.id}/close`, {})).body.code, 'EVIDENCE_REQUIRED', 'sin foto no cierra');
  const up = (kind, buf, mime) => mobile('POST', `/api/mobile/v1/visits/${v.id}/evidences?kind=${kind}`, buf, { raw: true, headers: { 'Content-Type': mime } });
  assert.equal((await up('PHOTO', Buffer.from('no es una imagen'), 'image/jpeg')).status, 422, 'se valida la firma de archivo, no el nombre');
  const photo = await up('PHOTO', JPG, 'image/jpeg'); assert.equal(photo.status, 201); S.photoId = photo.body.id;
  assert.equal((await mobile('POST', `/api/mobile/v1/visits/${v.id}/close`, {})).body.code, 'EVIDENCE_REQUIRED', 'falta la firma');
  assert.equal((await up('SIGNATURE', PNG, 'image/png')).status, 201);
  const file = await A().get(`/api/evidences/${S.photoId}`); assert.deepEqual([file.status, file.headers.get('content-type')], [200, 'image/jpeg']); assert.equal((await app.client().get(`/api/evidences/${S.photoId}`)).status, 401, 'las evidencias solo se sirven con sesión');
  assert.equal((await op.client.get(`/api/evidences/${S.photoId}`)).status, 403, 'el repartidor no lee evidencias por el panel');
});

test('Escenario 12 — Registro de cobros (saldo, sobrepago e idempotencia ante doble clic o reintento)', async () => {
  const pay = (body, key) => mobile('POST', `/api/mobile/v1/visits/${S.v1.id}/payments`, body, { key });
  const key = idem(); const body = { method: 'CASH', amountCents: 1200 };
  const a = await pay(body, key); const b = await pay(body, key);
  assert.deepEqual([a.status, b.status, b.headers.get('idempotent-replay')], [201, 201, 'true']); assert.deepEqual([a.body.balanceCents, b.body.balanceCents], [600, 600], 'el reintento no cobra dos veces');
  assert.equal((await pay({ ...body, amountCents: 1300 }, key)).body.code, 'IDEMPOTENCY_MISMATCH', 'misma clave con otro cuerpo');
  assert.equal((await pay({ method: 'CASH', amountCents: 999999 }, idem())).body.code, 'OVERPAYMENT');
  assert.equal((await pay({ method: 'TRANSFER', amountCents: 300 }, idem())).body.code, 'REFERENCE_REQUIRED');
  const c = await pay({ method: 'TRANSFER', amountCents: 300, reference: 'SPEI-0001' }, idem()); assert.equal(c.body.balanceCents, 300, 'saldo = 3 × $6.00 (lista + promoción) − $12 efectivo − $3 transferencia');
  assert.equal((await mobile('POST', `/api/mobile/v1/visits/${S.v1.id}/payments`, body, { key: null })).body.code, 'IDEMPOTENCY_KEY_REQUIRED', 'sin Idempotency-Key no se acepta');
});

test('Escenario 13 — Cierre de visita y de ruta (paradas resueltas, resumen y devolución)', async () => {
  const close = await mobile('POST', `/api/mobile/v1/visits/${S.v1.id}/close`, {}); assert.equal(close.status, 200, close.text);
  assert.equal((await mobile('POST', `/api/mobile/v1/routes/${S.route.id}/finish`, {})).body.code, 'VISITS_PENDING', 'no se finaliza con paradas sin resolver');
  assert.equal((await mobile('POST', `/api/mobile/v1/routes/${S.route.id}/stops/${S.clients[1].id}/skip`, { reason: '' })).status, 422);
  for (const i of [1, 2]) assert.equal((await mobile('POST', `/api/mobile/v1/routes/${S.route.id}/stops/${S.clients[i].id}/skip`, { reason: 'Negocio cerrado' })).status, 200);
  const f = await mobile('POST', `/api/mobile/v1/routes/${S.route.id}/finish`, {}); assert.equal(f.status, 200); assert.deepEqual([f.body.status, f.body.summary.partial, f.body.summary.skipped, f.body.summary.collectedCents], ['COMPLETED', 1, 2, 1500]);
  assert.equal((await mobile('POST', `/api/mobile/v1/routes/${S.route.id}/stops/${S.clients[0].id}/arrive`, here(0))).status >= 400, true, 'una ruta finalizada no admite más visitas');
  assert.equal((await A().get(`/api/routes/${S.route.id}`)).body.status, 'COMPLETED');
});

test('Escenario 14 — Liquidación y conciliación (esperado en efectivo, tolerancia y autorización por otra persona)', async () => {
  const st = (await A().get('/api/settlements')).body.find((s) => s.routeId === S.route.id); S.settlement = st.id;
  assert.deepEqual([st.status, st.expectedCents, st.otherCents], ['OPEN', 1200, 300], 'esperado = efectivo; la transferencia va aparte');
  const act = (client, what, body = {}) => client.post(`/api/settlements/${S.settlement}/${what}`, body, { headers: { 'Idempotency-Key': idem() } });
  assert.equal((await act(A(), 'submit')).body.code, 'DEPOSIT_REQUIRED');
  const k = idem(); const dep = () => A().post(`/api/settlements/${S.settlement}/deposits`, { amount: 10, reference: 'FICHA-1' }, { headers: { 'Idempotency-Key': k } });
  assert.equal((await dep()).body.deposits.length, 1); assert.equal((await dep()).body.deposits.length, 1, 'el reintento no duplica el depósito');
  await A().put('/api/config/draft', { parameters: { EMPRESA: { cash_tolerance_cents: 100 } } }); await A().post('/api/config/publish', { note: 'tolerancia $1' });
  const submitted = (await act(A(), 'submit')).body; assert.deepEqual([submitted.status, submitted.diffCents, submitted.toleranceCents], ['PENDING_AUTHORIZATION', -200, 100]);
  assert.equal((await act(A(), 'authorize')).body.code, 'SELF_AUTHORIZATION'); assert.equal((await act(sup.client, 'reject')).status, 422, 'rechazar exige motivo');
  const ok = (await act(sup.client, 'authorize', { reason: 'ficha verificada' })).body; assert.deepEqual([ok.status, ok.closed], ['AUTHORIZED', true]);
  assert.equal((await A().post(`/api/routes/${S.route.id}/settlement`)).body.code, 'ALREADY_SETTLED', 'no hay doble liquidación'); assert.equal((await A().post(`/api/settlements/${S.settlement}/deposits`, { amount: 1 }, { headers: { 'Idempotency-Key': idem() } })).status, 409, 'cerrada = inmutable');
});

test('Escenario 15 — Indicadores y auditoría (desde la BD real, con filtros, exportación y cadena de hashes)', async () => {
  const s = (await A().get('/api/reports/summary')).body;
  assert.deepEqual([s.visits.total, s.visits.closed, s.visits.skipped, s.deliveries.partial, s.payments.totalCents, s.settlements.diffCents], [3, 1, 2, 1, 1500, -200]);
  assert.deepEqual([s.deliveries.unitsPlanned, s.deliveries.unitsDelivered, s.deliveries.fillRatePct, s.payments.byMethod.CASH.cents, s.payments.byMethod.TRANSFER.cents], [5, 3, 60, 1200, 300]);
  assert.equal((await A().get(`/api/reports/summary?operatorId=${op.user.id}`)).body.visits.total, 3); assert.equal((await A().get(`/api/reports/summary?operatorId=${prev.user.id}`)).body.visits.total, 0); assert.equal((await A().get('/api/reports/summary?from=2020-01-01&to=2020-01-02')).body.visits.total, 0);
  const csv = await A().get('/api/reports/export.csv'); assert.ok(csv.text.includes('Cobrado (MXN),15.00') && csv.text.includes('Diferencia (MXN),-2.00'));
  const actions = (await A().get('/api/audit?limit=500')).body.map((e) => e.action); for (const a of ['visit.arrived', 'delivery.recorded', 'payment.collected', 'visit.closed', 'route.finished', 'settlement.authorized', 'config.published', 'route.approved']) assert.ok(actions.includes(a), `falta ${a} en la bitácora`);
  assert.ok((await A().get('/api/audit?entity=settlement')).body.every((e) => e.entity === 'settlement')); assert.equal((await A().get('/api/audit/verify')).body.ok, true);
  S.auditCount = (await A().get('/api/audit?limit=500')).body.length; S.summary = s;
});

test('Escenario 16 — Persistencia tras reinicio del backend (BD y evidencias en disco, sesiones y cola)', async () => {
  const before = { token: admin.client.token, opToken: op.client.token };
  await app.stop(); app = await startApp({ dbPath, storageDir, clock });                                              // «reinicio» real: nueva conexión al MISMO archivo
  const a = app.client(); a.token = before.token; admin.client.baseUrl = app.baseUrl; op.client.baseUrl = app.baseUrl; sup.client.baseUrl = app.baseUrl; prev.client.baseUrl = app.baseUrl;
  assert.equal((await admin.client.get('/api/session')).status, 200, 'la sesión sobrevive (vive en la BD)');
  assert.deepEqual((await A().get('/api/reports/summary')).body.visits, S.summary.visits); assert.deepEqual((await A().get('/api/reports/summary')).body.payments, S.summary.payments);
  assert.equal((await A().get(`/api/routes/${S.route.id}`)).body.status, 'COMPLETED'); assert.equal((await A().get(`/api/settlements/${S.settlement}`)).body.status, 'AUTHORIZED');
  const photo = await A().get(`/api/evidences/${S.photoId}`); assert.deepEqual([photo.status, photo.headers.get('content-type')], [200, 'image/jpeg'], 'la foto sigue en el disco');
  assert.equal((await A().get('/api/audit?limit=500')).body.length >= S.auditCount, true); assert.equal((await A().get('/api/audit/verify')).body.ok, true, 'la cadena de hashes sigue íntegra');
  assert.equal((await mobile('GET', '/api/mobile/v1/me')).status, 200, 'el dispositivo vinculado sigue válido');
  assert.equal((await A().get('/api/config')).body.published.version, 2, 'la configuración publicada persiste');
  const jobs = await app.rt.store.read((r) => r.jobs.list({})); assert.ok(jobs.every((j) => j.status !== 'RUNNING'), 'la cola no deja trabajos colgados');
  assert.equal((await app.client().post('/api/auth/login', { email: 'ana@regresion.mx', password: PASSWORD })).status, 200);
});

test('Escenario 17 — Acceso multi-navegador (sesiones independientes y eventos en todos)', async () => {
  await createUser(app, admin, { role: 'Supervisor', email: 'multi@regresion.mx', name: 'Multi Navegador' });
  const web1 = app.client(); const web2 = app.client();   // dos «navegadores» (credencial propia cada uno)
  for (const c of [web1, web2]) assert.equal((await c.post('/api/auth/login', { email: 'multi@regresion.mx', password: PASSWORD })).status, 200);
  const sessions = (await web1.get('/api/auth/sessions')).body; assert.ok(sessions.length >= 3, 'el mismo usuario tiene varias sesiones a la vez');
  const s1 = await openStream(app, web1); const s2 = await openStream(app, web2); assert.deepEqual([s1.status, s2.status], [200, 200]);
  const r = (await A().post('/api/routes', { name: 'Ruta Multi', day: 'Jueves', operatorId: op.user.id })).body;
  await Promise.all([s1.waitFor('route.updated', (e) => e.routeId === r.id), s2.waitFor('route.updated', (e) => e.routeId === r.id)]);   // ambos navegadores se enteran sin recargar
  s2.close(); const other = (await web1.get('/api/auth/sessions')).body.find((x) => !x.current); assert.equal((await web1.delete(`/api/auth/sessions/${other.id}`)).status, 200);
  assert.equal((await web1.get('/api/session')).status, 200, 'cerrar una sesión no cierra la de este navegador…'); s1.close(); await A().delete(`/api/routes/${r.id}`);
  const alive = (await Promise.all([web2.get('/api/session'), (async () => { const c = app.client(); await c.post('/api/auth/login', { email: 'multi@regresion.mx', password: PASSWORD }); return c.get('/api/session'); })()])).map((x) => x.status);
  assert.ok(alive.includes(200), 'y el usuario puede volver a entrar desde cualquier navegador');
});

test('Escenario 18 — Aislamiento total entre empresas y entre centros', async () => {
  const other = await registerCompany(app, { name: 'Competencia SA de CV', email: 'x@competencia.mx' }); await other.client.post('/api/clients', { name: 'Cliente Ajeno', code: 'X-1' });
  assert.ok(!(await A().get('/api/clients')).body.some((c) => c.code === 'X-1')); assert.ok(!(await other.client.get('/api/clients')).body.some((c) => c.code?.startsWith('R-')));
  for (const url of [`/api/routes/${S.route.id}`, `/api/settlements/${S.settlement}`, `/api/evidences/${S.photoId}`, `/api/routes/${S.route.id}/execution`]) assert.equal((await other.client.get(url)).status, 404, `${url} de otra empresa`);
  assert.equal((await other.client.get('/api/reports/summary')).body.visits.total, 0); assert.equal((await other.client.get('/api/audit')).body.some((e) => e.action === 'visit.closed'), false);
  assert.equal((await other.client.post('/api/devices/' + S.deviceId + '/revoke')).status, 404, 'ni siquiera ve dispositivos ajenos');
  center2 = (await A().post('/api/centers', { name: 'Centro Norte' })).body; const all = (await A().get('/api/clients')).body.length;
  await A().put('/api/session/center', { centerId: center2.id }); assert.equal((await A().get('/api/clients')).body.length, 0, 'otro centro: otros datos');
  assert.equal((await A().get('/api/reports/summary')).body.visits.total, 0, 'los indicadores cambian con el centro');
  await A().put('/api/session/center', { centerId: null }); assert.equal((await A().get('/api/clients')).body.length >= all, true, 'sin centro activo se ven todos los centros');
  await A().put('/api/session/center', { centerId: admin.session.centers[0].id });   // el resto del recorrido opera en el centro original
  assert.equal((await A().put('/api/session/center', { centerId: other.session.centers[0].id })).status, 404, 'no se puede entrar al centro de otra empresa');
});

test('Escenario 19 — Recuperación de contraseña desde otro navegador (bandeja local, un solo uso)', async () => {
  const U = await createUser(app, admin, { email: 'olvido@regresion.mx', mode: 'web' });
  await app.client().post('/api/auth/forgot-password', { email: 'olvido@regresion.mx' }); await app.rt.queue.idle();
  const box = (await app.client({ mode: 'web' }).get('/api/dev/mailbox?to=olvido%40regresion.mx')).body; assert.match(box.notice, /MODO LOCAL/);
  const token = new URL(box.messages[0].text.match(/https?:\/\/\S+/)[0]).searchParams.get('token'); const B = app.client({ mode: 'web' });
  assert.equal((await B.get(`/api/auth/reset-password/validate?token=${encodeURIComponent(token)}`)).body.valid, true);
  assert.equal((await B.post('/api/auth/reset-password', { token, newPassword: 'Nueva-Clave-2026' })).status, 200);
  assert.equal((await U.client.get('/api/session')).status, 401, 'la sesión anterior cayó'); assert.equal((await B.post('/api/auth/reset-password', { token, newPassword: 'Otra-Clave-2027' })).status, 410, 'el enlace es de un solo uso');
  assert.equal((await app.client({ mode: 'web' }).post('/api/auth/login', { email: 'olvido@regresion.mx', password: 'Nueva-Clave-2026' })).status, 200);
});

test('Escenario 20 — Actualización reactiva (contraparte de servidor: eventos SSE que mueven la UI sin recargar ni clics)', async () => {
  const stream = await openStream(app, admin.client); assert.equal(stream.status, 200);
  const r = (await A().post('/api/routes', { name: 'Ruta Reactiva', day: 'Viernes', operatorId: op.user.id })).body;
  const s2 = (await A().put(`/api/routes/${r.id}/stops`, { revision: r.revision, clientIds: [S.clients[0].id] })).body; const sub = (await A().post(`/api/routes/${r.id}/submit`, { revision: s2.revision })).body;
  const ev = await stream.waitFor('route.updated', (e) => e.status === 'PENDING_APPROVAL' && e.routeId === r.id).catch((e) => { throw new Error(`${e.message}: ${JSON.stringify(stream.events)}`); }); assert.equal(ev.routeId, r.id, 'la bandeja del supervisor se entera al instante');
  await sup.client.post(`/api/routes/${r.id}/approve`, { revision: sub.revision }); const published = await stream.waitFor('route.assigned', (e) => e.routeId === r.id).catch(() => null);
  assert.ok(stream.events.some((e) => e.type === 'route.updated' && e.status === 'PUBLISHED') || published, 'la publicación llega por SSE');
  const dev = await stream.waitFor('route.updated', (e) => true).catch(() => null); void dev; stream.close(); await A().post(`/api/routes/${r.id}/cancel`, {});
  const noSession = await fetch(app.baseUrl + '/api/events'); assert.equal(noSession.status, 401, 'el flujo en vivo exige sesión'); await noSession.body?.cancel();
});
