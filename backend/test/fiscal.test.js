'use strict';
// Cola local (sin Redis) aplicada a Carta Porte + adaptadores de RFC y honestidad operativa.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, registerCompany, createUser } = require('./helpers');
const { createRfcAdapter } = require('../src/adapters/rfc');
const { createConfig } = require('../src/config');

const IDCCP = 'CCCA1B2C-1234-4234-8234-123456789ABC';
const body = (over = {}) => ({ folio: 'CP-1', idCcp: IDCCP, data: { tipo: 'T' }, xml: `<?xml version="1.0"?><cfdi:Comprobante><cartaporte31:CartaPorte Version="3.1" IdCCP="${IDCCP}"/></cfdi:Comprobante>`, ...over });

let app; let admin;
test.before(async () => { app = await startApp(); admin = await registerCompany(app, { name: 'Fiscal SA', email: 'admin@fiscal.mx' }); });
test.after(async () => { await app.stop(); app.cleanup(); });

test('Carta Porte se timbra en la cola local y en modo local queda "Simulado": sin UUID fiscal ni timbre', async () => {
  const r = await admin.client.post('/api/fiscal/carta-porte', body()); assert.equal(r.status, 202); assert.equal(r.body.queued, true);
  await app.rt.queue.idle();
  const doc = (await admin.client.get(`/api/fiscal/carta-porte/${r.body.document.id}`)).body;
  assert.equal(doc.status, 'Simulado'); assert.equal(doc.simulated, true); assert.equal(doc.pac_uuid, null); assert.equal(doc.attempts, 1); assert.equal(doc.error_message, null);
  const xml = await admin.client.get(`/api/fiscal/carta-porte/${doc.id}/xml`); assert.equal(xml.status, 409); assert.equal(xml.body.code, 'NOT_STAMPED');
  const jobs = (await admin.client.get('/api/queue/jobs?type=CARTA_PORTE_STAMP')).body; assert.equal(jobs.length, 1); assert.equal(jobs[0].status, 'SUCCEEDED');
  assert.equal((await admin.client.get('/api/fiscal/carta-porte')).body.length, 1);
});

test('reenviar el mismo IdCCP es idempotente (no duplica documento ni trabajo)', async () => {
  const again = await admin.client.post('/api/fiscal/carta-porte', body()); assert.equal(again.status, 202); assert.equal(again.body.queued, false);
  await app.rt.queue.idle(); assert.equal((await admin.client.get('/api/fiscal/carta-porte')).body.length, 1);
  assert.equal((await admin.client.get('/api/queue/jobs?type=CARTA_PORTE_STAMP')).body.length, 1);
});

test('validaciones del documento y aislamiento por empresa', async () => {
  assert.equal((await admin.client.post('/api/fiscal/carta-porte', body({ idCcp: 'mal' }))).status, 400);
  assert.equal((await admin.client.post('/api/fiscal/carta-porte', body({ xml: '<!DOCTYPE x [<!ENTITY a "b">]><a/>' }))).status, 400);
  const doc = (await admin.client.get('/api/fiscal/carta-porte')).body[0]; const other = await registerCompany(app, { name: 'Fiscal Dos SA', email: 'dos@fiscal.mx' });
  assert.equal((await other.client.get(`/api/fiscal/carta-porte/${doc.id}`)).status, 404); assert.deepEqual((await other.client.get('/api/fiscal/carta-porte')).body, []);
  const rep = await createUser(app, admin, { email: 'rep@fiscal.mx', role: 'Repartidor' }); assert.equal((await rep.client.get('/api/fiscal/carta-porte')).status, 403);
  assert.equal((await admin.client.get('/api/fiscal/carta-porte/no-es-uuid')).status, 400);
});

