'use strict';
// REINICIA los datos demo: borra la BD y ./storage, vuelve a migrar y siembra. Es el ÚNICO comando destructivo (DT-02).
// Detén el backend antes de ejecutarlo.
const fs = require('fs');
const config = require('./_env')();
if (config.production) { console.error('seed:reset está prohibido con NODE_ENV=production.'); process.exit(1); }
if (!process.argv.includes('--yes') && process.env.SEED_RESET_CONFIRM !== '1') {
  console.error(`Este comando BORRA ${config.dbPath} y ${config.storageDir}. Confirma con: npm run seed:reset  (incluye --yes) o SEED_RESET_CONFIRM=1.`); process.exit(1);
}
const { openConnection, migrate, Store } = require('../src/db/sqlite');
const createRepositories = require('../src/repositories');
const { CATALOG } = require('../src/services/permissions');
const { seedDemo } = require('../src/seed/demo');

(async () => {
  for (const f of [config.dbPath, `${config.dbPath}-wal`, `${config.dbPath}-shm`]) fs.rmSync(f, { force: true });
  fs.rmSync(config.storageDir, { recursive: true, force: true });
  const conn = openConnection(config.dbPath); migrate(conn);
  const store = new Store(conn, createRepositories);
  await store.tx((r) => r.permissions.sync(CATALOG));
  const s = await seedDemo(store, { bcryptCost: config.bcryptCost });
  store.close();
  console.log(`Datos demo restablecidos en ${config.dbPath}\nContraseña de todos los usuarios demo: ${s.password}`);
  for (const c of s.companies) console.log(`\n${c.name}\n  ${c.users.join('\n  ')}`);
})().catch((e) => { console.error(e); process.exit(1); });
