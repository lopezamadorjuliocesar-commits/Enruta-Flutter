'use strict';
const config = require('./_env')();
const { openConnection, migrate } = require('../src/db/sqlite');
const conn = openConnection(config.dbPath);
const applied = migrate(conn);
console.log(applied.length ? `Migraciones aplicadas: ${applied.join(', ')}` : 'Base de datos al día (sin migraciones pendientes).', `\nBD: ${config.dbPath}`);
conn.close();
