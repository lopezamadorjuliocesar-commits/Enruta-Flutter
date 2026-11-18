'use strict';
// Escenarios 17 y 18: aislamiento multi-empresa y por centro; acceso desde varios navegadores.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, registerCompany, createUser, PASSWORD } = require('./helpers');

let app; let A; let B; let centerA2; let centerB1;
test.before(async () => {
  app = await startApp();
  A = await registerCompany(app, { name: 'Empresa Alfa SA', email: 'admin@alfa.mx', mode: 'web' });
  B = await registerCompany(app, { name: 'Empresa Beta SA', email: 'admin@beta.mx', mode: 'web' });
  centerA2 = (await A.client.post('/api/centers', { name: 'Norte' })).body; centerB1 = B.session.centers[0];
});
test.after(async () => { await app.stop(); app.cleanup(); });

const A1 = () => A.session.centers[0];

test('los datos de una empresa jamás aparecen en otra, ni por listado ni por ID', async () => {
  const ca = (await A.client.post('/api/clients', { name: 'Cliente Alfa', code: 'X-1' })).body;
  const cb = (await B.client.post('/api/clients', { name: 'Cliente Beta', code: 'X-1' })).body;     // el mismo código en otra empresa es válido
  const pa = (await A.client.post('/api/products', { sku: 'P-1', name: 'Producto Alfa' })).body; await B.client.post('/api/products', { sku: 'P-1', name: 'Producto Beta' });
  assert.deepEqual((await A.client.get('/api/clients')).body.map((c) => c.name), ['Cliente Alfa']); assert.deepEqual((await B.client.get('/api/clients')).body.map((c) => c.name), ['Cliente Beta']);
  assert.deepEqual((await B.client.get('/api/products')).body.map((p) => p.name), ['Producto Beta']);
  assert.equal((await B.client.get(`/api/clients/${ca.id}`)).status, 404); assert.equal((await B.client.put(`/api/clients/${ca.id}`, { name: 'Hackeado' })).status, 404);
  assert.equal((await B.client.put(`/api/products/${pa.id}`, { name: 'Hackeado' })).status, 404);
  assert.equal((await A.client.get(`/api/clients/${ca.id}`)).body.name, 'Cliente Alfa');
  assert.equal((await A.client.get(`/api/clients/${cb.id}`)).status, 404);
  for (const url of ['/api/users', '/api/roles', '/api/centers', '/api/audit', '/api/notifications']) {
    const mine = JSON.stringify((await A.client.get(url)).body); assert.ok(!mine.includes('Beta') && !mine.includes('beta.mx'), `${url} no filtra datos de Beta`);
  }
});

test('un header x-company, x-api-key o un companyId en el cuerpo NO cambian la empresa: la identidad sale de la sesión', async () => {
  const r = await A.client.get('/api/clients', { headers: { 'x-company': 'empresa-beta-sa', 'x-api-key': 'dev-admin-key' } });
  assert.ok(r.body.every((c) => c.name !== 'Cliente Beta'));
  const post = await A.client.post('/api/clients', { name: 'Con companyId', companyId: B.company.id, company_id: B.company.id, centerId: A1().id }, { headers: { 'x-company': 'empresa-beta-sa' } });
  assert.equal(post.status, 201); assert.ok(!(await B.client.get('/api/clients')).body.some((c) => c.name === 'Con companyId'));
  assert.equal((await A.client.get('/api/session')).body.company.id, A.company.id);
});

