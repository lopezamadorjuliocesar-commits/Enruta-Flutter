'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, registerCompany, createUser } = require('./helpers');

let app; let admin;
test.before(async () => { app = await startApp(); admin = await registerCompany(app, { name: 'Importa SA', email: 'admin@importa.mx' }); });
test.after(async () => { await app.stop(); app.cleanup(); });

test('importar clientes: crea, omite o actualiza según el modo y reporta filas inválidas', async () => {
  const records = [{ name: 'Cliente 1', code: 'C-1', address: 'Calle 1', lat: 19.5, lng: -96.9 }, { name: 'Cliente 2', phone: '228' }, { name: '' }, { name: 'Cliente 3', lat: 19 }, { name: 'Cliente 4', lat: 200, lng: 0 }];
  let r = (await admin.client.post('/api/import/clients', { records, mode: 'omitir' })).body; assert.deepEqual([r.created, r.updated, r.skipped, r.invalid.length], [2, 0, 0, 3]); assert.deepEqual(r.invalid.map((i) => i.row), [3, 4, 5]);
  r = (await admin.client.post('/api/import/clients', { records: [{ name: 'Cliente 1', phone: '999' }, { name: 'cliente 2', address: 'Nueva' }], mode: 'omitir' })).body; assert.deepEqual([r.created, r.updated, r.skipped], [0, 0, 2]);
  r = (await admin.client.post('/api/import/clients', { records: [{ name: 'Otro nombre', code: 'C-1', phone: '999' }, { name: 'cliente 2', address: 'Nueva' }], mode: 'actualizar' })).body; assert.deepEqual([r.created, r.updated, r.skipped], [0, 2, 0]);
  const list = (await admin.client.get('/api/clients')).body; assert.equal(list.length, 2); assert.equal(list.find((c) => c.code === 'C-1').phone, '999'); assert.equal(list.find((c) => c.name.toLowerCase() === 'cliente 2').address, 'Nueva'); assert.equal(list.find((c) => c.code === 'C-1').lat, 19.5, 'un campo vacío no borra el dato existente');
  assert.ok((await admin.client.get('/api/audit?action=import.clients')).body.length >= 3);
});

test('importar productos: SKU opcional (se genera), precio en centavos y duplicados', async () => {
  const r = (await admin.client.post('/api/import/products', { records: [{ name: 'Agua', code: 'AG-1', price: 12.5, category: 'Bebidas', description: '500 ml' }, { name: 'Sin código', price: '3.5' }, { name: 'Sin código 2' }, { name: '' }], mode: 'omitir' })).body;
  assert.deepEqual([r.created, r.invalid.length], [3, 1]);
  const list = (await admin.client.get('/api/products')).body; const agua = list.find((p) => p.sku === 'AG-1'); assert.equal(agua.price, 12.5); assert.equal(agua.description, '500 ml'); assert.ok(list.every((p) => p.sku));
  const again = (await admin.client.post('/api/import/products', { records: [{ name: 'Agua', code: 'AG-1', price: 15 }], mode: 'actualizar' })).body; assert.equal(again.updated, 1); assert.equal((await admin.client.get('/api/products')).body.find((p) => p.sku === 'AG-1').price, 15);
});

test('permisos, centro requerido, aislamiento y baja de registros', async () => {
  const rep = await createUser(app, admin, { email: 'rep@importa.mx', role: 'Repartidor' }); assert.equal((await rep.client.post('/api/import/clients', { records: [] })).status, 403);
  await admin.client.put('/api/session/center', { centerId: null }); assert.equal((await admin.client.post('/api/import/clients', { records: [{ name: 'X' }] })).body.code, 'CENTER_REQUIRED'); await admin.client.put('/api/session/center', { centerId: admin.session.activeCenterId });
  const other = await registerCompany(app, { name: 'Otra Importa SA', email: 'o@importa.mx' }); assert.deepEqual((await other.client.get('/api/clients')).body, []);
  const c = (await admin.client.get('/api/clients')).body[0]; assert.equal((await other.client.delete(`/api/clients/${c.id}`)).status, 404); assert.equal((await admin.client.delete(`/api/clients/${c.id}`)).status, 200);
  const p = (await admin.client.get('/api/products')).body[0]; assert.equal((await admin.client.delete(`/api/products/${p.id}`)).status, 200); assert.equal((await rep.client.delete(`/api/products/${p.id}`)).status, 403);
});
