'use strict';
// Escenarios 5 y 6: creación y aprobación de ruta; invalidación de la aprobación al editar (versiones exactas).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, registerCompany, createUser } = require('./helpers');

let app; let admin; let op; let centerId; let clients = [];
const rid = (r) => r.body.id;
const api = () => admin.client;
const mkRoute = async (name, extra = {}) => (await api().post('/api/routes', { name, day: 'Lunes', operatorId: op.user.id, ...extra })).body;
const withStops = async (route, ids = clients.slice(0, 2).map((c) => c.id)) => (await api().put(`/api/routes/${route.id}/stops`, { revision: route.revision, clientIds: ids })).body;

test.before(async () => {
  app = await startApp(); admin = await registerCompany(app, { name: 'Rutas SA', email: 'admin@rutas.mx' }); centerId = admin.session.activeCenterId;
  op = await createUser(app, admin, { email: 'operador@rutas.mx', role: 'Repartidor', name: 'Operador Uno' });
  for (const [i, n] of ['Tienda A', 'Tienda B', 'Tienda C'].entries()) clients.push((await api().post('/api/clients', { name: n, lat: 19.5 + i / 100, lng: -96.9 })).body);
});
test.after(async () => { await app.stop(); app.cleanup(); });

test('crear una ruta: borrador revisión 1, nombre único por empresa, historial y auditoría', async () => {
  const r = await api().post('/api/routes', { name: 'Ruta Lunes', day: 'Lunes', color: '#1769aa', operatorId: op.user.id }); assert.equal(r.status, 201);
  assert.equal(r.body.status, 'DRAFT'); assert.equal(r.body.statusLabel, 'Borrador'); assert.equal(r.body.revision, 1); assert.equal(r.body.operatorName, 'Operador Uno'); assert.equal(r.body.approvedRevision, null);
  assert.equal((await api().post('/api/routes', { name: 'ruta lunes' })).body.code, 'ROUTE_NAME_TAKEN');
  assert.equal((await api().post('/api/routes', { name: '' })).status, 422); assert.equal((await api().post('/api/routes', { name: 'X', operatorId: '00000000-0000-4000-8000-000000000000' })).body.code, 'OPERATOR_INVALID');
  const full = (await api().get(`/api/routes/${r.body.id}`)).body; assert.equal(full.history[0].to, 'DRAFT');
  assert.ok((await api().get('/api/audit?action=route.created')).body.length >= 1);
});

test('validaciones antes de enviar a aprobación (operador, paradas y ubicaciones)', async () => {
  const noOp = await mkRoute('Sin operador', { operatorId: null }); await withStops(noOp);
  let r = await api().post(`/api/routes/${noOp.id}/submit`, { revision: 2 }); assert.equal(r.status, 422); assert.equal(r.body.code, 'ROUTE_INVALID'); assert.match(r.body.error, /operador/);
  const empty = await mkRoute('Sin paradas'); r = await api().post(`/api/routes/${empty.id}/submit`, { revision: 1 }); assert.match(r.body.problems.join(' '), /parada/);
  const nolat = (await api().post('/api/clients', { name: 'Sin ubicación' })).body; const noLoc = await mkRoute('Sin ubicacion'); const w = await withStops(noLoc, [nolat.id]);
  r = await api().post(`/api/routes/${noLoc.id}/submit`, { revision: w.revision }); assert.match(r.body.problems.join(' '), /no tiene ubicación/);
  const auditor = (await api().post('/api/roles', { name: 'Solo lectura', permissions: ['routes.read'] })).body; const ro = await createUser(app, admin, { email: 'lector@rutas.mx', role: 'Solo lectura' });
  const badOp = await mkRoute('Operador sin rol', { operatorId: ro.user.id }); const w2 = await withStops(badOp); r = await api().post(`/api/routes/${badOp.id}/submit`, { revision: w2.revision }); assert.match(r.body.problems.join(' '), /no tiene permiso para entregar/);
  const other = (await api().post('/api/centers', { name: 'Norte' })).body; const far = await createUser(app, admin, { email: 'lejano@rutas.mx', role: 'Repartidor', centerIds: [other.id] });
  const wrongCenter = await mkRoute('Operador de otro centro', { operatorId: far.user.id }); const w3 = await withStops(wrongCenter); r = await api().post(`/api/routes/${wrongCenter.id}/submit`, { revision: w3.revision }); assert.match(r.body.problems.join(' '), /no está asignado al centro/);
  const inactive = await createUser(app, admin, { email: 'baja@rutas.mx', role: 'Repartidor' }); const inRoute = await mkRoute('Operador inactivo', { operatorId: inactive.user.id }); const w4 = await withStops(inRoute);
  await api().patch(`/api/users/${inactive.user.id}/status`, { status: 'INACTIVE' }); r = await api().post(`/api/routes/${inRoute.id}/submit`, { revision: w4.revision }); assert.match(r.body.problems.join(' '), /inactivo/);
  assert.equal((await api().get(`/api/routes/${noOp.id}`)).body.status, 'DRAFT', 'una validación fallida no cambia el estado');
});

