'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { spawnSync } = require('child_process');
const { openConnection, migrate, Store } = require('../src/db/sqlite');
const createRepositories = require('../src/repositories');
const { startApp, registerCompany, PASSWORD } = require('./helpers');

const BACKEND = path.resolve(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'enruta-db-'));

test('las migraciones se aplican una sola vez y verifican el checksum', () => {
  const dir = tmp(); const mig = path.join(dir, 'migrations'); fs.mkdirSync(mig);
  fs.writeFileSync(path.join(mig, '001_a.sql'), 'CREATE TABLE a (id INTEGER PRIMARY KEY);');
  const conn = openConnection(':memory:');
  assert.deepEqual(migrate(conn, mig), ['001_a.sql']); assert.deepEqual(migrate(conn, mig), []);
  fs.writeFileSync(path.join(mig, '002_b.sql'), 'CREATE TABLE b (id INTEGER PRIMARY KEY);');
  assert.deepEqual(migrate(conn, mig), ['002_b.sql']);
  fs.writeFileSync(path.join(mig, '001_a.sql'), 'CREATE TABLE a (id INTEGER PRIMARY KEY, extra TEXT);');
  assert.throws(() => migrate(conn, mig), /cambió después de aplicarse/);
  fs.writeFileSync(path.join(mig, '001_a.sql'), 'CREATE TABLE a (id INTEGER PRIMARY KEY);');
  fs.writeFileSync(path.join(mig, '003_c.sql'), 'CREATE TABLE c (id INTEGER PRIMARY KEY); SELEC roto;');
  assert.throws(() => migrate(conn, mig), /Falló la migración 003_c/);
  assert.equal(conn.prepare("SELECT name FROM sqlite_master WHERE name='c'").get(), undefined);   // la migración fallida hizo rollback
  fs.rmSync(dir, { recursive: true });
});

test('el esquema real aplica limpio y activa las claves foráneas', () => {
  const conn = openConnection(':memory:'); const applied = migrate(conn);
  assert.deepEqual(applied, ['001_core.sql', '002_catalog.sql', '003_fiscal.sql', '004_fleet.sql', '005_routes.sql', '006_settings.sql', '007_execution.sql', '008_tracking.sql', '009_pricing.sql', '010_inventory.sql', '011_settlements.sql']);
  assert.equal(conn.pragma('foreign_keys', { simple: true }), 1);
  assert.throws(() => conn.prepare("INSERT INTO centers (id,company_id,name,created_at) VALUES ('c','no-existe','x','t')").run(), /FOREIGN KEY/);
});

test('las transacciones hacen rollback y las lecturas nunca ven una transacción ajena a medias', async () => {
  const conn = openConnection(':memory:'); migrate(conn); const store = new Store(conn, createRepositories);
  const company = { id: 'co1', rfc: 'AAA200101AA1', legalName: 'X', fiscalStatus: 'PENDING' };
  await assert.rejects(store.tx(async (r) => { await r.companies.create(company); throw new Error('falla a medias'); }), /falla a medias/);
  assert.equal(await store.read((r) => r.companies.get('co1')), undefined);
  let seenDuringTx = 'sin-leer';
  const writer = store.tx(async (r) => { await r.companies.create(company); await new Promise((x) => setTimeout(x, 30)); });
  const reader = store.read(async (r) => { seenDuringTx = await r.companies.get('co1'); });   // espera su turno: ve el resultado final, no el intermedio
  await Promise.all([writer, reader]); assert.equal(seenDuringTx.id, 'co1');
});

test('seed:reset exige confirmación, no corre en producción y repone los datos demo', () => {
  const dir = tmp(); const env = { ...process.env, DB_PATH: path.join(dir, 'd.sqlite'), STORAGE_DIR: path.join(dir, 'st'), BCRYPT_COST: '4' };
  const run = (args, extra = {}) => spawnSync(process.execPath, [path.join(BACKEND, 'scripts', 'seed-reset.js'), ...args], { env: { ...env, ...extra }, encoding: 'utf8' });
  let r = run([]); assert.equal(r.status, 1); assert.match(r.stderr, /BORRA/); assert.equal(fs.existsSync(env.DB_PATH), false);
  r = run(['--yes'], { NODE_ENV: 'production', DATA_ENCRYPTION_KEY: 'k'.repeat(32), MAIL_MODE: 'smtp' }); assert.equal(r.status, 1); assert.match(r.stderr, /prohibido/);
  r = run(['--yes']); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /demo@enruta\.mx/);
  const conn = openConnection(env.DB_PATH);
  assert.equal(conn.prepare('SELECT COUNT(*) n FROM companies').get().n, 2);
  assert.equal(conn.prepare('SELECT COUNT(*) n FROM users').get().n, 7);
  conn.prepare("UPDATE users SET name='Cambiado' WHERE email='demo@enruta.mx'").run(); conn.close();
  r = run(['--yes']); assert.equal(r.status, 0, r.stderr);                       // reinicia: revierte el cambio
  const c2 = openConnection(env.DB_PATH); assert.equal(c2.prepare("SELECT name FROM users WHERE email='demo@enruta.mx'").get().name, 'Administrador de prueba'); c2.close();
  fs.rmSync(dir, { recursive: true });
});

test('migrate NO borra datos: arrancar de nuevo conserva todo (escenario 16, backend)', async () => {
  const dir = tmp(); const dbPath = path.join(dir, 'p.sqlite');
  let app = await startApp({ dbPath });
  const admin = await registerCompany(app, { name: 'Persistente SA', email: 'p@persistente.mx' });
  const created = await admin.client.post('/api/clients', { name: 'Cliente persistente', code: 'P-1' }); assert.equal(created.status, 201);
  await app.stop();
  app = await startApp({ dbPath });                                               // "reinicio del backend"
  const c = app.client(); const login = await c.post('/api/auth/login', { email: 'p@persistente.mx', password: PASSWORD });
  assert.equal(login.status, 200);
  const clients = await c.get('/api/clients'); assert.deepEqual(clients.body.map((x) => x.name), ['Cliente persistente']);
  // La sesión anterior (token) también sigue válida tras el reinicio: las sesiones viven en BD, no en memoria.
  const old = app.client(); old.token = admin.client.token; assert.equal((await old.get('/api/session')).status, 200);
  await app.stop(); fs.rmSync(dir, { recursive: true, force: true });
});
