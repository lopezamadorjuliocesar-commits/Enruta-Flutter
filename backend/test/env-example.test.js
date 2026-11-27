'use strict';
// Fase 4: `.env.example` es la documentación de configuración. Esta prueba impide que se desactualice o que lleve secretos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createConfig, validateConfig, loadEnvFile } = require('../src/config');

const root = path.resolve(__dirname, '..', '..');
const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
const SECRETS = ['IDOO_API_KEY', 'SMTP_PASS', 'PAC_API_TOKEN', 'DATA_ENCRYPTION_KEY', 'MAPBOX_PUBLIC_TOKEN', 'SMTP_USER'];
/** Variables declaradas (activas o comentadas) con su valor de ejemplo. */
const declared = new Map(); for (const line of example.split(/\r?\n/)) { const m = line.match(/^#?\s*([A-Z][A-Z0-9_]+)=(.*)$/); if (m) declared.set(m[1], { value: m[2].trim(), active: !line.startsWith('#') }); }
const sources = ['src/config/index.js', 'src/services/carta-porte-fiscal.js', 'src/adapters/rfc/idoo.client.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n');
const used = new Set([...sources.matchAll(/env(?:Str|Int|Bool)?\(env, '([A-Z0-9_]+)'/g)].map((m) => m[1]).concat([...sources.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1])));
for (const internal of ['NODE_ENV']) used.delete(internal);   // lo fija el entorno de ejecución, aunque el ejemplo también lo declara

test('toda variable que lee el backend está documentada en .env.example', () => {
  const missing = [...used].filter((k) => !declared.has(k)).sort(); assert.deepEqual(missing, [], `variables sin documentar en .env.example: ${missing.join(', ')}`);
});

test('.env.example no contiene secretos y declara solo variables que existen', () => {
  for (const k of SECRETS) if (declared.has(k)) assert.equal(declared.get(k).value, '', `${k} debe ir vacío en el ejemplo`);
  assert.ok(!/idoo_sk_(live|test)_[A-Za-z0-9]{6,}|pk\.[A-Za-z0-9]{20,}|-----BEGIN/.test(example), 'no hay claves reales');
  const unknown = [...declared.keys()].filter((k) => !used.has(k) && !['NODE_ENV'].includes(k)); assert.deepEqual(unknown, [], `variables del ejemplo que el código ya no lee: ${unknown.join(', ')}`);
});

test('el ejemplo, tal cual, produce una configuración válida y segura para desarrollo (modos locales, simulados)', () => {
  const env = {}; for (const [k, v] of declared) if (v.active && v.value !== '') env[k] = v.value;
  const cfg = createConfig(env, { dbPath: ':memory:', storageDir: path.join(require('os').tmpdir(), 'enruta-env-example') });
  assert.deepEqual(validateConfig(cfg), []); assert.deepEqual([cfg.rfcMode, cfg.pacMode, cfg.mailMode], ['local', 'local', 'local']);
  assert.equal(cfg.host, '0.0.0.0', 'el servidor escucha en toda la red para el QR'); assert.equal(cfg.simulatorEnabled, true); assert.deepEqual([cfg.gpsStaleSeconds, cfg.gpsOfflineSeconds], [120, 900]);
});

test('una variable vacía del ejemplo NO pisa una clave real (DT-32)', () => {
  const tmp = path.join(require('os').tmpdir(), `enruta-env-${process.pid}.env`); fs.writeFileSync(tmp, 'IDOO_API_KEY=idoo_sk_test_abcdef123456\n'); const env = { IDOO_API_KEY: '' };
  loadEnvFile(tmp, env); assert.equal(env.IDOO_API_KEY, 'idoo_sk_test_abcdef123456'); fs.rmSync(tmp);
  const real = { IDOO_API_KEY: 'idoo_sk_live_real0000' }; fs.writeFileSync(tmp, 'IDOO_API_KEY=\n'); loadEnvFile(tmp, real); assert.equal(real.IDOO_API_KEY, 'idoo_sk_live_real0000'); fs.rmSync(tmp);
});