test('no se puede operar sobre centros ni zonas de otra empresa', async () => {
  assert.equal((await A.client.post('/api/clients', { name: 'Cruzado', centerId: centerB1.id })).status, 404);
  assert.equal((await A.client.put('/api/session/center', { centerId: centerB1.id })).status, 404);
  assert.equal((await A.client.post('/api/zones', { name: 'Z', centerId: centerB1.id })).status, 404);
  const zb = (await B.client.post('/api/zones', { name: 'Zona Beta' })).body;
  assert.equal((await A.client.post('/api/clients', { name: 'ZonaAjena', zoneId: zb.id })).status, 422);
  const u = await A.client.post('/api/users', { name: 'U', email: 'u@alfa.mx', password: PASSWORD, roleId: (await B.client.get('/api/roles')).body[0].id, centerIds: [A1().id] }); assert.equal(u.status, 422, 'no se puede asignar un rol de otra empresa');
  const roleB = (await B.client.get('/api/roles')).body[0];
  assert.equal((await A.client.put(`/api/roles/${roleB.id}/permissions`, { permissions: [] })).status, 404);
  assert.equal((await A.client.delete(`/api/roles/${roleB.id}`)).status, 404);
  const userB = (await B.client.get('/api/users')).body[0];
  assert.equal((await A.client.patch(`/api/users/${userB.id}/status`, { status: 'INACTIVE' })).status, 404); assert.equal((await B.client.get('/api/session')).status, 200);
  assert.equal((await A.client.put(`/api/users/${userB.id}`, { name: 'Pwn' })).status, 404);
});

test('un usuario no puede usar el token de otra empresa para leer la suya (sesiones separadas)', async () => {
  const swapped = app.client({ mode: 'web' }); swapped.cookie = B.client.cookie;
  const s = (await swapped.get('/api/session')).body; assert.equal(s.company.id, B.company.id); assert.equal(s.user.email, 'admin@beta.mx');
  assert.ok(!(await swapped.get('/api/clients')).body.some((c) => c.name === 'Cliente Alfa'));
});

test('cambiar de centro FILTRA de verdad los datos operativos', async () => {
  const sess = (await A.client.put('/api/session/center', { centerId: A1().id })).body; assert.equal(sess.activeCenterId, A1().id);
  await A.client.post('/api/clients', { name: 'En Matriz 1' }); await A.client.post('/api/clients', { name: 'En Matriz 2' });
  assert.equal((await A.client.put('/api/session/center', { centerId: centerA2.id })).body.activeCenterId, centerA2.id);
  const c2 = (await A.client.post('/api/clients', { name: 'En Norte' })).body; assert.equal(c2.centerId, centerA2.id);
  const norte = (await A.client.get('/api/clients')).body; assert.deepEqual(norte.map((c) => c.name), ['En Norte']);
  assert.equal((await A.client.get(`/api/clients/${c2.id}`)).status, 200);
  await A.client.put('/api/session/center', { centerId: A1().id });
  const matriz = (await A.client.get('/api/clients')).body.map((c) => c.name); assert.ok(matriz.includes('En Matriz 1') && !matriz.includes('En Norte'));
  assert.equal((await A.client.get(`/api/clients/${c2.id}`)).status, 404, 'por ID tampoco se ve un cliente de otro centro mientras ese centro no está activo');
  assert.equal((await A.client.post('/api/clients', { name: 'Forzado a Norte', centerId: centerA2.id })).status, 404, 'tampoco se puede crear fuera del centro activo');
  const all = (await A.client.put('/api/session/center', { centerId: null })).body; assert.equal(all.activeCenterId, null);
  assert.ok((await A.client.get('/api/clients')).body.length >= 3, 'Todos los centros (permiso centers.all) muestra la suma');
  assert.equal((await A.client.post('/api/clients', { name: 'Sin centro' })).body.code, 'CENTER_REQUIRED');
});

test('el centro activo vive en la sesión: persiste entre peticiones y es independiente por navegador', async () => {
  const second = app.client({ mode: 'web' }); await second.post('/api/auth/login', { email: 'admin@alfa.mx', password: PASSWORD });
  await A.client.put('/api/session/center', { centerId: centerA2.id });
  assert.equal((await A.client.get('/api/session')).body.activeCenterId, centerA2.id);
  assert.notEqual((await second.get('/api/session')).body.activeCenterId, centerA2.id, 'otro navegador conserva su propio centro');
});