test('un PAC real que falla reintenta con backoff y termina en Error (se puede reenviar)', async () => {
  process.env.PAC_MODE = 'live'; process.env.PAC_API_URL = 'http://127.0.0.1:9/pac'; process.env.PAC_API_TOKEN = 't';
  const realFetch = global.fetch; let calls = 0;
  global.fetch = async (url, opts) => { if (String(url).startsWith('http://127.0.0.1:9')) { calls++; throw new Error('PAC caído'); } return realFetch(url, opts); };
  try {
    const idCcp = 'CCCA1B2C-1234-4234-8234-123456789ABD'; const r = await admin.client.post('/api/fiscal/carta-porte', body({ idCcp, folio: 'CP-2', xml: body().xml.replaceAll(IDCCP, idCcp) }));
    await app.rt.queue.idle();
    let doc = (await admin.client.get(`/api/fiscal/carta-porte/${r.body.document.id}`)).body; assert.equal(doc.status, 'EnCola'); assert.equal(doc.attempts, 1); assert.match(doc.error_message, /PAC/);
    for (let i = 0; i < 4; i++) { app.clock.advance(6 * 60_000); await app.rt.queue.drain(); }
    doc = (await admin.client.get(`/api/fiscal/carta-porte/${r.body.document.id}`)).body; assert.equal(doc.status, 'Error'); assert.equal(doc.attempts, 5); assert.equal(calls, 5); assert.equal(doc.pac_uuid, null);
    const job = (await admin.client.get('/api/queue/jobs?status=DEAD')).body; assert.equal(job.length, 1); assert.match(job[0].lastError, /PAC/);
    const retry = await admin.client.post('/api/fiscal/carta-porte', body({ idCcp, folio: 'CP-2', xml: body().xml.replaceAll(IDCCP, idCcp) })); assert.equal(retry.body.queued, true);
  } finally { global.fetch = realFetch; process.env.PAC_MODE = 'local'; delete process.env.PAC_API_URL; delete process.env.PAC_API_TOKEN; }
});

test('PAC live sin configuración se rechaza con 503 en lugar de simular', async () => {
  process.env.PAC_MODE = 'live'; delete process.env.PAC_API_URL;
  try { const r = await admin.client.post('/api/fiscal/carta-porte', body({ idCcp: 'CCCA1B2C-1234-4234-8234-123456789ABE', xml: body().xml.replaceAll(IDCCP, 'CCCA1B2C-1234-4234-8234-123456789ABE') })); assert.equal(r.status, 503); assert.equal(r.body.code, 'PAC_NOT_CONFIGURED'); }
  finally { process.env.PAC_MODE = 'local'; }
});

test('health declara los modos reales: RFC, correo y PAC locales figuran como simulados', async () => {
  const h = (await app.client().get('/api/health')).body; assert.equal(h.ok, true);
  assert.equal(h.modes.rfc.simulated, true); assert.equal(h.modes.mail.simulated, true); assert.equal(h.modes.pac.simulated, true); assert.match(h.modes.rfc.label, /Simulado/);
  assert.ok('PENDING' in h.queue && 'DEAD' in h.queue);
});

test('adaptador idoo: sandbox ⇒ SIMULATED (nunca VERIFIED); producción ⇒ VERIFIED; sin clave ⇒ error de configuración', async () => {
  const resp = (data) => ({ status: 200, headers: new Headers(), json: async () => ({ valid: true, status: 200, message: 'ok', data }) });
  const mk = (key, valido, simulado) => createRfcAdapter(createConfig({}, { rfcMode: 'idoo', idoo: { apiKey: key, baseUrl: 'http://x', timeoutMs: 100, retries: 0 } }), { fetchImpl: async () => resp({ rfc: 'AAA200101AA1', valido, simulado, resultado: valido ? 'RFC válido' : 'EL Nombre o Razón Social y CP no coinciden' }) });
  const input = { rfc: 'AAA200101AA1', nombre: 'X', cp: '91000' };
  const sb = await mk('idoo_sk_test_abc', true, true).validate(input); assert.equal(sb.status, 'SIMULATED'); assert.equal(sb.simulated, true);
  const live = await mk('idoo_sk_live_abc', true, false).validate(input); assert.equal(live.status, 'VERIFIED'); assert.equal(live.simulated, false);
  assert.equal((await mk('idoo_sk_live_abc', false, false).validate(input)).status, 'MISMATCH');
  const none = createRfcAdapter(createConfig({}, { rfcMode: 'idoo', idoo: { apiKey: '' } })); const r = await none.validate(input);
  assert.equal(r.status, 'ERROR'); assert.equal(r.code, 'PROVIDER_NOT_CONFIGURED'); assert.equal(none.describe().configured, false);
  const down = createRfcAdapter(createConfig({}, { rfcMode: 'idoo', idoo: { apiKey: 'idoo_sk_live_x', baseUrl: 'http://x', timeoutMs: 50, retries: 0 } }), { fetchImpl: async () => { throw new Error('red caída'); } });
  assert.equal((await down.validate(input)).status, 'ERROR');
});
