'use strict';
// Pruebas del backend. Usan un servidor HTTP LOCAL que imita el contrato documentado de idoo.dev
// (no es una consulta real al SAT). Requieren PostgreSQL en DATABASE_URL.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://enruta:enruta@localhost:5433/enruta';
const test = require('node:test'); const assert = require('node:assert'); const http = require('http');
const pool = require('../src/db'); const migrate = require('../src/migrate');

let mode = {}; let calls = 0;
const provider = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
    calls++; const body = JSON.parse(b || '{}'); const m = mode;
    if (m.http) { res.writeHead(m.http, { 'content-type': 'application/json', ...(m.headers || {}) }); return res.end(JSON.stringify({ valid: false, status: m.http, error: 'x' })); }
    res.writeHead(200, { 'content-type': 'application/json', 'x-idoo-cuota-restante': '40' });
    res.end(JSON.stringify({ valid: true, status: 200, message: m.resultado, data: { rfc: body.rfc, nombre: body.nombre, cp: body.cp || null, resultado: m.resultado, valido: m.valido, simulado: !!m.simulado } }));
  });
});
let svc; const RFC = 'FCE130603EX5';
test.before(async () => {
  await new Promise((r) => provider.listen(0, r));
  process.env.IDOO_BASE_URL = `http://127.0.0.1:${provider.address().port}/v1/valida-rfc`;
  process.env.IDOO_API_KEY = 'idoo_sk_live_TEST'; process.env.IDOO_MAX_RETRIES = '0'; process.env.IDOO_LOCAL_RATE_PER_MIN = '100';
  await migrate(); await pool.query('TRUNCATE companies, company_validations CASCADE');
  svc = require('../src/services/companyValidation.service');
});
test.after(async () => { provider.close(); await pool.end(); });
const run = (o) => svc.validateRfc({ rfc: RFC, razonSocial: 'EMPRESA UNO', codigoPostal: '', ...o });
const reset = async () => { await pool.query('DELETE FROM company_validations'); svc._internal.resetLimiter(); calls = 0; };

