'use strict';
// Escenario 1: registro de empresa y administrador (RFC con adaptador local determinista).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, registerCompany, PASSWORD } = require('./helpers');

let app;
test.before(async () => { app = await startApp(); });
test.after(async () => { await app.stop(); app.cleanup(); });

const validate = (c, body) => c.post('/api/companies/validate-rfc', { razonSocial: 'Empresa Uno SA de CV', codigoPostal: '91000', ...body });

test('validación de formato del RFC (sin consultar al proveedor)', async () => {
  const c = app.client();
  let r = await validate(c, { rfc: 'ABC123' }); assert.equal(r.status, 422); assert.equal(r.body.code, 'RFC_BAD_FORMAT');
  r = await validate(c, { rfc: 'ABC131399XYZ' }); assert.equal(r.body.code, 'RFC_BAD_DATE');
  r = await validate(c, { rfc: 'XAXX010101000' }); assert.equal(r.body.code, 'RFC_NOT_MORAL');
  r = await validate(c, { rfc: 'AAA200101AA1', razonSocial: '' }); assert.equal(r.body.code, 'NAME_REQUIRED');
  r = await validate(c, { rfc: 'AAA200101AA1', codigoPostal: '12' }); assert.equal(r.body.code, 'CP_BAD_FORMAT');
});

test('el modo local es determinista y se declara SIMULADO: nunca "verificado"', async () => {
  const c = app.client();
  let r = await validate(c, { rfc: 'AAA200101AA1' });
  assert.equal(r.status, 200); assert.equal(r.body.code, 'SIMULATED'); assert.equal(r.body.simulated, true); assert.equal(r.body.verified, false); assert.equal(r.body.real, false); assert.equal(r.body.environment, 'LOCAL');
  assert.ok(r.body.validationToken);
  r = await validate(c, { rfc: 'REJ200101AA1' }); assert.equal(r.body.code, 'REJECTED'); assert.equal(r.body.validationToken, undefined);
  r = await validate(c, { rfc: 'MIS200101AA1' }); assert.equal(r.body.code, 'MISMATCH'); assert.equal(r.body.validationToken, undefined);
  r = await validate(c, { rfc: 'ERR200101AA1' }); assert.equal(r.status, 502); assert.equal(r.body.code, 'PROVIDER_ERROR');
  const t0 = Date.now(); r = await validate(c, { rfc: 'TMO200101AA1' }); assert.equal(r.status, 504); assert.equal(r.body.code, 'PROVIDER_TIMEOUT'); assert.ok(Date.now() - t0 >= 9);
});

test('registro completo: empresa, centro Matriz, 4 roles de sistema, administrador y sesión', async () => {
  const a = await registerCompany(app, { name: 'Alta Completa SA', rfc: 'ACO200101AA1', email: 'alta@completa.mx' });
  assert.equal(a.company.fiscalStatus, 'SIMULATED'); assert.match(a.company.fiscalLabel, /Simulado/);
  assert.equal(a.session.user.role, 'Administrador'); assert.equal(a.session.centers.length, 1); assert.equal(a.session.centers[0].name, 'Matriz');
  assert.equal(a.session.activeCenterId, a.session.centers[0].id);
  assert.ok(a.session.permissions.includes('users.manage') && a.session.permissions.includes('centers.all'));
  const roles = (await a.client.get('/api/roles')).body; assert.deepEqual(roles.map((r) => r.name).sort(), ['Administrador', 'Preventista', 'Repartidor', 'Supervisor']);
  assert.ok(roles.every((r) => r.isSystem));
  const sup = roles.find((r) => r.name === 'Supervisor'); assert.ok(!sup.permissions.includes('users.manage') && sup.permissions.includes('routes.approve'));
  const rep = roles.find((r) => r.name === 'Repartidor'); assert.ok(rep.permissions.includes('deliveries.execute') && !rep.permissions.includes('routes.approve'));
  const audit = (await a.client.get('/api/audit')).body; assert.ok(audit.some((e) => e.action === 'company.registered'));
});