test('paradas: orden, duplicados, centro y empresa; la revisión sube solo si cambian', async () => {
  const route = await mkRoute('Paradas'); const [a, b, c] = clients;
  let s = await withStops(route, [a.id, b.id]); assert.deepEqual(s.stopIds, [a.id, b.id]); assert.equal(s.revision, 2);
  const same = (await api().put(`/api/routes/${route.id}/stops`, { revision: s.revision, clientIds: [a.id, b.id] })).body; assert.equal(same.revision, 2, 'sin cambios no hay revisión nueva');
  s = (await api().put(`/api/routes/${route.id}/stops`, { revision: 2, clientIds: [b.id, a.id, c.id] })).body; assert.deepEqual(s.stopIds, [b.id, a.id, c.id]); assert.equal(s.revision, 3);
  assert.equal((await api().put(`/api/routes/${route.id}/stops`, { revision: 3, clientIds: [a.id, a.id] })).body.code, 'STOPS_DUPLICATE');
  assert.equal((await api().put(`/api/routes/${route.id}/stops`, { revision: 3, clientIds: ['00000000-0000-4000-8000-000000000000'] })).body.code, 'STOPS_INVALID');
  assert.equal((await api().put(`/api/routes/${route.id}/stops`, { clientIds: [a.id] })).body.code, 'REVISION_REQUIRED');
  const norte = (await api().get('/api/centers')).body.find((x) => x.name === 'Norte'); await api().put('/api/session/center', { centerId: norte.id });
  const cn = (await api().post('/api/clients', { name: 'Cliente Norte', lat: 20, lng: -100 })).body; await api().put('/api/session/center', { centerId });
  assert.equal((await api().put(`/api/routes/${route.id}/stops`, { revision: 3, clientIds: [cn.id] })).body.code, 'STOPS_CENTER');
  const other = await registerCompany(app, { name: 'Otra Rutas SA', email: 'o@rutas.mx' }); const foreign = (await other.client.post('/api/clients', { name: 'Ajeno', lat: 1, lng: 1 })).body;
  assert.equal((await api().put(`/api/routes/${route.id}/stops`, { revision: 3, clientIds: [foreign.id] })).body.code, 'STOPS_INVALID');
});

test('flujo completo: borrador → pendiente → publicada → en ejecución, con historial y aprobación de la versión exacta', async () => {
  const route = await mkRoute('Flujo completo'); const w = await withStops(route);
  const sub = await api().post(`/api/routes/${route.id}/submit`, { revision: w.revision }); assert.equal(sub.status, 200); assert.equal(sub.body.status, 'PENDING_APPROVAL'); assert.equal(sub.body.approval.revision, w.revision);
  assert.ok((await api().get('/api/approvals')).body.some((x) => x.id === route.id));
  assert.equal((await api().post(`/api/routes/${route.id}/submit`, { revision: w.revision })).body.code, 'ROUTE_STATE');
  assert.equal((await api().post(`/api/routes/${route.id}/approve`, { revision: w.revision - 1 })).body.code, 'REVISION_MISMATCH');
  const ok = await api().post(`/api/routes/${route.id}/approve`, { revision: w.revision }); assert.equal(ok.status, 200); assert.equal(ok.body.status, 'PUBLISHED'); assert.equal(ok.body.approvedRevision, w.revision); assert.equal(ok.body.statusLabel, 'Publicada');
  assert.equal((await api().get('/api/approvals')).body.some((x) => x.id === route.id), false);
  const full = (await api().get(`/api/routes/${route.id}`)).body; assert.deepEqual(full.history.map((h) => h.to), ['DRAFT', 'PENDING_APPROVAL', 'PUBLISHED']); assert.equal(full.approvals[0].decision, 'APPROVED'); assert.equal(full.approvals[0].selfApproved, true);
  const ev = (await api().get('/api/audit?action=route.approved')).body[0]; assert.equal(ev.detail.selfApproved, true);
  const started = await op.client.post(`/api/mobile/v1/routes/${route.id}/start`, {}); assert.equal(started.status, 403, 'sin dispositivo vinculado no se opera');
});