test('usuarios con centros asignados solo ven y eligen esos centros', async () => {
  const sup = await createUser(app, A, { email: 'sup@alfa.mx', role: 'Supervisor', centerIds: [centerA2.id] });
  assert.equal(sup.session.activeCenterId, centerA2.id); assert.deepEqual(sup.session.centers.map((c) => c.name), ['Norte']); assert.equal(sup.session.canSeeAllCenters, false);
  assert.deepEqual((await sup.client.get('/api/clients')).body.map((c) => c.name), ['En Norte']);
  assert.equal((await sup.client.put('/api/session/center', { centerId: A1().id })).status, 404, 'Matriz no está asignada');
  assert.equal((await sup.client.put('/api/session/center', { centerId: null })).status, 403, '"Todos los centros" requiere centers.all');
  assert.equal((await sup.client.post('/api/clients', { name: 'Intruso', centerId: A1().id })).status, 404);
  assert.deepEqual((await sup.client.get('/api/centers')).body.map((c) => c.name), ['Norte']);
  assert.ok(!(await sup.client.get('/api/audit')).body.some((e) => e.centerId === A1().id), 'la bitácora tampoco muestra eventos de centros ajenos');
  // asignarle Matriz le da acceso en la siguiente petición
  await A.client.put(`/api/users/${sup.user.id}`, { centerIds: [A1().id, centerA2.id] });
  assert.equal((await sup.client.put('/api/session/center', { centerId: A1().id })).status, 200);
});

test('desactivar un centro lo retira de los usuarios sin acceso total', async () => {
  const c3 = (await A.client.post('/api/centers', { name: 'Temporal' })).body; const u = await createUser(app, A, { email: 'temp@alfa.mx', role: 'Repartidor', centerIds: [c3.id] });
  assert.equal(u.session.activeCenterId, c3.id);
  assert.equal((await A.client.put(`/api/centers/${c3.id}`, { status: 'INACTIVE' })).status, 200);
  const s = (await u.client.get('/api/session')).body; assert.equal(s.activeCenterId, null); assert.deepEqual(s.centers, []);
  assert.deepEqual((await u.client.get('/api/clients')).body, [], 'sin centros activos no hay datos operativos');
});

test('acceso multi-navegador: el mismo usuario ve los mismos datos desde otro navegador/dispositivo', async () => {
  const web = app.client({ mode: 'web' }); const phone = app.client({ mode: 'mobile' });
  await web.post('/api/auth/login', { email: 'admin@alfa.mx', password: PASSWORD }); await phone.post('/api/auth/login', { email: 'admin@alfa.mx', password: PASSWORD });
  const created = (await web.post('/api/products', { sku: 'MN-1', name: 'Creado en el navegador' })).body;
  assert.ok((await phone.get('/api/products')).body.some((p) => p.id === created.id));
  await phone.put(`/api/products/${created.id}`, { name: 'Editado en el móvil' }); assert.equal((await web.get('/api/products')).body.find((p) => p.id === created.id).name, 'Editado en el móvil');
  assert.equal((await A.client.get('/api/auth/sessions')).body.length >= 3, true);
});

test('IDs estables: renombrar la empresa o el centro no cambia a qué datos accede cada quien', async () => {
  const before = (await A.client.get('/api/session')).body.company.id; await A.client.put(`/api/centers/${A1().id}`, { name: 'Matriz Renombrada' });
  const s = (await A.client.get('/api/session')).body; assert.equal(s.company.id, before); assert.equal(s.centers.find((c) => c.id === A1().id).name, 'Matriz Renombrada');
  await A.client.put('/api/session/center', { centerId: A1().id }); assert.ok((await A.client.get('/api/clients')).body.some((c) => c.name === 'En Matriz 1'));
  assert.equal((await A.client.post('/api/centers', { name: 'matriz renombrada' })).status, 409);
  assert.equal((await B.client.post('/api/centers', { name: 'Matriz Renombrada' })).status, 201, 'los nombres solo son únicos dentro de la empresa');
});

test('dos empresas con el mismo nombre comercial siguen aisladas (los nombres no son identificadores)', async () => {
  const X = await registerCompany(app, { name: 'Misma Razón SA', email: 'x@misma.mx' }); const Y = await registerCompany(app, { name: 'Misma Razón SA', email: 'y@misma.mx' });
  await X.client.post('/api/clients', { name: 'Solo de X' });
  assert.deepEqual((await Y.client.get('/api/clients')).body, []); assert.notEqual(X.company.id, Y.company.id);
});
