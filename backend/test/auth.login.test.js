'use strict';
// Sesiones validadas en backend, bloqueo por intentos, expiración, revocación, 2FA y CSRF.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, registerCompany, createUser, PASSWORD } = require('./helpers');
const { totp } = require('../src/utils/totp');
const { sha256 } = require('../src/utils/ids');

let app; let admin;
test.before(async () => { app = await startApp(); admin = await registerCompany(app, { name: 'Login SA', email: 'admin@login.mx', mode: 'web' }); });
test.after(async () => { await app.stop(); app.cleanup(); });

test('rutas protegidas exigen sesión y el cliente no puede declarar su identidad', async () => {
  const anon = app.client();
  for (const url of ['/api/session', '/api/users', '/api/clients', '/api/roles', '/api/audit']) { const r = await anon.get(url); assert.equal(r.status, 401, url); assert.equal(r.body.code, 'NO_SESSION'); }
  const r = await anon.get('/api/session', { headers: { 'x-api-key': 'dev-admin-key', 'x-company': 'login-sa', Authorization: 'Bearer inventado' } });
  assert.equal(r.status, 401);                                       // la antigua llave administrativa ya no existe
});

test('login correcto, mensaje genérico ante fallo y misma respuesta para correo inexistente', async () => {
  const c = app.client();
  let r = await c.post('/api/auth/login', { email: 'admin@login.mx', password: PASSWORD }); assert.equal(r.status, 200); assert.equal(r.body.session.user.email, 'admin@login.mx'); assert.ok(r.body.token);
  const wrong = await app.client().post('/api/auth/login', { email: 'admin@login.mx', password: 'Incorrecta-123' });
  const ghost = await app.client().post('/api/auth/login', { email: 'nadie@login.mx', password: 'Incorrecta-123' });
  assert.equal(wrong.status, 401); assert.equal(ghost.status, 401); assert.deepEqual(wrong.body, ghost.body);
  assert.equal((await app.client().post('/api/auth/login', { email: 'admin@login.mx' })).status, 401);
  assert.equal((await app.client().post('/api/auth/login', {})).status, 401);
  assert.equal((await app.client().post('/api/auth/login', { email: 'ADMIN@login.mx ', password: PASSWORD })).status, 200);   // el correo se normaliza
});

test('anti-CSRF: una petición mutante sin X-EnRuta-Client se rechaza aunque lleve cookie válida', async () => {
  const web = app.client({ mode: 'web' }); await web.post('/api/auth/login', { email: 'admin@login.mx', password: PASSWORD });
  const r = await web.post('/api/auth/logout', {}, { noClientHeader: true }); assert.equal(r.status, 403); assert.equal(r.body.code, 'CSRF');
  assert.equal((await web.get('/api/session')).status, 200);        // la sesión sigue viva
  assert.equal((await web.post('/api/auth/logout')).status, 200);
});

test('logout revoca la sesión en el servidor: el token deja de servir (también copiado a otro cliente)', async () => {
  const c = app.client(); await c.post('/api/auth/login', { email: 'admin@login.mx', password: PASSWORD });
  const copy = app.client(); copy.token = c.token;
  assert.equal((await copy.get('/api/session')).status, 200);
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  const r = await copy.get('/api/session'); assert.equal(r.status, 401); assert.equal(r.body.code, 'SESSION_REVOKED');
});

test('bloqueo tras 5 intentos fallidos: ni la contraseña correcta entra hasta que vence; no revela el bloqueo', async () => {
  const u = await createUser(app, admin, { email: 'lock@login.mx', role: 'Repartidor' });
  const c = app.client();
  for (let i = 0; i < 4; i++) assert.equal((await c.post('/api/auth/login', { email: 'lock@login.mx', password: 'Mala-clave-1' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: 'lock@login.mx', password: PASSWORD })).status, 200, 'al 4º fallo aún no bloquea y un acierto reinicia el contador');
  for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { email: 'lock@login.mx', password: 'Mala-clave-1' });
  const locked = await c.post('/api/auth/login', { email: 'lock@login.mx', password: PASSWORD }); assert.equal(locked.status, 401); assert.equal(locked.body.code, 'INVALID_CREDENTIALS');
  const list = (await admin.client.get('/api/users')).body.find((x) => x.email === 'lock@login.mx'); assert.equal(list.locked, true);
  assert.ok((await admin.client.get('/api/notifications')).body.some((n) => n.category === 'Críticas' && /bloque/i.test(n.title)));
  assert.ok((await admin.client.get('/api/audit?action=auth.locked')).body.length >= 1);
  app.clock.advance(14 * 60_000); assert.equal((await c.post('/api/auth/login', { email: 'lock@login.mx', password: PASSWORD })).status, 401);
  app.clock.advance(2 * 60_000); assert.equal((await c.post('/api/auth/login', { email: 'lock@login.mx', password: PASSWORD })).status, 200);
});