test('EDITAR una ruta pendiente invalida la solicitud: aprobar con la revisión anterior es imposible', async () => {
  const route = await mkRoute('Edición pendiente'); const w = await withStops(route);
  await api().post(`/api/routes/${route.id}/submit`, { revision: w.revision });
  const edited = await api().put(`/api/routes/${route.id}`, { revision: w.revision, name: 'Edición pendiente v2' }); assert.equal(edited.body.status, 'DRAFT'); assert.equal(edited.body.revision, w.revision + 1); assert.equal(edited.body.approval, null);
  assert.equal((await api().post(`/api/routes/${route.id}/approve`, { revision: w.revision })).body.code, 'ROUTE_STATE', 'ya no está pendiente');
  const full = (await api().get(`/api/routes/${route.id}`)).body; assert.equal(full.approvals[0].decision, 'INVALIDATED'); assert.match(full.history.at(-1).note, /invalidada/);
  assert.ok((await api().get('/api/notifications?category=Aprobaciones')).body.some((n) => /invalidada/i.test(n.title)));
  assert.ok((await api().get('/api/audit?action=route.approval_invalidated')).body.length >= 1);
});

test('EDITAR una ruta publicada la regresa a borrador, quita la aprobación y exige aprobar la versión nueva', async () => {
  const route = await mkRoute('Edición publicada'); let w = await withStops(route);
  await api().post(`/api/routes/${route.id}/submit`, { revision: w.revision }); const pub = (await api().post(`/api/routes/${route.id}/approve`, { revision: w.revision })).body; assert.equal(pub.approvedRevision, w.revision);
  for (const [what, call] of [['parada', () => api().put(`/api/routes/${route.id}/stops`, { revision: pub.revision, clientIds: [clients[2].id, clients[0].id] })]]) {
    const r = await call(); assert.equal(r.status, 200, what); assert.equal(r.body.status, 'DRAFT'); assert.equal(r.body.approvedRevision, null); assert.equal(r.body.revision, pub.revision + 1); w = r.body;
  }
  const sub2 = await api().post(`/api/routes/${route.id}/submit`, { revision: w.revision }); assert.equal(sub2.body.approval.revision, w.revision);
  assert.equal((await api().post(`/api/routes/${route.id}/approve`, { revision: pub.revision })).body.code, 'REVISION_MISMATCH', 'la aprobación de la v1 no sirve para la v2');
  assert.equal((await api().post(`/api/routes/${route.id}/approve`, { revision: w.revision })).body.status, 'PUBLISHED');
  const h = (await api().get(`/api/routes/${route.id}`)).body.approvals.map((a) => a.decision); assert.deepEqual(h, ['INVALIDATED', 'APPROVED']);
});

test('cada tipo de edición relevante sube la revisión; el color no', async () => {
  const route = await mkRoute('Tipos de edición'); const ve = (await api().post('/api/vehicles', { plate: 'RUT-001' })).body; let rev = route.revision;
  const apply = async (body) => { const r = await api().put(`/api/routes/${route.id}`, { revision: rev, ...body }); assert.equal(r.status, 200, JSON.stringify(body)); const bumped = r.body.revision > rev; rev = r.body.revision; return bumped; };
  assert.equal(await apply({ day: 'Martes' }), true); assert.equal(await apply({ name: 'Tipos de edición B' }), true); assert.equal(await apply({ vehicleId: ve.id }), true); assert.equal(await apply({ operatorId: null }), true);
  assert.equal(await apply({ color: '#ff0000' }), false, 'el color es cosmético'); assert.equal(await apply({ day: 'Martes' }), false, 'sin cambio real no hay revisión');
});

test('concurrencia optimista: dos editores con la misma revisión, gana el primero', async () => {
  const route = await mkRoute('Concurrencia');
  assert.equal((await api().put(`/api/routes/${route.id}`, { revision: route.revision, day: 'Jueves' })).status, 200);
  const late = await api().put(`/api/routes/${route.id}`, { revision: route.revision, day: 'Viernes' }); assert.equal(late.status, 409); assert.equal(late.body.code, 'REVISION_CONFLICT');
  assert.equal((await api().put(`/api/routes/${route.id}`, { day: 'Viernes' })).body.code, 'REVISION_REQUIRED');
});

