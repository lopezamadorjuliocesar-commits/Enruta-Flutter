'use strict';
// Escenario 10 (parte configuración): versionado Borrador/Publicada, recepción por dispositivo, formularios y herencia de parámetros.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, registerCompany, createUser } = require('./helpers');
const { setupField } = require('./field');
const params = require('../src/services/params');
const forms = require('../src/services/forms');

let app;
test.before(async () => { app = await startApp(); });
test.after(async () => { await app.stop(); app.cleanup(); });

test('parámetros: la herencia respeta usuario > ruta > zona > centro > empresa > sistema y reporta el origen', () => {
  const p = { EMPRESA: { visit_radius_m: 100, overdue_block_days: 20 }, 'CENTRO:c1': { visit_radius_m: 200 }, 'ZONA:z1': { visit_radius_m: 300 }, 'RUTA:r1': { visit_radius_m: 400 }, 'USUARIO:u1': { visit_radius_m: 500 } };
  const at = (scope) => params.resolve(p, scope);
  assert.deepEqual([at({}).values.visit_radius_m, at({}).origins.visit_radius_m], [100, 'EMPRESA']);
  assert.deepEqual([at({ centerId: 'c1' }).values.visit_radius_m, at({ centerId: 'c1' }).origins.visit_radius_m], [200, 'CENTRO']);
  assert.equal(at({ centerId: 'c1', zoneId: 'z1' }).origins.visit_radius_m, 'ZONA'); assert.equal(at({ centerId: 'c1', zoneId: 'z1', routeId: 'r1' }).values.visit_radius_m, 400);
  assert.deepEqual([at({ centerId: 'c1', zoneId: 'z1', routeId: 'r1', userId: 'u1' }).values.visit_radius_m, at({ userId: 'u1' }).origins.visit_radius_m], [500, 'USUARIO']);
  assert.equal(at({ centerId: 'otro' }).values.visit_radius_m, 100, 'un centro sin valor hereda de la empresa');
  const d = at({}); assert.deepEqual([d.values.cash_tolerance_cents, d.origins.cash_tolerance_cents, d.values.loading_window], [5000, 'SISTEMA', '']); assert.equal(d.values.overdue_block_days, 20);
});

test('parámetros: validación de rangos y formatos; vacío = heredar', () => {
  assert.deepEqual(params.parseScopeValues({ visit_radius_m: '250', loading_window: '06:00-09:30', min_client_version: '1.2.0', overdue_block_days: '', cash_tolerance_cents: null }), { visit_radius_m: 250, loading_window: '06:00-09:30', min_client_version: '1.2.0' });
  for (const bad of [{ visit_radius_m: 5 }, { visit_radius_m: 'x' }, { loading_window: '25:00-26:00' }, { min_client_version: '1.2' }, { overdue_block_days: -1 }, { inventado: 1 }]) assert.throws(() => params.parseScopeValues(bad), /Parámetro|debe|no es válida|formato|HH:MM/);
  assert.equal(params.insideWindow('06:00-09:00', new Date('2026-11-17T13:00:00Z'), 'America/Mexico_City'), true, '07:00 hora de CDMX');
  assert.equal(params.insideWindow('06:00-09:00', new Date('2026-11-17T20:00:00Z'), 'America/Mexico_City'), false);
  assert.equal(params.insideWindow('22:00-04:00', new Date('2026-11-18T08:00:00Z'), 'America/Mexico_City'), true, 'ventana que cruza la medianoche'); assert.equal(params.insideWindow('', new Date()), true);
  assert.ok(params.cmpVersion('1.10.0', '1.9.9') > 0 && params.cmpVersion('1.0.0', '1.0.0') === 0);
});

