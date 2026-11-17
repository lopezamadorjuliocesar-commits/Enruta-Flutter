'use strict';
// Pruebas del cliente con un fetch inyectado (sin red).
const test = require('node:test'); const assert = require('node:assert');
const { createIdooClient, IdooError } = require('../src/clients/idoo.client');

const res = (status, body, headers = {}) => ({ status, headers: { get: (h) => headers[h.toLowerCase()] ?? null }, json: async () => body });
function make(responses, extra = {}) {
  const calls = []; const sleeps = []; let i = 0;
  const fetchImpl = async (url, init) => { calls.push({ url, init }); const r = responses[Math.min(i++, responses.length - 1)]; if (r instanceof Error) throw r; return r; };
  return { calls, sleeps, client: createIdooClient({ apiKey: 'idoo_sk_test_x', fetchImpl, sleep: async (ms) => { sleeps.push(ms); }, ...extra }) };
}
const ok = (valido = true, extra = {}) => res(200, { valid: true, status: 200, message: 'm', data: { rfc: 'FCA130603EX5', nombre: null, cp: null, resultado: 'RFC válido', valido, simulado: true, idoo: { ambiente: 'sandbox' }, ...extra } }, { 'x-idoo-cuota-restante': '49' });

test('validar: URL, método, Bearer, body y veredicto desde data.valido', async () => {
  const { client, calls } = make([ok(false)]);
  const r = await client.validar({ rfc: 'FCA130603EX5', nombre: 'X', cp: '14738' });
  assert.equal(calls[0].url, 'https://idoo.dev/v1/valida-rfc/validar'); assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer idoo_sk_test_x');
  assert.deepEqual(JSON.parse(calls[0].init.body), { rfc: 'FCA130603EX5', nombre: 'X', cp: '14738' });
  assert.equal(r.valido, false); assert.equal(r.simulado, true); assert.equal(r.quotaRemaining, 49); assert.equal(client.environment(), 'SANDBOX');
});
test('401/403 => AUTH sin reintentos', async () => { for (const s of [401, 403]) { const { client, calls } = make([res(s, { valid: false, status: s, message: 'k', error: 'x' })]); await assert.rejects(client.validar({ rfc: 'A' }), (e) => e instanceof IdooError && e.code === 'AUTH'); assert.equal(calls.length, 1); } });
test('402 => QUOTA_EXHAUSTED sin reintentos', async () => { const { client, calls } = make([res(402, { valid: false, status: 402, message: 'c', data: { periodo_reinicia: '2026-12-01' } })]); await assert.rejects(client.validar({ rfc: 'A' }), (e) => e.code === 'QUOTA_EXHAUSTED' && e.payload.data.periodo_reinicia === '2026-12-01'); assert.equal(calls.length, 1); });
test('422 => INVALID_INPUT sin reintentos y con código del gateway', async () => { const { client, calls } = make([res(422, { valid: false, status: 422, message: 'f', error: 'rfc_formato_invalido' })]); await assert.rejects(client.validar({ rfc: 'A' }), (e) => e.code === 'INVALID_INPUT' && e.providerError === 'rfc_formato_invalido'); assert.equal(calls.length, 1); });
test('429 con Retry-After corto: espera y reintenta una vez', async () => { const { client, calls, sleeps } = make([res(429, { valid: false, status: 429, message: 'r' }, { 'retry-after': '2' }), ok()]); const r = await client.validar({ rfc: 'A' }); assert.equal(r.valido, true); assert.equal(calls.length, 2); assert.deepEqual(sleeps, [2000]); });
test('429 con Retry-After largo: lanza RATE_LIMIT con retryAfter', async () => { const { client, calls } = make([res(429, { valid: false, status: 429, message: 'r' }, { 'retry-after': '45' })]); await assert.rejects(client.validar({ rfc: 'A' }), (e) => e.code === 'RATE_LIMIT' && e.retryAfter === 45 && e.transient); assert.equal(calls.length, 1); });
test('502 reintenta con backoff exponencial y se recupera', async () => { const { client, calls, sleeps } = make([res(502, { valid: false, status: 502, message: 's', error: 'sat_inalcanzable' }), res(504, { valid: false, status: 504, message: 't' }), ok()]); const r = await client.validar({ rfc: 'A' }); assert.equal(r.valido, true); assert.equal(calls.length, 3); assert.deepEqual(sleeps, [1000, 2000]); });
test('502 persistente: se rinde tras maxRetries (UPSTREAM)', async () => { const { client, calls } = make([res(502, { valid: false, status: 502, message: 's' })]); await assert.rejects(client.validar({ rfc: 'A' }), (e) => e.code === 'UPSTREAM' && e.transient); assert.equal(calls.length, 3); });
test('error de red => NETWORK tras reintentos; abort => TIMEOUT', async () => {
  let m = make([new TypeError('fetch failed')], { maxRetries: 1 }); await assert.rejects(m.client.validar({ rfc: 'A' }), (e) => e.code === 'NETWORK'); assert.equal(m.calls.length, 2);
  const abort = Object.assign(new Error('a'), { name: 'AbortError' }); m = make([abort], { maxRetries: 0 }); await assert.rejects(m.client.validar({ rfc: 'A' }), (e) => e.code === 'TIMEOUT');
});
test('sin key => AUTH y sin llamada; respuesta sin data.valido => BAD_RESPONSE', async () => {
  const c = createIdooClient({ apiKey: '', fetchImpl: async () => { throw new Error('no debe llamarse'); } }); await assert.rejects(c.validar({ rfc: 'A' }), (e) => e.code === 'AUTH');
  const { client } = make([res(200, { valid: true, status: 200, data: {} })]); await assert.rejects(client.validar({ rfc: 'A' }), (e) => e.code === 'BAD_RESPONSE');
});