test('rechazar, reenviar, cancelar, bloqueo de edición, duplicar y eliminar', async () => {
  const route = await mkRoute('Ciclo de rechazo'); const w = await withStops(route); await api().post(`/api/routes/${route.id}/submit`, { revision: w.revision });
  const rej = await api().post(`/api/routes/${route.id}/reject`, { revision: w.revision, reason: 'Falta una parada' }); assert.equal(rej.body.status, 'DRAFT'); assert.equal(rej.body.statusLabel, 'Rechazada'); assert.equal(rej.body.lastDecisionReason, 'Falta una parada');
  assert.equal((await api().post(`/api/routes/${route.id}/submit`, { revision: w.revision })).body.statusLabel, 'Pendiente de aprobación');
  assert.equal((await api().delete(`/api/routes/${route.id}`)).body.code, 'ROUTE_STATE', 'una ruta pendiente no se elimina');
  const canc = await api().post(`/api/routes/${route.id}/cancel`, { reason: 'Ya no se usa' }); assert.equal(canc.body.status, 'CANCELLED'); assert.equal(canc.body.statusLabel, 'Cancelada');
  assert.equal((await api().put(`/api/routes/${route.id}`, { revision: canc.body.revision, day: 'Lunes' })).body.code, 'ROUTE_LOCKED'); assert.equal((await api().post(`/api/routes/${route.id}/cancel`)).body.code, 'ROUTE_STATE');
  const dup = await api().post(`/api/routes/${route.id}/duplicate`); assert.equal(dup.status, 201); assert.equal(dup.body.status, 'DRAFT'); assert.equal(dup.body.name, 'Ciclo de rechazo (copia)'); assert.deepEqual(dup.body.stopIds, w.stopIds);
  assert.equal((await api().post(`/api/routes/${route.id}/duplicate`)).body.name, 'Ciclo de rechazo (copia 2)');
  assert.equal((await api().delete(`/api/routes/${route.id}`)).status, 200); assert.equal((await api().get(`/api/routes/${route.id}`)).status, 404);
  assert.equal((await api().delete(`/api/clients/${clients[0].id}`)).body.code, 'CLIENT_IN_ROUTE', 'un cliente en rutas no se elimina');
});

test('permisos por rol y aislamiento por centro y empresa', async () => {
  const route = await mkRoute('Permisos de ruta'); const w = await withStops(route);
  const sup = await createUser(app, admin, { email: 'sup@rutas.mx', role: 'Supervisor' });
  assert.equal((await op.client.get('/api/routes')).status, 200); assert.equal((await op.client.post('/api/routes', { name: 'Intento' })).status, 403);
  assert.equal((await op.client.post(`/api/routes/${route.id}/submit`, { revision: w.revision })).status, 403); assert.equal((await op.client.post(`/api/routes/${route.id}/approve`, { revision: w.revision })).status, 403);
  assert.equal((await api().post(`/api/routes/${route.id}/submit`, { revision: w.revision })).status, 200); const ap = await sup.client.post(`/api/routes/${route.id}/approve`, { revision: w.revision }); assert.equal(ap.status, 200);
  assert.equal((await api().get(`/api/routes/${route.id}`)).body.approvals[0].selfApproved, false, 'aprobó otra persona');
  assert.equal((await op.client.get('/api/approvals')).status, 403);
  const other = await registerCompany(app, { name: 'Aislada Rutas SA', email: 'aislada@rutas.mx' }); assert.equal((await other.client.get(`/api/routes/${route.id}`)).status, 404); assert.deepEqual((await other.client.get('/api/routes')).body, []);
  assert.equal((await other.client.post(`/api/routes/${route.id}/approve`, { revision: 1 })).status, 404);
  const norte = (await api().get('/api/centers')).body.find((x) => x.name === 'Norte'); await api().put('/api/session/center', { centerId: norte.id });
  assert.ok(!(await api().get('/api/routes')).body.some((r) => r.id === route.id), 'las rutas de otro centro no se ven'); assert.equal((await api().get(`/api/routes/${route.id}`)).status, 404); await api().put('/api/session/center', { centerId });
});