test('formularios: definición válida y validación real de capturas por tipo', () => {
  const fields = forms.parseFields('entrega', [
    { label: 'Folio', type: 'Texto', required: true, maxLength: 5 }, { label: 'Cajas', type: 'Número', min: 1, max: 10 }, { label: 'Fecha', type: 'Fecha' },
    { label: 'Calidad', type: 'Selección', options: ['Buena', 'Mala'] }, { label: 'Lote', type: 'Código de barras' }, { label: 'Acepta', type: 'Casilla', required: true }, { label: 'Foto', type: 'Foto', required: true }, { label: 'Firma', type: 'Firma', required: true }]);
  assert.deepEqual(forms.requiredEvidence(fields), { photo: true, signature: true });
  const ok = { Folio: 'A1', Cajas: '3', Fecha: '2026-11-17', Calidad: 'Buena', Lote: 'LOT-123', Acepta: true };
  assert.deepEqual(forms.validateValues(fields, ok), []);
  const msgs = (v) => forms.validateValues(fields, { ...ok, ...v }).map((e) => e.field);
  assert.deepEqual(msgs({ Folio: '' }), ['Folio']); assert.deepEqual(msgs({ Folio: 'DEMASIADO' }), ['Folio']); assert.deepEqual(msgs({ Cajas: '0' }), ['Cajas']); assert.deepEqual(msgs({ Cajas: '11' }), ['Cajas']); assert.deepEqual(msgs({ Cajas: 'abc' }), ['Cajas']);
  assert.deepEqual(msgs({ Fecha: '2026-13-45' }), ['Fecha']); assert.deepEqual(msgs({ Calidad: 'Regular' }), ['Calidad']); assert.deepEqual(msgs({ Lote: '!' }), ['Lote']); assert.deepEqual(msgs({ Acepta: false }), ['Acepta']);
  assert.throws(() => forms.parseFields('entrega', [{ label: 'A', type: 'Texto' }, { label: 'a', type: 'Texto' }]), /repetida/); assert.throws(() => forms.parseFields('entrega', [{ label: 'S', type: 'Selección', options: ['solo'] }]), /2 opciones/);
  assert.throws(() => forms.parseFields('entrega', [{ label: 'N', type: 'Número', min: 5, max: 1 }]), /mínimo/); assert.throws(() => forms.parseFields('entrega', [{ label: 'X', type: 'Raro' }]), /Tipo/);
});

test('borrador vs publicada: lo editado NO rige hasta publicar; cada publicación es una versión inmutable', async () => {
  const f = await setupField(app, { name: 'Config SA', start: false }); const a = f.admin.client;
  const first = (await a.get('/api/config')).body; assert.equal(first.published, null); assert.equal(first.hasChanges, false); assert.equal(first.draft.modules.length, 4);
  assert.equal((await a.post('/api/config/publish', {})).body.code, 'NO_CHANGES');
  const saved = (await a.put('/api/config/draft', { modules: [{ name: 'Preventa', enabled: true }], parameters: { EMPRESA: { visit_radius_m: 80 } } })).body;
  assert.equal(saved.hasChanges, true); assert.equal(saved.draft.modules.find((m) => m.name === 'Preventa').enabled, true); assert.equal(saved.published, null);
  assert.equal((await a.get('/api/parameters/effective')).body.values.visit_radius_m, 150, 'lo publicado manda: aún rige el valor del sistema');
  assert.equal((await a.get('/api/parameters/effective?source=draft')).body.values.visit_radius_m, 80, 'el borrador se puede previsualizar');
  const p1 = (await a.post('/api/config/publish', { note: 'Primera' })).body; assert.equal(p1.version, 1); assert.equal(p1.published.version, 1); assert.equal(p1.hasChanges, false);
  assert.equal((await a.get('/api/parameters/effective')).body.values.visit_radius_m, 80);
  await a.put('/api/config/draft', { parameters: { EMPRESA: { visit_radius_m: 90 } } }); assert.equal((await a.get('/api/config')).body.hasChanges, true);
  assert.equal((await a.get('/api/parameters/effective')).body.values.visit_radius_m, 80, 'el borrador nuevo no afecta lo publicado');
  const p2 = (await a.post('/api/config/publish', { note: 'Segunda' })).body; assert.equal(p2.version, 2);
  const versions = (await a.get('/api/config/versions')).body; assert.deepEqual(versions.map((v) => [v.version, v.status]), [[2, 'PUBLISHED'], [1, 'SUPERSEDED']]);
  assert.equal((await a.get('/api/config/versions/1')).body.payload.parameters.EMPRESA.visit_radius_m, 80, 'la versión 1 no cambió'); assert.equal((await a.get('/api/config/versions/9')).status, 404);
  assert.ok((await a.get('/api/audit?action=config.')).body.length >= 4);
});