test('los fallos antiguos (fuera de la ventana de 15 min) no se acumulan', async () => {
  await createUser(app, admin, { email: 'ventana@login.mx' }); const c = app.client();
  for (let i = 0; i < 4; i++) await c.post('/api/auth/login', { email: 'ventana@login.mx', password: 'Mala-clave-1' });
  app.clock.advance(16 * 60_000);
  for (let i = 0; i < 4; i++) await c.post('/api/auth/login', { email: 'ventana@login.mx', password: 'Mala-clave-1' });
  assert.equal((await c.post('/api/auth/login', { email: 'ventana@login.mx', password: PASSWORD })).status, 200);
});

test('expiración por inactividad y absoluta; la actividad renueva la inactividad', async () => {
  const own = await startApp();                                      // reloj propio: avanzar días no debe afectar a las demás pruebas
  await registerCompany(own, { name: 'Tiempo SA', email: 'admin@tiempo.mx' });
  const c = own.client(); await c.post('/api/auth/login', { email: 'admin@tiempo.mx', password: PASSWORD });
  own.clock.advance(11 * 60 * 60_000); assert.equal((await c.get('/api/session')).status, 200);   // actividad a las 11 h
  own.clock.advance(11 * 60 * 60_000);                                                            // 22 h en total, pero solo 11 h de inactividad…
  const r = await c.get('/api/session'); assert.equal(r.status, 401); assert.equal(r.body.code, 'SESSION_EXPIRED');   // …sin "mantener sesión" el tope absoluto es de 12 h
  const keep = own.client(); await keep.post('/api/auth/login', { email: 'admin@tiempo.mx', password: PASSWORD, keepSession: true });
  for (let i = 0; i < 6; i++) { own.clock.advance(11 * 60 * 60_000); assert.equal((await keep.get('/api/session')).status, 200, `salto ${i + 1}`); }   // 66 h con actividad cada 11 h
  own.clock.advance(5 * 24 * 60 * 60_000); assert.equal((await keep.get('/api/session')).body.code, 'SESSION_EXPIRED');
  const idle = own.client(); await idle.post('/api/auth/login', { email: 'admin@tiempo.mx', password: PASSWORD, keepSession: true });
  own.clock.advance(13 * 60 * 60_000); assert.equal((await idle.get('/api/session')).body.code, 'SESSION_EXPIRED', 'con "mantener sesión" sigue aplicando el límite de inactividad de 12 h');
  await own.stop(); own.cleanup();
});

test('listar y revocar sesiones propias (otro navegador)', async () => {
  const emp = await createUser(app, admin, { email: 'sesiones@login.mx', mode: 'web' });
  const a = emp.client; const b = app.client({ mode: 'web' });
  await b.post('/api/auth/login', { email: 'sesiones@login.mx', password: PASSWORD });
  const list = (await a.get('/api/auth/sessions')).body; assert.equal(list.length, 2); assert.equal(list.filter((s) => s.current).length, 1);
  const third = app.client({ mode: 'web' }); await third.post('/api/auth/login', { email: 'sesiones@login.mx', password: PASSWORD });
  const other = (await a.get('/api/auth/sessions')).body.find((s) => !s.current);
  assert.equal((await a.delete(`/api/auth/sessions/${other.id}`)).status, 200);
  const r = await a.delete('/api/auth/sessions?others=1'); assert.equal(r.status, 200);
  assert.equal((await b.get('/api/session')).status, 401); assert.equal((await third.get('/api/session')).status, 401); assert.equal((await a.get('/api/session')).status, 200);
  assert.equal((await a.delete('/api/auth/sessions/00000000-0000-4000-8000-000000000000')).status, 404);
  const ajena = await createUser(app, admin, { email: 'ajena@login.mx' });                       // no se puede revocar la sesión de otro usuario
  assert.equal((await a.delete(`/api/auth/sessions/${ajena.session.sessionId}`)).status, 404); assert.equal((await ajena.client.get('/api/session')).status, 200);
  assert.equal((await a.delete('/api/auth/sessions')).status, 400);
});