test('la validación es de un solo uso y está atada a RFC + razón social', async () => {
  const c = app.client();
  const v = await validate(c, { rfc: 'BBB200101AA1', razonSocial: 'Empresa B SA' });
  const base = { validationToken: v.body.validationToken, rfc: 'BBB200101AA1', razonSocial: 'Empresa B SA', adminName: 'B Admin', adminEmail: 'b@b.mx', password: PASSWORD };
  let r = await c.post('/api/companies/register', { ...base, razonSocial: 'Otra Razón SA' }); assert.equal(r.status, 403); assert.equal(r.body.code, 'VALIDATION_MISMATCH');
  r = await c.post('/api/companies/register', { ...base, rfc: 'CCC200101AA1' }); assert.equal(r.status, 403);
  r = await c.post('/api/companies/register', { ...base, validationToken: 'inventado' }); assert.equal(r.status, 403); assert.equal(r.body.code, 'VALIDATION_REQUIRED');
  r = await c.post('/api/companies/register', { ...base, validationToken: undefined }); assert.equal(r.status, 403);
  r = await c.post('/api/companies/register', base); assert.equal(r.status, 201);
  r = await c.post('/api/companies/register', base); assert.equal(r.status, 409); assert.equal(r.body.code, 'VALIDATION_USED');
});

test('contraseña débil, correo inválido y duplicados se rechazan', async () => {
  const c = app.client();
  const mk = async (rfc) => (await validate(c, { rfc, razonSocial: 'X SA' })).body.validationToken;
  const body = (t, rfc, extra) => ({ validationToken: t, rfc, razonSocial: 'X SA', adminName: 'A', adminEmail: `${rfc}@x.mx`.toLowerCase(), password: PASSWORD, ...extra });
  let t = await mk('DDD200101AA1');
  let r = await c.post('/api/companies/register', body(t, 'DDD200101AA1', { password: 'corta1A' })); assert.equal(r.status, 422); assert.equal(r.body.code, 'PASSWORD_WEAK');
  r = await c.post('/api/companies/register', body(t, 'DDD200101AA1', { password: 'sinmayuscula123' })); assert.equal(r.status, 422);
  r = await c.post('/api/companies/register', body(t, 'DDD200101AA1', { password: 'SinNumeroAbcdefg' })); assert.equal(r.status, 422);
  r = await c.post('/api/companies/register', body(t, 'DDD200101AA1', { adminEmail: 'no-es-correo' })); assert.equal(r.status, 422); assert.equal(r.body.code, 'EMAIL_INVALID');
  r = await c.post('/api/companies/register', body(t, 'DDD200101AA1', { adminName: '' })); assert.equal(r.status, 422);
  r = await c.post('/api/companies/register', body(t, 'DDD200101AA1')); assert.equal(r.status, 201, 'tras errores de validación el token sigue siendo utilizable');
  // RFC ya registrado
  r = await validate(c, { rfc: 'DDD200101AA1' }); assert.equal(r.status, 409); assert.equal(r.body.code, 'RFC_ALREADY_REGISTERED');
  // correo duplicado
  t = await mk('EEE200101AA1');
  r = await c.post('/api/companies/register', body(t, 'EEE200101AA1', { adminEmail: 'DDD200101AA1@x.mx' })); assert.equal(r.status, 409); assert.equal(r.body.code, 'EMAIL_ALREADY_REGISTERED');
});

test('el token de validación expira', async () => {
  const c = app.client(); const v = await validate(c, { rfc: 'FFF200101AA1', razonSocial: 'F SA' });
  app.clock.advance(31 * 60_000);
  const r = await c.post('/api/companies/register', { validationToken: v.body.validationToken, rfc: 'FFF200101AA1', razonSocial: 'F SA', adminName: 'F', adminEmail: 'f@f.mx', password: PASSWORD });
  assert.equal(r.status, 403); assert.equal(r.body.code, 'VALIDATION_EXPIRED');
});

test('registro desde un navegador: cookie HttpOnly y sin token en el cuerpo', async () => {
  const a = await registerCompany(app, { name: 'Web SA', mode: 'web' });
  assert.equal(a.client.cookie.startsWith('enruta_sid='), true);
  const c = app.client({ mode: 'web' }); const v = await validate(c, { rfc: 'GGG200101AA1', razonSocial: 'G SA' });
  const r = await c.post('/api/companies/register', { validationToken: v.body.validationToken, rfc: 'GGG200101AA1', razonSocial: 'G SA', adminName: 'G', adminEmail: 'g@g.mx', password: PASSWORD });
  assert.equal(r.status, 201); assert.equal(r.body.token, undefined);
  const cookie = r.setCookie.find((x) => x.startsWith('enruta_sid=')); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Path=\/api/);
  assert.equal((await c.get('/api/session')).status, 200);
});