test('validaciones del borrador: módulos, formularios, ámbitos de otra empresa y permisos', async () => {
  const f = await setupField(app, { name: 'Valida SA', start: false }); const a = f.admin.client;
  assert.equal((await a.put('/api/config/draft', { modules: [{ name: 'Inventado', enabled: true }] })).body.code, 'MODULE_UNKNOWN');
  assert.equal((await a.put('/api/config/draft', { forms: { raro: [] } })).body.code, 'FORM_UNKNOWN'); assert.equal((await a.put('/api/config/draft', { forms: { entrega: [{ label: '', type: 'Texto' }] } })).body.code, 'FORM_INVALID');
  assert.equal((await a.put('/api/config/draft', { parameters: { 'RUTA:00000000-0000-4000-8000-000000000000': { visit_radius_m: 100 } } })).body.code, 'PARAM_SCOPE_INVALID');
  assert.equal((await a.put('/api/config/draft', { parameters: { EMPRESA: { visit_radius_m: 3 } } })).body.code, 'PARAM_INVALID');
  const other = await registerCompany(app, { name: 'Ajena Config SA', email: 'x@ajena-config.mx' }); const foreignCenter = other.session.centers[0].id;
  assert.equal((await a.put('/api/config/draft', { parameters: { [`CENTRO:${foreignCenter}`]: { visit_radius_m: 100 } } })).body.code, 'PARAM_SCOPE_INVALID', 'no se puede configurar un centro de otra empresa');
  const rep = f.op.client; for (const [m, u] of [['get', '/api/config'], ['put', '/api/config/draft'], ['post', '/api/config/publish']]) assert.equal((await rep[m](u, m === 'get' ? undefined : {})).status, 403);
  const sup = await createUser(app, f.admin, { email: 'sup@valida-config.mx', role: 'Supervisor' }); assert.equal((await sup.client.get('/api/config')).status, 403, 'el supervisor no administra la configuración');
  assert.equal((await sup.client.get('/api/parameters/effective')).status, 200, 'pero sí consulta los parámetros efectivos');
});

test('herencia real con centro, zona, ruta y usuario del servidor', async () => {
  const f = await setupField(app, { name: 'Herencia SA', start: false }); const a = f.admin.client; const centerId = f.admin.session.activeCenterId;
  const zone = (await a.post('/api/zones', { name: 'Zona 1' })).body;
  await a.put('/api/config/draft', { parameters: { EMPRESA: { visit_radius_m: 100, overdue_block_days: 15 }, [`CENTRO:${centerId}`]: { visit_radius_m: 200 }, [`ZONA:${zone.id}`]: { visit_radius_m: 300 }, [`RUTA:${f.route.id}`]: { visit_radius_m: 400 }, [`USUARIO:${f.op.user.id}`]: { loading_window: '06:00-09:00' } } });
  await a.post('/api/config/publish', { note: 'herencia' });
  const eff = (await a.get(`/api/parameters/effective?routeId=${f.route.id}`)).body; assert.deepEqual([eff.values.visit_radius_m, eff.origins.visit_radius_m], [400, 'RUTA']);
  assert.deepEqual([eff.values.overdue_block_days, eff.origins.overdue_block_days], [15, 'EMPRESA']); assert.deepEqual([eff.values.loading_window, eff.origins.loading_window], ['06:00-09:00', 'USUARIO']);
  assert.deepEqual([(await a.get(`/api/parameters/effective?centerId=${centerId}`)).body.values.visit_radius_m, (await a.get(`/api/parameters/effective?zoneId=${zone.id}&centerId=${centerId}`)).body.origins.visit_radius_m], [200, 'ZONA']);
  // `inheritedFor`: lo que heredaría ese nivel sin sus propios valores ni los más específicos (marcadores de la pantalla de parámetros)
  const inh = async (level, extra) => (await a.get(`/api/parameters/effective?source=draft&inheritedFor=${level}&centerId=${centerId}&${extra}`)).body;
  assert.deepEqual([(await inh('RUTA', `routeId=${f.route.id}`)).values.visit_radius_m, (await inh('RUTA', `routeId=${f.route.id}`)).origins.visit_radius_m], [200, 'CENTRO'], 'la ruta heredaría del centro (la ruta no tiene zona)');
  assert.deepEqual([(await inh('CENTRO', '')).values.visit_radius_m, (await inh('CENTRO', '')).origins.visit_radius_m], [100, 'EMPRESA']);
  assert.equal((await inh('EMPRESA', '')).origins.visit_radius_m, 'SISTEMA');
});

