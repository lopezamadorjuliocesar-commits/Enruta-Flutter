'use strict';
// Cola persistente en SQLite (jobs_queue): estados, reintentos con backoff y recuperación tras reinicio (DT-48).
const os = require('os');
const { iso } = require('../utils/ids');

/** Un handler lanza PermanentError para pasar el trabajo a DEAD sin más reintentos. */
class PermanentError extends Error {}

const backoffMs = (attempts) => Math.min(2 ** attempts * 2000, 5 * 60_000);

function createQueue({ store, config, handlers = {}, now = () => Date.now(), logger = console }) {
  const workerId = `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
  let timer = null; let recoverTimer = null; let current = null; let again = false; let stopped = false;
  const registered = { ...handlers };

  async function enqueue(job) {
    const runAt = iso(job.runAt ?? now());
    const row = await store.tx((r) => r.jobs.enqueue({ ...job, runAt, now: iso(now()), maxAttempts: job.maxAttempts ?? config.queueMaxAttempts }));
    kick();
    return row;
  }

  /** Procesa un trabajo. Devuelve el trabajo tratado o null si no había nada listo. */
  async function runOne() {
    const stamp = iso(now());
    const job = await store.tx((r) => r.jobs.claim({ now: stamp, lockedBy: workerId, lockedUntil: iso(now() + config.queueLeaseSeconds * 1000) }));
    if (!job) return null;
    const handler = registered[job.type];
    try {
      if (!handler) throw new PermanentError(`No hay handler para el tipo ${job.type}.`);
      const out = await handler(JSON.parse(job.payload), job);
      await store.tx((r) => r.jobs.succeed(job.id, iso(now()), out?.scrubPayload === true));
      return { id: job.id, type: job.type, status: 'SUCCEEDED' };
    } catch (error) {
      const dead = error instanceof PermanentError || job.attempts >= job.max_attempts;
      await store.tx((r) => r.jobs.fail(job.id, { error: error.message, dead, runAt: iso(now() + backoffMs(job.attempts)), now: iso(now()) }));
      if (!dead) logger.warn?.(`[cola] ${job.type} ${job.id} falló (intento ${job.attempts}/${job.max_attempts}): ${error.message}`);
      return { id: job.id, type: job.type, status: dead ? 'DEAD' : 'PENDING', error: error.message };
    }
  }

  /** Procesa todo lo que esté listo ahora mismo. Una sola pasada a la vez; si llegan trabajos durante la pasada, se repite. */
  function drain() {
    if (current) { again = true; return current; }
    current = (async () => {
      let n = 0;
      try { do { again = false; while (!stopped && (await runOne())) n++; } while (again && !stopped); return n; } finally { current = null; }
    })();
    return current;
  }
  function kick() {
    if (stopped) return null;
    return drain().catch((e) => logger.error?.('[cola]', e.message));
  }
  async function recover() {
    const out = await store.tx((r) => r.jobs.recoverExpired(iso(now())));
    if (out.recovered || out.dead) logger.warn?.(`[cola] recuperados ${out.recovered} trabajos interrumpidos (${out.dead} sin intentos restantes).`);
    return out;
  }
  /** Espera a que la cola quede sin trabajo listo (para pruebas). */
  async function idle() {
    for (let i = 0; i < 200; i++) {
      if (current) { await current.catch(() => {}); continue; }
      const ready = (await store.read((r) => r.jobs.list({ status: 'PENDING' }))).some((j) => j.run_at <= iso(now()));
      if (!ready) return;
      await kick();
    }
  }

  return {
    enqueue, drain, runOne, recover, idle, kick, register: (type, fn) => { registered[type] = fn; },
    async start() {
      stopped = false; await recover();
      timer = setInterval(() => kick(), config.queuePollMs); timer.unref?.();
      recoverTimer = setInterval(() => recover().catch(() => {}), 60_000); recoverTimer.unref?.();
      kick();
    },
    async stop() { stopped = true; clearInterval(timer); clearInterval(recoverTimer); try { await current; } catch { /* nada */ } },
    stats: () => store.read((r) => r.jobs.stats()),
  };
}

module.exports = { createQueue, PermanentError, backoffMs };
