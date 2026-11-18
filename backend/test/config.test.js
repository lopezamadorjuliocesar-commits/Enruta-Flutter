'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { createConfig, loadEnvFile, validateConfig, isLoopbackUrl } = require('../src/config');

test('una variable vacía cuenta como no definida y usa el valor por defecto', () => {
  const c = createConfig({ PORT: '', HOST: '  ', IDOO_API_KEY: '', RFC_MODE: '' });
  assert.equal(c.port, 3000); assert.equal(c.host, '0.0.0.0'); assert.equal(c.rfcMode, 'local');
  assert.equal(createConfig({ IDOO_API_KEY: 'idoo_sk_test_x' }).rfcMode, 'idoo');
});

test('IDOO_API_KEY: un valor vacío del entorno NO sobrescribe la clave real del .env, y un valor real no se pisa', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enruta-env-')); const file = path.join(dir, '.env');
  fs.writeFileSync(file, 'IDOO_API_KEY=idoo_sk_test_desde_archivo\nPORT=4321\nOTRA=valor\n');
  const env = { IDOO_API_KEY: '', PORT: '3999' };     // como docker-compose con `IDOO_API_KEY: ${IDOO_API_KEY:-}`
  const applied = loadEnvFile(file, env);
  assert.equal(env.IDOO_API_KEY, 'idoo_sk_test_desde_archivo');
  assert.equal(env.PORT, '3999');                      // la variable real del entorno gana
  assert.equal(env.OTRA, 'valor'); assert.deepEqual(applied.sort(), ['IDOO_API_KEY', 'OTRA']);
  assert.equal(createConfig(env).idoo.apiKey, 'idoo_sk_test_desde_archivo');
  fs.rmSync(dir, { recursive: true });
});

test('validateConfig: producción exige clave de cifrado y prohíbe el correo local', () => {
  const errs = validateConfig(createConfig({ NODE_ENV: 'production', MAIL_MODE: 'local' }));
  assert.ok(errs.some((e) => /DATA_ENCRYPTION_KEY/.test(e))); assert.ok(errs.some((e) => /MAIL_MODE=local/.test(e)));
  assert.deepEqual(validateConfig(createConfig({ NODE_ENV: 'production', DATA_ENCRYPTION_KEY: 'x'.repeat(32), MAIL_MODE: 'smtp' })), []);
});

test('isLoopbackUrl detecta localhost para advertir en el QR', () => {
  for (const u of ['http://localhost:4200', 'http://127.0.0.1:4200', 'https://localhost']) assert.equal(isLoopbackUrl(u), true);
  for (const u of ['http://192.168.1.50:4200', 'https://app.empresa.mx']) assert.equal(isLoopbackUrl(u), false);
});
