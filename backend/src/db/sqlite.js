'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

/** Mutex FIFO: una sola conexión SQLite compartida; ninguna lectura debe ver una transacción ajena a medias (DT-04). */
class Mutex {
  constructor() { this.tail = Promise.resolve(); }
  async acquire() {
    let release;
    const next = new Promise((r) => { release = r; });
    const prev = this.tail;
    this.tail = prev.then(() => next);
    await prev;
    return release;
  }
}

function openConnection(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const conn = new Database(dbPath);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.pragma('busy_timeout = 5000');
  conn.pragma('synchronous = NORMAL');
  return conn;
}

/** Aplica migraciones numeradas (solo hacia adelante) verificando checksum de las ya aplicadas. */
function migrate(conn, dir = path.resolve(__dirname, '..', '..', 'migrations')) {
  conn.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const applied = new Map(conn.prepare('SELECT version, checksum FROM schema_migrations').all().map((r) => [r.version, r.checksum]));
  const done = [];
  for (const file of files) {
    const version = file.split('_')[0];
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    if (applied.has(version)) {
      if (applied.get(version) !== checksum) throw new Error(`La migración ${file} cambió después de aplicarse. Crea una migración nueva en lugar de editarla.`);
      continue;
    }
    conn.exec('BEGIN');
    try {
      conn.exec(sql);
      conn.prepare('INSERT INTO schema_migrations (version,name,checksum,applied_at) VALUES (?,?,?,?)').run(version, file, checksum, new Date().toISOString());
      conn.exec('COMMIT');
    } catch (e) { conn.exec('ROLLBACK'); throw new Error(`Falló la migración ${file}: ${e.message}`); }
    done.push(file);
  }
  return done;
}

/**
 * Store: único punto de acceso a datos para servicios.
 *  - read(fn): lectura con exclusión mutua.
 *  - tx(fn):   transacción BEGIN IMMEDIATE … COMMIT/ROLLBACK.
 * Dentro de `fn` NO se debe volver a llamar a read/tx (interbloqueo). Trabajo lento (bcrypt, red) va FUERA.
 * `fn` recibe los repositorios; con PostgreSQL bastará con otra implementación de Store (ver DECISIONES_TECNICAS §4).
 */
class Store {
  constructor(conn, createRepositories) {
    this.conn = conn; this.mutex = new Mutex(); this.createRepositories = createRepositories; this.closed = false;
  }
  async read(fn) {
    const release = await this.mutex.acquire();
    try { return await fn(this.createRepositories(this.conn)); } finally { release(); }
  }
  async tx(fn) {
    const release = await this.mutex.acquire();
    try {
      this.conn.exec('BEGIN IMMEDIATE');
      try {
        const out = await fn(this.createRepositories(this.conn));
        this.conn.exec('COMMIT');
        return out;
      } catch (e) { try { this.conn.exec('ROLLBACK'); } catch { /* ya cerrada */ } throw e; }
    } finally { release(); }
  }
  close() { if (!this.closed) { this.closed = true; this.conn.close(); } }
}

module.exports = { openConnection, migrate, Store, Mutex };
