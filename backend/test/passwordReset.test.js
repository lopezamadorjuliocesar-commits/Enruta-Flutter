'use strict';
// No requiere base de datos. El correo se captura con el transporte `jsonTransport` de Nodemailer (sin enviar nada).
const test = require('node:test'); const assert = require('node:assert'); const http = require('http');
const express = require('express'); const nodemailer = require('nodemailer'); const jwt = require('jsonwebtoken');
process.env.FORGOT_PASSWORD_MAX_PER_15MIN = '100'; process.env.FRONTEND_URL = 'http://localhost:4200'; process.env.JWT_SECRET = 'test-secret';
const svc = require('../src/services/passwordReset.service');
const sent = []; const base = nodemailer.createTransport({ jsonTransport: true });
svc._internal.setTransport({ sendMail: async (m) => { sent.push(m); return base.sendMail(m); } });
let server, url;
test.before(async () => { const app = express(); app.use(express.json()); app.use('/api/auth', require('../src/routes/auth.routes')); server = http.createServer(app); await new Promise((r) => server.listen(0, r)); url = `http://127.0.0.1:${server.address().port}/api/auth`; });
test.after(() => server.close());
const H = { 'Content-Type': 'application/json', 'x-api-key': 'dev-admin-key' };
const post = (p, b, h = H) => fetch(url + p, { method: 'POST', headers: h, body: JSON.stringify(b) });
const tokenFromMail = (m) => new URL(/href="([^"]+)"/.exec(m.html)[1]).searchParams.get('token');
const PW = 'NuevaClave1234';

test('forgot-password envía correo con botón "Restablecer" y JWT de 15 min', async () => {
  svc._internal.reset(); sent.length = 0;
  const r = await post('/forgot-password', { email: 'Usuario@Empresa.com' }); assert.equal(r.status, 200);
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'usuario@empresa.com');
  assert.match(sent[0].html, />Restablecer</); assert.match(sent[0].html, /15 minutos/);
  assert.match(sent[0].html, /http:\/\/localhost:4200\/reset-password\?token=/);
  const p = jwt.decode(tokenFromMail(sent[0])); assert.equal(p.email, 'usuario@empresa.com'); assert.ok(p.jti); assert.equal(p.exp - p.iat, 900);
});
test('correo inválido => 422 y sin API key => 401', async () => {
  assert.equal((await post('/forgot-password', { email: 'nope' })).status, 422);
  assert.equal((await post('/forgot-password', { email: 'a@b.co' }, { 'Content-Type': 'application/json' })).status, 401);
});
test('cooldown por correo: segundo envío no manda otro mail', async () => {
  svc._internal.reset(); sent.length = 0;
  await post('/forgot-password', { email: 'a@b.co' }); const r = await post('/forgot-password', { email: 'a@b.co' });
  assert.equal(r.status, 200); assert.equal(sent.length, 1);
});
test('validate-reset-token: válido, inválido y expirado', async () => {
  svc._internal.reset(); const { token } = svc._internal.issueToken('x@y.co');
  let r = await fetch(`${url}/validate-reset-token?token=${token}`, { headers: H }); assert.equal(r.status, 200); assert.equal((await r.json()).email, 'x@y.co');
  r = await fetch(`${url}/validate-reset-token?token=${token}abc`, { headers: H }); assert.equal(r.status, 400);
  const expired = jwt.sign({ typ: 'password-reset', email: 'x@y.co' }, 'test-secret', { expiresIn: -10, jwtid: 'j1' });
  r = await fetch(`${url}/validate-reset-token?token=${expired}`, { headers: H }); assert.equal(r.status, 410); assert.equal((await r.json()).reason, 'EXPIRED');
  const forged = jwt.sign({ typ: 'password-reset', email: 'x@y.co' }, 'otro', { expiresIn: 60, jwtid: 'j2' });
  r = await fetch(`${url}/validate-reset-token?token=${forged}`, { headers: H }); assert.equal(r.status, 400);
  r = await fetch(`${url}/validate-reset-token?token=`, { headers: H }); assert.equal(r.status, 400);
});
test('reset-password: 200 una vez y el jti queda invalidado', async () => {
  svc._internal.reset(); const { token } = svc._internal.issueToken('x@y.co');
  let r = await post('/reset-password', { token, newPassword: PW }); assert.equal(r.status, 200); assert.equal((await r.json()).email, 'x@y.co');
  r = await post('/reset-password', { token, newPassword: PW }); assert.equal(r.status, 410);
  r = await fetch(`${url}/validate-reset-token?token=${token}`, { headers: H }); assert.equal(r.status, 410); assert.equal((await r.json()).reason, 'USED');
});
test('reset-password rechaza contraseña débil sin consumir el token', async () => {
  svc._internal.reset(); const { token } = svc._internal.issueToken('x@y.co');
  assert.equal((await post('/reset-password', { token, newPassword: 'corta' })).status, 422);
  assert.equal((await post('/reset-password', { token, newPassword: PW })).status, 200);
});
test('reset-password: dos peticiones simultáneas, solo una gana', async () => {
  svc._internal.reset(); const { token } = svc._internal.issueToken('x@y.co');
  const rs = await Promise.all([post('/reset-password', { token, newPassword: PW }), post('/reset-password', { token, newPassword: PW })]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 410]);
});
test('fallo SMTP => 502, SMTP ausente => 503', async () => {
  svc._internal.reset(); svc._internal.setTransport({ sendMail: async () => { throw new Error('boom'); } });
  assert.equal((await post('/forgot-password', { email: 'q@w.co' })).status, 502);
  svc._internal.setTransport(null); delete process.env.SMTP_HOST;
  assert.equal((await post('/forgot-password', { email: 'q@w.co' })).status, 503);
});
