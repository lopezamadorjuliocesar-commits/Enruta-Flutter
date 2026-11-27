'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, registerCompany, PASSWORD } = require('./helpers');

test('límite por IP en login y recuperación (con RATE_LIMIT activo)', async () => {
  const app = await startApp({ rateLimit: true, loginIpMax: 4 });
  await registerCompany(app, { name: 'Límite SA', email: 'a@limite.mx' });
  const c = app.client(); const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await c.post('/api/auth/login', { email: 'a@limite.mx', password: 'Mala-clave-1' })).status);
  assert.deepEqual(codes, [401, 401, 401, 401, 429, 429]);
  const r = await c.post('/api/auth/login', { email: 'a@limite.mx', password: PASSWORD }); assert.equal(r.status, 429); assert.equal(r.body.code, 'LOGIN_RATE_LIMITED');
  const f = []; for (let i = 0; i < 7; i++) f.push((await app.client().post('/api/auth/forgot-password', { email: 'a@limite.mx' })).status);
  assert.deepEqual(f.slice(0, 5), [200, 200, 200, 200, 200]); assert.equal(f[6], 429);
  await app.stop(); app.cleanup();
});

test('JSON inválido y rutas inexistentes devuelven errores JSON, no HTML ni trazas', async () => {
  const app = await startApp();
  const res = await fetch(app.baseUrl + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-EnRuta-Client': 'web' }, body: '{roto' });
  assert.equal(res.status, 400); assert.equal((await res.json()).code, 'BAD_JSON');
  const c = app.client(); await registerCompany(app, { name: 'Err SA', email: 'e@err.mx' });
  const a = await registerCompany(app, { name: 'Err Dos SA', email: 'e2@err.mx' });
  const nf = await a.client.get('/api/no-existe'); assert.equal(nf.status, 404); assert.equal(nf.body.code, 'NOT_FOUND');
  assert.equal(res.headers.get('x-powered-by'), null);
  await app.stop(); app.cleanup();
});
