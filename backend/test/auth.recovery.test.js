'use strict';
// Escenario 19: recuperación de contraseña con token de un solo uso y bandeja de correo local (otro navegador).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { startApp, registerCompany, createUser, PASSWORD } = require('./helpers');

let app; let admin;
test.before(async () => { app = await startApp(); admin = await registerCompany(app, { name: 'Recupera SA', email: 'admin@recupera.mx' }); });
test.after(async () => { await app.stop(); app.cleanup(); });

const NEW = 'Otra-Clave-789';
const tokenFrom = (msg) => new URL(msg.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
async function request(email, c = app.client()) {
  const r = await c.post('/api/auth/forgot-password', { email }); await app.rt.queue.idle();
  const box = (await app.client({ mode: 'web' }).get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`)).body.messages;   // otro navegador, sin sesión
  return { r, box, token: box[0] ? tokenFrom(box[0]) : null };
}

test('la respuesta es idéntica exista o no el correo, y solo se envía correo a cuentas reales', async () => {
  const known = await request('admin@recupera.mx'); const ghost = await request('fantasma@recupera.mx');
  assert.equal(known.r.status, 200); assert.deepEqual(known.r.body, ghost.r.body);
  assert.equal(known.box.length, 1); assert.equal(ghost.box.length, 0);
  assert.equal((await app.client().post('/api/auth/forgot-password', { email: 'no-es-correo' })).status, 422);
});

test('el correo local está rotulado como MODO LOCAL, lleva el enlace con token y se entrega por la cola', async () => {
  const { box } = await request('admin@recupera.mx');
  assert.equal(box[0].subject, 'Restablece tu contraseña de EnRuta'); assert.match(box[0].text, /^Restablece/); assert.match(box[0].html, /MODO LOCAL/);
  assert.match(box[0].text, /^http:\/\/localhost:4200\/reset-password\?token=/m); assert.match(box[0].text, /un solo uso, expira en 15 minutos/);
  const mb = (await app.client().get('/api/dev/mailbox')).body; assert.match(mb.notice, /MODO LOCAL/); assert.equal(mb.mode, 'LOCAL');
  const jobs = await app.rt.store.read((r) => r.jobs.list({ type: 'SEND_MAIL' })); assert.ok(jobs.length >= 1 && jobs.every((j) => j.status === 'SUCCEEDED'));
  assert.ok(jobs.every((j) => j.payload === '{}'), 'el token no queda guardado en la cola tras enviar');
});

test('flujo completo desde otro navegador: validar, restablecer, sesiones previas revocadas, la clave vieja deja de servir', async () => {
  const u = await createUser(app, admin, { email: 'olvido@recupera.mx' });          // sesión abierta en el "navegador A"
  const { token } = await request('olvido@recupera.mx');
  const browserB = app.client({ mode: 'web' });
  const ok = await browserB.get(`/api/auth/reset-password/validate?token=${encodeURIComponent(token)}`); assert.equal(ok.status, 200); assert.deepEqual(ok.body, { valid: true, email: 'olvido@recupera.mx' });
  assert.equal((await browserB.post('/api/auth/reset-password', { token, newPassword: 'debil' })).body.code, 'PASSWORD_WEAK');
  assert.equal((await browserB.get(`/api/auth/reset-password/validate?token=${encodeURIComponent(token)}`)).status, 200, 'una clave débil no consume el token');
  const done = await browserB.post('/api/auth/reset-password', { token, newPassword: NEW }); assert.equal(done.status, 200); assert.equal(done.body.ok, true);
  assert.equal((await u.client.get('/api/session')).status, 401);                    // la sesión del navegador A cayó
  assert.equal((await app.client().post('/api/auth/login', { email: 'olvido@recupera.mx', password: PASSWORD })).status, 401);
  assert.equal((await app.client({ mode: 'web' }).post('/api/auth/login', { email: 'olvido@recupera.mx', password: NEW })).status, 200);
  const again = await browserB.post('/api/auth/reset-password', { token, newPassword: 'Tercera-Clave-1' }); assert.equal(again.status, 410); assert.equal(again.body.code, 'RESET_USED');
  assert.equal((await browserB.get(`/api/auth/reset-password/validate?token=${encodeURIComponent(token)}`)).body.reason, 'USED');
  assert.ok((await admin.client.get('/api/audit?action=auth.password_reset')).body.length >= 1);
});

test('token inválido, vacío, alterado o expirado', async () => {
  const c = app.client();
  assert.equal((await c.get('/api/auth/reset-password/validate')).body.reason, 'MISSING');
  const bad = await c.get('/api/auth/reset-password/validate?token=inventado'); assert.equal(bad.status, 400); assert.equal(bad.body.reason, 'INVALID');
  assert.equal((await c.post('/api/auth/reset-password', { token: 'inventado', newPassword: NEW })).status, 400);
  const { token } = await request('admin@recupera.mx'); app.clock.advance(61_000);
  const t2 = (await request('admin@recupera.mx')).token; assert.notEqual(t2, token);
  assert.equal((await c.get(`/api/auth/reset-password/validate?token=${encodeURIComponent(token)}`)).body.reason, 'USED', 'pedir otro enlace invalida el anterior');
  app.clock.advance(16 * 60_000);
  const exp = await c.get(`/api/auth/reset-password/validate?token=${encodeURIComponent(t2)}`); assert.equal(exp.status, 410); assert.equal(exp.body.reason, 'EXPIRED');
  assert.equal((await c.post('/api/auth/reset-password', { token: t2, newPassword: NEW })).status, 410);
});

test('enfriamiento: una segunda solicitud inmediata no genera otro correo', async () => {
  await createUser(app, admin, { email: 'cool@recupera.mx' });
  await request('cool@recupera.mx'); const second = await request('cool@recupera.mx');
  assert.equal(second.box.length, 1); app.clock.advance(61_000); assert.equal((await request('cool@recupera.mx')).box.length, 2);
});

test('carrera: dos restablecimientos simultáneos con el mismo token → solo uno gana', async () => {
  await createUser(app, admin, { email: 'carrera@recupera.mx' }); const { token } = await request('carrera@recupera.mx');
  const rs = await Promise.all([app.client().post('/api/auth/reset-password', { token, newPassword: 'Carrera-Uno-111' }), app.client().post('/api/auth/reset-password', { token, newPassword: 'Carrera-Dos-222' })]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 410]);
  const winner = rs.findIndex((r) => r.status === 200) === 0 ? 'Carrera-Uno-111' : 'Carrera-Dos-222';
  assert.equal((await app.client().post('/api/auth/login', { email: 'carrera@recupera.mx', password: winner })).status, 200);
});

test('restablecer limpia el bloqueo por intentos fallidos', async () => {
  await createUser(app, admin, { email: 'bloq@recupera.mx' }); const c = app.client();
  for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { email: 'bloq@recupera.mx', password: 'Mala-clave-1' });
  assert.equal((await c.post('/api/auth/login', { email: 'bloq@recupera.mx', password: PASSWORD })).status, 401);
  const { token } = await request('bloq@recupera.mx'); assert.equal((await c.post('/api/auth/reset-password', { token, newPassword: NEW })).status, 200);
  assert.equal((await c.post('/api/auth/login', { email: 'bloq@recupera.mx', password: NEW })).status, 200);
});

test('el token sobrevive a un reinicio del backend y sigue siendo de un solo uso (antes vivía en memoria)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enruta-rec-')); const dbPath = path.join(dir, 'r.sqlite');
  let a = await startApp({ dbPath }); await registerCompany(a, { name: 'Reinicio SA', email: 'x@reinicio.mx' });
  await a.client().post('/api/auth/forgot-password', { email: 'x@reinicio.mx' }); await a.rt.queue.idle();
  const token = tokenFrom((await a.client().get('/api/dev/mailbox')).body.messages[0]);
  assert.equal((await a.client().post('/api/auth/reset-password', { token, newPassword: NEW })).status, 200);
  await a.stop(); a = await startApp({ dbPath });
  const r = await a.client().post('/api/auth/reset-password', { token, newPassword: 'Tercera-Clave-1' }); assert.equal(r.status, 410, 'el token usado sigue invalidado tras reiniciar');
  assert.equal((await a.client().post('/api/auth/login', { email: 'x@reinicio.mx', password: NEW })).status, 200);
  await a.stop(); a.cleanup(); fs.rmSync(dir, { recursive: true, force: true });
});

test('con MAIL_MODE=smtp la bandeja de desarrollo NO existe', async () => {
  const s = await startApp({ mailMode: 'smtp' });
  assert.equal((await s.client().get('/api/dev/mailbox')).status, 401);           // cae en la zona autenticada: la ruta no está registrada
  assert.equal(s.rt.adapters.mail.mode, 'smtp'); await s.stop(); s.cleanup();
});