test('cambio de contraseña: exige la actual, aplica la política y cierra las demás sesiones', async () => {
  const u = await createUser(app, admin, { email: 'cambio@login.mx' }); const other = app.client(); await other.post('/api/auth/login', { email: 'cambio@login.mx', password: PASSWORD });
  assert.equal((await u.client.put('/api/me/password', { currentPassword: 'Incorrecta-123', newPassword: 'Nueva-Clave-456' })).body.code, 'PASSWORD_INCORRECT');
  assert.equal((await u.client.put('/api/me/password', { currentPassword: PASSWORD, newPassword: 'debil' })).body.code, 'PASSWORD_WEAK');
  assert.equal((await u.client.put('/api/me/password', { currentPassword: PASSWORD, newPassword: PASSWORD })).body.code, 'PASSWORD_SAME');
  assert.equal((await u.client.put('/api/me/password', { currentPassword: PASSWORD, newPassword: 'Nueva-Clave-456' })).status, 200);
  assert.equal((await other.get('/api/session')).status, 401); assert.equal((await u.client.get('/api/session')).status, 200);
  assert.equal((await app.client().post('/api/auth/login', { email: 'cambio@login.mx', password: PASSWORD })).status, 401);
  assert.equal((await app.client().post('/api/auth/login', { email: 'cambio@login.mx', password: 'Nueva-Clave-456' })).status, 200);
});

test('perfil: nombre/teléfono libres; el correo exige la contraseña y no puede duplicarse', async () => {
  const u = await createUser(app, admin, { email: 'perfil@login.mx' });
  assert.equal((await u.client.put('/api/me', { name: 'Nombre Nuevo', phone: '5512345678' })).status, 200);
  assert.equal((await u.client.get('/api/session')).body.user.name, 'Nombre Nuevo');
  assert.equal((await u.client.put('/api/me', { email: 'otro@login.mx' })).body.code, 'PASSWORD_INCORRECT');
  assert.equal((await u.client.put('/api/me', { email: 'admin@login.mx', currentPassword: PASSWORD })).status, 409);
  assert.equal((await u.client.put('/api/me', { email: 'otro@login.mx', currentPassword: PASSWORD })).status, 200);
  assert.equal((await app.client().post('/api/auth/login', { email: 'otro@login.mx', password: PASSWORD })).status, 200);
});

