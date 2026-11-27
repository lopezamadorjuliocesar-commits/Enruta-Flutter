'use strict';
// Escenario 2: usuarios con distintos permisos; RBAC aplicado en el backend (no solo en la UI).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, registerCompany, createUser, PASSWORD } = require('./helpers');
const { CATALOG } = require('../src/services/permissions');

let app; let admin; let team = {};
test.before(async () => {
  app = await startApp(); admin = await registerCompany(app, { name: 'Permisos SA', email: 'admin@permisos.mx' });
  for (const role of ['Supervisor', 'Repartidor', 'Preventista']) team[role] = await createUser(app, admin, { email: `${role.toLowerCase()}@permisos.mx`, role });
});
test.after(async () => { await app.stop(); app.cleanup(); });

const status = async (c, method, url, body) => (await c.request(method, url, body)).status;

test('matriz de acceso por rol de sistema', async () => {
  const sup = team.Supervisor.client; const rep = team.Repartidor.client; const pre = team.Preventista.client;
  // lectura
  for (const [c, name] of [[admin.client, 'Admin'], [sup, 'Supervisor'], [rep, 'Repartidor'], [pre, 'Preventista']]) {
    assert.equal(await status(c, 'GET', '/api/clients'), 200, `${name} ve clientes`); assert.equal(await status(c, 'GET', '/api/products'), 200, `${name} ve productos`);
  }
  assert.equal(await status(admin.client, 'GET', '/api/users'), 200); assert.equal(await status(sup, 'GET', '/api/users'), 200, 'Supervisor tiene users.read');
  assert.equal(await status(rep, 'GET', '/api/users'), 403); assert.equal(await status(pre, 'GET', '/api/users'), 403);
  assert.equal(await status(rep, 'GET', '/api/audit'), 403); assert.equal(await status(sup, 'GET', '/api/audit'), 200);
  // escritura
  assert.equal(await status(rep, 'POST', '/api/clients', { name: 'X' }), 403, 'Repartidor no crea clientes'); assert.equal(await status(pre, 'POST', '/api/clients', { name: 'Cliente de preventa' }), 201, 'Preventista sí (clients.write)');
  assert.equal(await status(sup, 'POST', '/api/clients', { name: 'Cliente supervisor' }), 201);
  assert.equal(await status(rep, 'POST', '/api/products', { sku: 'S', name: 'P' }), 403); assert.equal(await status(sup, 'POST', '/api/products', { sku: 'S1', name: 'P' }), 201);
  // administración: solo Administrador
  for (const [c, expected] of [[sup, 403], [rep, 403], [pre, 403], [admin.client, 201]]) {
    assert.equal(await status(c, 'POST', '/api/centers', { name: `Centro ${expected}-${Math.random()}` }), expected);
  }
  assert.equal(await status(sup, 'POST', '/api/roles', { name: 'R' }), 403); assert.equal(await status(sup, 'POST', '/api/users', {}), 403);
  assert.equal(await status(sup, 'POST', '/api/fiscal/carta-porte', {}), 403); assert.equal(await status(admin.client, 'POST', '/api/fiscal/carta-porte', {}), 400);   // llega a validar el cuerpo
  assert.equal(await status(rep, 'GET', '/api/queue/jobs'), 403);
});

test('el cuerpo del 403 identifica el permiso faltante', async () => {
  const r = await team.Repartidor.client.get('/api/users'); assert.equal(r.status, 403); assert.equal(r.body.code, 'PERMISSION_DENIED'); assert.match(r.body.error, /users\.read/);
});

test('editar permisos de un rol aplica de inmediato, sin volver a iniciar sesión', async () => {
  const roles = (await admin.client.get('/api/roles')).body; const rep = roles.find((r) => r.name === 'Repartidor');
  assert.equal(await status(team.Repartidor.client, 'POST', '/api/clients', { name: 'Antes' }), 403);
  const grant = await admin.client.put(`/api/roles/${rep.id}/permissions`, { permissions: [...rep.permissions, 'clients.write'] }); assert.equal(grant.status, 200);
  assert.equal(await status(team.Repartidor.client, 'POST', '/api/clients', { name: 'Después' }), 201);
  assert.ok((await team.Repartidor.client.get('/api/session')).body.permissions.includes('clients.write'));
  await admin.client.put(`/api/roles/${rep.id}/permissions`, { permissions: rep.permissions });
  assert.equal(await status(team.Repartidor.client, 'POST', '/api/clients', { name: 'Revocado' }), 403);
  const log = (await admin.client.get('/api/audit?action=role.permissions_changed')).body; assert.equal(log[0].detail.removed[0], 'clients.write'); assert.equal(log[1].detail.added[0], 'clients.write');
});

