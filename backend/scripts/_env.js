'use strict';
const path = require('path');
const { createConfig, validateConfig, loadEnvFile, BACKEND_ROOT } = require('../src/config');
module.exports = function loadConfig() {
  loadEnvFile(path.join(BACKEND_ROOT, '.env'));
  const config = createConfig(process.env); const errors = validateConfig(config);
  if (errors.length) { console.error('Configuración inválida:\n - ' + errors.join('\n - ')); process.exit(1); }
  return config;
};