test('1 formato incorrecto', async () => { const r = await run({ rfc: 'ABC123' }); assert.equal(r.httpStatus, 422); assert.equal(r.body.code, 'RFC_BAD_FORMAT'); assert.equal(calls, 0); });
test('1b fecha inválida', async () => { const r = await run({ rfc: 'ABC131399XYZ' }); assert.equal(r.body.code, 'RFC_BAD_DATE'); });
test('2 persona física rechazada', async () => { const r = await run({ rfc: 'XAXX010101000' }); assert.equal(r.body.code, 'RFC_NOT_MORAL'); assert.equal(calls, 0); });
test('3 RFC reconocido (real) => VERIFIED con token', async () => { await reset(); mode = { valido: true, resultado: 'RFC válido, y susceptible de recibir facturas' }; const r = await run({}); assert.equal(r.body.code, 'VERIFIED'); assert.equal(r.body.verified, true); assert.ok(r.body.validationToken); assert.equal(r.body.simulated, false); });
test('4 RFC no reconocido', async () => { await reset(); mode = { valido: false, resultado: 'RFC no registrado' }; const r = await run({}); assert.equal(r.body.code, 'REJECTED'); assert.equal(r.body.verified, false); assert.equal(r.body.validationToken, undefined); });
test('5/6 razón social o CP diferente', async () => { await reset(); mode = { valido: false, resultado: 'EL Nombre o Razón Social y CP no coinciden con lo registrado en el RFC' }; const r = await run({ codigoPostal: '14738' }); assert.equal(r.body.code, 'MISMATCH'); assert.equal(r.body.verified, false); });
test('7 error de conexión != RFC inexistente', async () => { await reset(); mode = { http: 502 }; let r = await run({}); assert.equal(r.body.code, 'PROVIDER_ERROR'); assert.notEqual(r.body.code, 'REJECTED'); mode = { http: 504 }; await reset(); r = await run({}); assert.equal(r.body.code, 'PROVIDER_ERROR'); });
test('8 API key incorrecta', async () => { await reset(); mode = { http: 403 }; const r = await run({}); assert.equal(r.body.code, 'PROVIDER_AUTH'); assert.equal(r.body.verified, false); });
test('9 límite alcanzado (402 y 429)', async () => { await reset(); mode = { http: 402 }; let r = await run({}); assert.equal(r.body.code, 'QUOTA_EXHAUSTED'); await reset(); mode = { http: 429, headers: { 'retry-after': '30' } }; r = await run({}); assert.equal(r.httpStatus, 429); });
test('9b límite local por minuto', async () => { await reset(); process.env.IDOO_LOCAL_RATE_PER_MIN = '1'; mode = { valido: false, resultado: 'x' }; await run({ razonSocial: 'A' }); const r = await run({ razonSocial: 'B' }); assert.equal(r.body.code, 'LOCAL_RATE_LIMIT'); process.env.IDOO_LOCAL_RATE_PER_MIN = '100'; });
test('10 sandbox permite un alta explícitamente simulada, no una verificación real', async () => {
  await reset();
  process.env.IDOO_API_KEY = 'idoo_sk_test_TEST';
  mode = { valido: true, simulado: true, resultado: 'RFC válido (simulado)' };
  const validation = await run({});
  assert.equal(validation.body.code, 'SIMULATED');
  assert.equal(validation.body.verified, false);
  assert.equal(validation.body.simulated, true);
  assert.ok(validation.body.validationToken);

  const companyData = {
    validationToken: validation.body.validationToken,
    rfc: RFC,
    razonSocial: 'EMPRESA UNO',
    adminEmail: 'sandbox@example.com',
    adminName: 'Admin Sandbox',
  };
  const registered = await svc.registerCompany(companyData);
  assert.equal(registered.httpStatus, 201);
  assert.equal(registered.body.company.fiscal_status, 'SIMULATED');

  const reused = await svc.registerCompany(companyData);
  assert.equal(reused.httpStatus, 409);

  process.env.IDOO_API_KEY = 'idoo_sk_live_TEST';
  const wrongEnvironment = await svc.registerCompany({
    ...companyData,
    validationToken: validation.body.validationToken,
    adminEmail: 'sandbox-live@example.com',
  });
  assert.equal(wrongEnvironment.httpStatus, 403);
  await pool.query('DELETE FROM companies WHERE rfc=$1', [RFC]);
});
test('caché: consulta repetida no consume cuota', async () => { await reset(); mode = { valido: true, resultado: 'ok' }; await run({}); await run({}); assert.equal(calls, 1); });
test('11 mismo RFC dos veces + 12 registro sin validación', async () => {
  await reset(); mode = { valido: true, resultado: 'ok' };
  const none = await svc.registerCompany({ rfc: RFC, razonSocial: 'EMPRESA UNO', adminEmail: 'a@b.co', adminName: 'A' }); assert.equal(none.httpStatus, 403);
  const forged = await svc.registerCompany({ validationToken: 'abc.def.ghi', rfc: RFC, razonSocial: 'EMPRESA UNO', adminEmail: 'a@b.co', adminName: 'A' }); assert.equal(forged.httpStatus, 403);
  const v = await run({}); const base = { validationToken: v.body.validationToken, rfc: RFC, razonSocial: 'EMPRESA UNO', adminEmail: 'a@b.co', adminName: 'A' };
  const changed = await svc.registerCompany({ ...base, razonSocial: 'OTRA EMPRESA' }); assert.equal(changed.body.code, 'VALIDATION_MISMATCH');
  const ok = await svc.registerCompany(base); assert.equal(ok.httpStatus, 201); assert.equal(ok.body.company.fiscal_status, 'VERIFIED');
  const again = await svc.registerCompany(base); assert.equal(again.httpStatus, 409);
  const dup = await run({}); assert.equal(dup.httpStatus, 409); assert.equal(dup.body.code, 'RFC_ALREADY_REGISTERED');
});