test('recepción por dispositivo: «recibida por X de Y» y evento en vivo', async () => {
  const f = await setupField(app, { name: 'Acuse SA', start: false }); const a = f.admin.client;
  const dev2 = (await a.post('/api/devices/link-qr')).body; const l2 = await fetch(app.baseUrl + '/api/mobile/v1/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: dev2.token, serial: 'ACUSE-DEV-2' }) }).then((r) => r.json());
  await a.put('/api/config/draft', { modules: [{ name: 'Autoventa', enabled: true }], forms: { entrega: [{ label: 'Folio', type: 'Texto', required: true }] } }); await a.post('/api/config/publish', { note: 'v1' });
  assert.deepEqual((await a.get('/api/config/versions')).body[0].ack, { received: 0, total: 2, pending: (await a.get('/api/config/versions')).body[0].ack.pending }); assert.equal((await a.get('/api/config/versions')).body[0].ack.pending.length, 2);
  const cfg = (await f.call('GET', '/api/mobile/v1/config')).body; assert.equal(cfg.version, 1); assert.equal(cfg.modules.find((m) => m.name === 'Autoventa').enabled, true); assert.equal(cfg.forms.entrega[0].label, 'Folio'); assert.equal(cfg.parameters.values.visit_radius_m, 150);
  assert.equal((await f.call('POST', '/api/mobile/v1/config/ack', { version: 1 })).status, 200); assert.equal((await f.call('POST', '/api/mobile/v1/config/ack', { version: 1 })).status, 200, 'confirmar dos veces no duplica');
  let v = (await a.get('/api/config/versions')).body[0]; assert.equal(v.ack.received, 1); assert.equal(v.ack.total, 2);
  assert.equal((await f.call('POST', '/api/mobile/v1/config/ack', { version: 7 })).status, 404); assert.equal((await f.call('POST', '/api/mobile/v1/config/ack', {})).body.code, 'VERSION_REQUIRED');
  const as2 = app.client(); as2.token = f.op.client.token; const r2 = await as2.post('/api/mobile/v1/config/ack', { version: 1 }, { headers: { 'X-Device-Token': l2.deviceToken } }); assert.equal(r2.status, 200);
  v = (await a.get('/api/config/versions')).body[0]; assert.deepEqual([v.ack.received, v.ack.total, v.ack.pending.length], [2, 2, 0]);
  const dev = (await a.get('/api/devices')).body[0]; await a.post(`/api/devices/${dev.id}/revoke`); assert.equal((await a.get('/api/config/versions')).body[0].ack.total, 1, 'un dispositivo revocado ya no cuenta como destinatario');
});

test('versión mínima de la app (426) y horario de embarque, ambos heredados', async () => {
  const f = await setupField(app, { name: 'Reglas SA', start: false }); const a = f.admin.client;
  await a.put('/api/config/draft', { parameters: { EMPRESA: { min_client_version: '2.0.0' } } }); await a.post('/api/config/publish', {});
  let r = await f.call('GET', '/api/mobile/v1/me'); assert.equal(r.status, 426); assert.equal(r.body.code, 'UPGRADE_REQUIRED'); assert.equal(r.body.minVersion, '2.0.0');
  assert.equal((await f.call('GET', '/api/mobile/v1/me', undefined, { headers: { 'X-Client-Version': '1.9.9' } })).status, 426); assert.equal((await f.call('GET', '/api/mobile/v1/me', undefined, { headers: { 'X-Client-Version': '2.0.0' } })).status, 200);
  await a.put('/api/config/draft', { parameters: { EMPRESA: { min_client_version: '' } } }); await a.post('/api/config/publish', {});
  await a.put('/api/config/draft', { parameters: { [`RUTA:${f.route.id}`]: { loading_window: '06:00-07:00' } } }); await a.post('/api/config/publish', {});        // el reloj de pruebas marca 06:00 en CDMX = 12:00 UTC
  assert.equal((await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/start`, {})).status, 200, 'dentro del horario');
  const g = await setupField(app, { name: 'Horario SA', start: false }); await g.admin.client.put('/api/config/draft', { parameters: { EMPRESA: { loading_window: '15:00-16:00' } } }); await g.admin.client.post('/api/config/publish', {});
  const out = await g.call('POST', `/api/mobile/v1/routes/${g.route.id}/start`, {}); assert.equal(out.status, 409); assert.equal(out.body.code, 'OUTSIDE_LOADING_WINDOW'); assert.match(out.body.error, /empresa/);
  const perm = (await g.admin.client.get('/api/roles')).body.find((x) => x.name === 'Repartidor'); await g.admin.client.put(`/api/roles/${perm.id}/permissions`, { permissions: [...perm.permissions, 'routes.start_outside_window'] });
  assert.equal((await g.call('POST', `/api/mobile/v1/routes/${g.route.id}/start`, {})).status, 200, 'con el permiso se puede iniciar fuera de horario');
});