test('roles personalizados: crear, asignar, tope de descuento y eliminar', async () => {
  const create = await admin.client.post('/api/roles', { name: 'Auditor', description: 'Solo lectura', maxDiscountBp: 250, permissions: ['clients.read', 'audit.read', 'reports.read'] });
  assert.equal(create.status, 201); assert.equal(create.body.isSystem, false);
  assert.equal((await admin.client.post('/api/roles', { name: 'Auditor' })).status, 409);
  assert.equal((await admin.client.post('/api/roles', { name: 'Malo', permissions: ['inexistente.x'] })).status, 422);
  assert.equal((await admin.client.post('/api/roles', { name: 'Malo2', maxDiscountBp: 20000 })).status, 422);
  const aud = await createUser(app, admin, { email: 'auditor@permisos.mx', role: 'Auditor' });
  assert.equal(aud.session.maxDiscountBp, 250); assert.deepEqual(aud.session.permissions.sort(), ['audit.read', 'clients.read', 'reports.read']);
  assert.equal(await status(aud.client, 'GET', '/api/audit'), 200); assert.equal(await status(aud.client, 'GET', '/api/products'), 403);
  assert.equal((await admin.client.delete(`/api/roles/${create.body.id}`)).body.code, 'ROLE_IN_USE');
  await admin.client.patch(`/api/users/${aud.user.id}/status`, { status: 'INACTIVE' });
  const reassign = (await admin.client.get('/api/roles')).body.find((r) => r.name === 'Repartidor');
  await admin.client.put(`/api/users/${aud.user.id}`, { roleId: reassign.id });
  assert.equal((await admin.client.delete(`/api/roles/${create.body.id}`)).status, 200);
});

test('roles de sistema: no se eliminan ni se renombran; el administrador no puede quedarse sin permisos de gestión', async () => {
  const roles = (await admin.client.get('/api/roles')).body; const adm = roles.find((r) => r.name === 'Administrador');
  assert.equal((await admin.client.delete(`/api/roles/${adm.id}`)).body.code, 'ROLE_SYSTEM');
  assert.equal((await admin.client.put(`/api/roles/${adm.id}`, { name: 'Jefe' })).body.code, 'ROLE_SYSTEM');
  const strip = await admin.client.put(`/api/roles/${adm.id}/permissions`, { permissions: adm.permissions.filter((p) => p !== 'roles.manage') });
  assert.equal(strip.status, 409); assert.equal(strip.body.code, 'LAST_ADMIN');
  assert.ok((await admin.client.get('/api/roles')).body.find((r) => r.name === 'Administrador').permissions.includes('roles.manage'));
  assert.equal((await admin.client.put(`/api/roles/${adm.id}`, { maxDiscountBp: 9000 })).status, 200);
});

test('el catálogo de permisos que alimenta al editor está completo y agrupado', async () => {
  const cat = (await team.Repartidor.client.get('/api/permissions')).body; assert.equal(cat.length, CATALOG.length);
  for (const code of ['deliveries.execute', 'payments.collect', 'discounts.apply', 'credit.authorize', 'prices.read', 'routes.approve', 'users.manage', 'devices.manage', 'config.publish']) assert.ok(cat.some((p) => p.code === code), code);
  assert.ok(cat.every((p) => p.group && p.label));
});

test('crear usuarios: validaciones, correo único y centros de la propia empresa', async () => {
  const roles = (await admin.client.get('/api/roles')).body; const roleId = roles.find((r) => r.name === 'Repartidor').id; const centerId = admin.session.centers[0].id;
  const mk = (extra) => admin.client.post('/api/users', { name: 'Nuevo', email: 'nuevo@permisos.mx', password: PASSWORD, roleId, centerIds: [centerId], ...extra });
  assert.equal((await mk({ password: 'debil' })).body.code, 'PASSWORD_WEAK'); assert.equal((await mk({ email: 'x' })).body.code, 'EMAIL_INVALID');
  assert.equal((await mk({ roleId: '00000000-0000-4000-8000-000000000000' })).body.code, 'ROLE_INVALID'); assert.equal((await mk({ centerIds: ['00000000-0000-4000-8000-000000000000'] })).body.code, 'CENTER_INVALID');
  assert.equal((await mk({ name: '' })).status, 422);
  assert.equal((await mk()).status, 201); assert.equal((await mk()).status, 409);
  assert.equal((await mk({ email: 'NUEVO@permisos.mx' })).status, 409, 'el correo es único sin distinguir mayúsculas');
});
