'use strict';
// Escenario de campo reutilizable: empresa, administrador, operador con dispositivo vinculado, productos con precio y una ruta en ejecución.
const crypto = require('crypto');
const { registerCompany, createUser } = require('./helpers');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 9)]);

async function setupField(app, { name = 'Campo SA', email = `admin-${crypto.randomUUID().slice(0, 6)}@campo.mx`, start = true, stops = 2 } = {}) {
  const admin = await registerCompany(app, { name, email });
  const op = await createUser(app, admin, { email: `op-${crypto.randomUUID().slice(0, 6)}@campo.mx`, role: 'Repartidor', name: 'Operador Campo' });
  const coords = [[19.5, -96.9], [19.6, -96.8], [19.7, -96.7]];
  const clients = []; for (let i = 0; i < stops; i++) clients.push((await admin.client.post('/api/clients', { name: `Cliente ${i + 1}`, code: `K-${i + 1}`, lat: coords[i][0], lng: coords[i][1] })).body);
  const products = [(await admin.client.post('/api/products', { sku: 'AGU', name: 'Agua', price: 10 })).body, (await admin.client.post('/api/products', { sku: 'REF', name: 'Refresco', price: 25.5 })).body];
  let route = (await admin.client.post('/api/routes', { name: `Ruta ${crypto.randomUUID().slice(0, 4)}`, day: 'Lunes', operatorId: op.user.id })).body;
  route = (await admin.client.put(`/api/routes/${route.id}/stops`, { revision: route.revision, clientIds: clients.map((c) => c.id) })).body;
  await admin.client.post(`/api/routes/${route.id}/submit`, { revision: route.revision }); await admin.client.post(`/api/routes/${route.id}/approve`, { revision: route.revision });
  const q = (await admin.client.post('/api/devices/link-qr')).body;
  const link = await fetch(app.baseUrl + '/api/mobile/v1/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: q.token, model: 'Pixel', serial: `FLD-${crypto.randomUUID().slice(0, 8)}` }) }).then((r) => r.json());
  const devToken = link.deviceToken;
  /** Llamada del repartidor: Bearer + X-Device-Token + Idempotency-Key (única salvo que se indique). */
  const call = (method, url, body, { key, headers = {}, raw = false, as = op.client } = {}) => as.request(method, url, body, { raw, headers: { 'X-Device-Token': devToken, ...(method !== 'GET' && key !== null ? { 'Idempotency-Key': key || crypto.randomUUID() } : {}), ...headers } });
  if (start) await call('POST', `/api/mobile/v1/routes/${route.id}/start`, {});
  const here = (i, dLat = 0) => ({ lat: coords[i][0] + dLat, lng: coords[i][1] });
  return { admin, op, clients, products, route, devToken, call, coords, here, PNG, JPG };
}
module.exports = { setupField, PNG, JPG };
