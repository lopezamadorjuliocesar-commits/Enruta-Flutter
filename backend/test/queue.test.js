'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { openConnection, migrate, Store } = require('../src/db/sqlite');
const createRepositories = require('../src/repositories');
const { createQueue, PermanentError, backoffMs } = require('../src/queue/queue');
const { createConfig } = require('../src/config');
const { makeClock, silent } = require('./helpers');

const cfg = createConfig({}, { queueLeaseSeconds: 30, queueMaxAttempts: 3 });
function setup(dbPath = ':memory:') { const conn = openConnection(dbPath); migrate(conn); return new Store(conn, createRepositories); }
const jobOf = (store, id) => store.read((r) => r.jobs.get(id));

test('un trabajo se procesa una vez y queda SUCCEEDED', async () => {
  const store = setup(); const clock = makeClock(); const seen = [];
  const q = createQueue({ store, config: cfg, now: clock, logger: silent, handlers: { PING: async (p) => { seen.push(p.n); } } });
  const job = await q.enqueue({ type: 'PING', payload: { n: 1 } }); await q.idle();
  assert.deepEqual(seen, [1]); assert.equal((await jobOf(store, job.id)).status, 'SUCCEEDED');
  assert.equal((await q.drain()), 0); assert.deepEqual(seen, [1]);   // no se repite
});

test('reintentos con backoff exponencial y paso a DEAD al agotar intentos', async () => {
  const store = setup(); const clock = makeClock(); let calls = 0;
  const q = createQueue({ store, config: cfg, now: clock, logger: silent, handlers: { FAIL: async () => { calls++; throw new Error('boom'); } } });
  const job = await q.enqueue({ type: 'FAIL', payload: {}, maxAttempts: 3 }); await q.idle();
  let j = await jobOf(store, job.id);
  assert.equal(j.status, 'PENDING'); assert.equal(j.attempts, 1); assert.equal(j.last_error, 'boom');
  assert.equal(Date.parse(j.run_at) - clock(), backoffMs(1));     // 4 s
  assert.equal(await q.runOne(), null);                           // aún no toca (run_at en el futuro)
  clock.advance(backoffMs(1)); await q.runOne();
  j = await jobOf(store, job.id); assert.equal(j.attempts, 2); assert.equal(Date.parse(j.run_at) - clock(), backoffMs(2));   // 8 s
  clock.advance(backoffMs(2)); const last = await q.runOne();
  j = await jobOf(store, job.id); assert.equal(last.status, 'DEAD'); assert.equal(j.status, 'DEAD'); assert.equal(calls, 3);
  assert.equal(backoffMs(20), 5 * 60_000);                        // tope de 5 minutos
});

test('PermanentError pasa directo a DEAD y un tipo sin handler también', async () => {
  const store = setup(); const clock = makeClock();
  const q = createQueue({ store, config: cfg, now: clock, logger: silent, handlers: { NOPE: async () => { throw new PermanentError('definitivo'); } } });
  const a = await q.enqueue({ type: 'NOPE', payload: {} }); const b = await q.enqueue({ type: 'DESCONOCIDO', payload: {} }); await q.idle();
  assert.equal((await jobOf(store, a.id)).status, 'DEAD'); assert.equal((await jobOf(store, a.id)).attempts, 1);
  assert.equal((await jobOf(store, b.id)).status, 'DEAD'); assert.match((await jobOf(store, b.id)).last_error, /No hay handler/);
});

test('dedupe_key evita duplicados del mismo tipo', async () => {
  const store = setup(); const clock = makeClock();
  const q = createQueue({ store, config: cfg, now: clock, logger: silent, handlers: { X: async () => {} } });
  const a = await q.enqueue({ type: 'X', payload: {}, dedupeKey: 'k1' }); const b = await q.enqueue({ type: 'X', payload: {}, dedupeKey: 'k1' });
  assert.equal(a.id, b.id); assert.equal((await store.read((r) => r.jobs.list({ type: 'X' }))).length, 1);
});