test('2FA TOTP: activar, exigir código en el login, intentos limitados y desactivar', async () => {
  const u = await createUser(app, admin, { email: 'mfa@login.mx' });
  const setup = (await u.client.post('/api/auth/mfa/setup')).body; assert.match(setup.secret, /^[A-Z2-7]{32}$/); assert.match(setup.otpauthUrl, /^otpauth:\/\/totp\//);
  const raw = app.rt.store.conn.prepare("SELECT totp_secret_enc FROM users WHERE email='mfa@login.mx'").get().totp_secret_enc;
  assert.ok(!raw.includes(setup.secret)); assert.match(raw, /^v1\./);                                // cifrado en reposo
  assert.equal((await u.client.post('/api/auth/mfa/confirm', { code: '000000' })).body.code, 'MFA_INVALID');
  assert.equal((await u.client.post('/api/auth/mfa/confirm', { code: totp(setup.secret, app.clock()) })).status, 200);
  assert.equal((await u.client.post('/api/auth/mfa/setup')).status, 409);

  const c = app.client(); const first = await c.post('/api/auth/login', { email: 'mfa@login.mx', password: PASSWORD });
  assert.equal(first.body.mfaRequired, true); assert.equal(first.body.token, undefined); assert.equal((await c.get('/api/session')).status, 401, 'sin código no hay sesión');
  assert.equal((await c.post('/api/auth/mfa/verify', { challengeId: first.body.challengeId, code: '123456' })).status, 401);
  const ok = await c.post('/api/auth/mfa/verify', { challengeId: first.body.challengeId, code: totp(setup.secret, app.clock()) }); assert.equal(ok.status, 200);
  assert.equal((await c.get('/api/session')).body.user.totpEnabled, true);
  assert.equal((await c.post('/api/auth/mfa/verify', { challengeId: first.body.challengeId, code: totp(setup.secret, app.clock()) })).status, 401, 'el desafío es de un solo uso');

  const c2 = app.client(); const ch = (await c2.post('/api/auth/login', { email: 'mfa@login.mx', password: PASSWORD })).body.challengeId;
  for (let i = 0; i < 5; i++) await c2.post('/api/auth/mfa/verify', { challengeId: ch, code: '000000' });
  const locked = await c2.post('/api/auth/mfa/verify', { challengeId: ch, code: totp(setup.secret, app.clock()) }); assert.equal(locked.body.code, 'MFA_LOCKED');
  const c3 = app.client(); const ch3 = (await c3.post('/api/auth/login', { email: 'mfa@login.mx', password: PASSWORD })).body.challengeId;
  app.clock.advance(6 * 60_000); assert.equal((await c3.post('/api/auth/mfa/verify', { challengeId: ch3, code: totp(setup.secret, app.clock()) })).body.code, 'MFA_EXPIRED');

  assert.equal((await c.post('/api/auth/mfa/disable', { code: '000000' })).status, 422);
  assert.equal((await c.post('/api/auth/mfa/disable', { code: totp(setup.secret, app.clock()) })).status, 200);
  assert.equal((await app.client().post('/api/auth/login', { email: 'mfa@login.mx', password: PASSWORD })).body.mfaRequired, undefined);
});

test('TOTP cumple los vectores de RFC 6238 (SHA-1)', () => {
  const { base32Encode } = require('../src/utils/totp');
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  const { totp: gen } = require('../src/utils/totp');
  assert.equal(gen(secret, 59_000), '287082'); assert.equal(gen(secret, 1111111109_000), '081804'); assert.equal(gen(secret, 2000000000_000), '279037');
});

test('las sesiones guardan solo el hash del token', async () => {
  const c = app.client(); await c.post('/api/auth/login', { email: 'admin@login.mx', password: PASSWORD });
  const row = app.rt.store.conn.prepare('SELECT token_hash FROM sessions WHERE token_hash=?').get(sha256(c.token));
  assert.ok(row); assert.equal(app.rt.store.conn.prepare('SELECT 1 FROM sessions WHERE token_hash=?').get(c.token), undefined);
  assert.equal(app.rt.store.conn.prepare("SELECT password_hash h FROM users WHERE email='admin@login.mx'").get().h.startsWith('$2'), true);   // bcrypt
});

test('foto de perfil: se guarda en disco (no en SQLite), solo imágenes reales y se sirve con sesión', async () => {
  const u = await createUser(app, admin, { email: 'foto@login.mx' });
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  let r = await u.client.request('POST', '/api/me/avatar', png, { raw: true, headers: { 'Content-Type': 'image/png' } }); assert.equal(r.status, 200);
  const stored = app.rt.store.conn.prepare("SELECT avatar_path FROM users WHERE email='foto@login.mx'").get().avatar_path; assert.match(stored, /^avatars\/.+\.png$/);
  const got = await fetch(app.baseUrl + '/api/me/avatar', { headers: { Authorization: `Bearer ${u.client.token}` } }); assert.equal(got.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await got.arrayBuffer()), png);
  assert.equal((await fetch(app.baseUrl + '/api/me/avatar')).status, 401);
  r = await u.client.request('POST', '/api/me/avatar', Buffer.from('<script>alert(1)</script>'), { raw: true, headers: { 'Content-Type': 'image/png' } }); assert.equal(r.status, 422);
  assert.equal((await u.client.get('/api/session')).body.user.hasAvatar, true);
});
