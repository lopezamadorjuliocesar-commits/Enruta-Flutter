'use strict';
// createRepositories(conn) → todos los repositorios. Los servicios solo dependen de esta forma (DT-04).
const parts = ['core', 'auth', 'system', 'catalog', 'fiscal'].map((n) => require(`./sqlite/${n}`));
module.exports = function createRepositories(conn) {
  return Object.assign({}, ...parts.map((p) => p(conn)));
};