test('recuperación al reiniciar: un trabajo RUNNING de un proceso caído se reanuda (y no se duplica)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enruta-q-')); const file = path.join(dir, 'q.sqlite'); const clock = makeClock();
  let store = setup(file);
  const job = await store.tx((r) => r.jobs.enqueue({ type: 'WORK', payload: { id: 7 }, runAt: new Date(clock()).toISOString(), now: new Date(clock()).toISOString(), maxAttempts: 3 }));   // directo al repositorio: ningún worker lo toma
  // Simula un proceso que reclama el trabajo y muere sin terminarlo.
  const claimed = await store.tx((r) => r.jobs.claim({ now: new Date(clock()).toISOString(), lockedBy: 'proceso-muerto', lockedUntil: new Date(clock() + 30_000).toISOString() }));
  assert.equal(claimed.id, job.id); assert.equal((await jobOf(store, job.id)).status, 'RUNNING');
  store.close();

  store = setup(file);                                            // "reinicio": nueva conexión al mismo archivo
  const done = [];
  const q2 = createQueue({ store, config: cfg, now: clock, logger: silent, handlers: { WORK: async (p) => { done.push(p.id); } } });
  assert.deepEqual(await q2.recover(), { recovered: 0, dead: 0 });   // el lease sigue vigente: no se roba
  assert.equal(await q2.runOne(), null);
  clock.advance(31_000);                                           // venció el lease
  assert.deepEqual(await q2.recover(), { recovered: 1, dead: 0 });
  await q2.drain();
  assert.deepEqual(done, [7]); assert.equal((await jobOf(store, job.id)).status, 'SUCCEEDED');
  store.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('un trabajo interrumpido sin intentos restantes pasa a DEAD al recuperar', async () => {
  const store = setup(); const clock = makeClock();
  const q = createQueue({ store, config: cfg, now: clock, logger: silent });
  const job = await store.tx((r) => r.jobs.enqueue({ type: 'W', payload: {}, runAt: new Date(clock()).toISOString(), now: new Date(clock()).toISOString(), maxAttempts: 1 }));
  await store.tx((r) => r.jobs.claim({ now: new Date(clock()).toISOString(), lockedBy: 'x', lockedUntil: new Date(clock() + 1000).toISOString() }));
  clock.advance(5000);
  assert.deepEqual(await q.recover(), { recovered: 0, dead: 1 }); assert.equal((await jobOf(store, job.id)).status, 'DEAD');
});

test('los trabajos pendientes persisten entre reinicios del servidor', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enruta-q2-')); const file = path.join(dir, 'q.sqlite'); const clock = makeClock();
  let store = setup(file);
  const q1 = createQueue({ store, config: cfg, now: clock, logger: silent });
  const job = await q1.enqueue({ type: 'LATER', payload: { a: 1 }, runAt: clock() + 60_000 });
  store.close(); store = setup(file);
  const got = []; const q2 = createQueue({ store, config: cfg, now: clock, logger: silent, handlers: { LATER: async (p) => got.push(p.a) } });
  await q2.drain(); assert.deepEqual(got, []);                    // todavía no es su hora
  clock.advance(61_000); await q2.drain(); assert.deepEqual(got, [1]); assert.equal((await jobOf(store, job.id)).status, 'SUCCEEDED');
  store.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('dos trabajadores no reclaman el mismo trabajo (reclamo atómico)', async () => {
  const store = setup(); const clock = makeClock(); let n = 0;
  const mk = () => createQueue({ store, config: cfg, now: clock, logger: silent, handlers: { ONCE: async () => { n++; await new Promise((r) => setTimeout(r, 20)); } } });
  const a = mk(); const b = mk(); await a.enqueue({ type: 'ONCE', payload: {} });
  await Promise.all([a.runOne(), b.runOne()]); assert.equal(n, 1);
});
