'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const BACKEND_ROOT = path.resolve(__dirname, '..', '..');

/** Una variable vacía o solo con espacios cuenta como NO definida (DT-32). */
function envStr(env, name, fallback) {
  const v = env[name];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback;
}
function envInt(env, name, fallback) {
  const n = Number(envStr(env, name, ''));
  return Number.isFinite(n) && envStr(env, name, '') !== '' ? n : fallback;
}
function envBool(env, name, fallback) {
  const v = envStr(env, name, '');
  if (v === '') return fallback;
  return ['1', 'true', 'yes', 'si', 'sí', 'on'].includes(v.toLowerCase());
}

/**
 * Carga un archivo .env rellenando SOLO variables ausentes o vacías: nunca pisa un valor real
 * que ya venga del entorno, y un valor vacío del entorno (p. ej. `IDOO_API_KEY=` heredado de
 * docker-compose) no impide usar el del archivo (DT-32).
 */
function loadEnvFile(file, env = process.env) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  let parsed = {};
  try { parsed = require('dotenv').parse(text); } catch { return []; }
  const applied = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof env[k] !== 'string' || env[k].trim() === '') { if (v !== '') { env[k] = v; applied.push(k); } }
  }
  return applied;
}

// Token público de Mapbox (pk.*): es público por diseño, ya estaba en el repositorio. Restringirlo por URL en Mapbox.
const DEFAULT_MAPBOX_PUBLIC_TOKEN = 'pk.eyJ1IjoianVsaW9jZXNhcmxvcGV6YW1kb3IiLCJhIjoiY213YjVxcXNjMDA2czMwb2NpZTMwcDU3cSJ9.PQmJ73qmNNfrAxLN8X6tRw';
const DEV_ENCRYPTION_KEY = 'enruta-dev-only-encryption-key-change-me';

function createConfig(env = process.env, overrides = {}) {
  const nodeEnv = envStr(env, 'NODE_ENV', 'development');
  const production = nodeEnv === 'production';
  const idooApiKey = envStr(env, 'IDOO_API_KEY', '');
  const publicWebUrl = envStr(env, 'PUBLIC_WEB_URL', 'http://localhost:4200').replace(/\/+$/, '');
  const cfg = {
    nodeEnv, production,
    host: envStr(env, 'HOST', '0.0.0.0'),
    port: envInt(env, 'PORT', 3000),
    dbPath: envStr(env, 'DB_PATH', path.join(BACKEND_ROOT, 'data', 'enruta.sqlite')),
    storageDir: envStr(env, 'STORAGE_DIR', path.join(BACKEND_ROOT, 'storage')),
    publicWebUrl,
    publicApiUrl: envStr(env, 'PUBLIC_API_URL', 'http://localhost:3000').replace(/\/+$/, ''),
    corsOrigins: [...new Set([publicWebUrl, 'http://localhost:4200', 'http://127.0.0.1:4200', ...envStr(env, 'CORS_ORIGINS', '').split(',').map((s) => s.trim()).filter(Boolean)])],
    cookieSecure: envBool(env, 'COOKIE_SECURE', false),
    sessionIdleMinutes: envInt(env, 'SESSION_IDLE_MINUTES', 12 * 60),
    sessionMaxDays: envInt(env, 'SESSION_MAX_DAYS', 7),
    sessionShortHours: envInt(env, 'SESSION_SHORT_HOURS', 12),
    bcryptCost: envInt(env, 'BCRYPT_COST', 12),
    maxFailedLogins: envInt(env, 'MAX_FAILED_LOGINS', 5),
    lockMinutes: envInt(env, 'LOCK_MINUTES', 15),
    resetTokenMinutes: envInt(env, 'RESET_TOKEN_MINUTES', 15),
    resetCooldownSeconds: envInt(env, 'RESET_COOLDOWN_SECONDS', 60),
    mfaChallengeMinutes: 5,
    rateLimit: envBool(env, 'RATE_LIMIT', true),
    loginIpMax: envInt(env, 'LOGIN_MAX_PER_IP_15MIN', 20),
    dataEncryptionKey: envStr(env, 'DATA_ENCRYPTION_KEY', production ? '' : DEV_ENCRYPTION_KEY),
    mailMode: envStr(env, 'MAIL_MODE', production ? 'smtp' : 'local').toLowerCase(),
    mailFrom: envStr(env, 'MAIL_FROM', envStr(env, 'SMTP_USER', 'EnRuta <no-reply@enruta.local>')),
    smtp: { host: envStr(env, 'SMTP_HOST', ''), port: envInt(env, 'SMTP_PORT', 587), user: envStr(env, 'SMTP_USER', ''), pass: envStr(env, 'SMTP_PASS', ''), secure: envStr(env, 'SMTP_SECURE', '') },
    rfcMode: envStr(env, 'RFC_MODE', idooApiKey ? 'idoo' : 'local').toLowerCase(),
    rfcLocalTimeoutMs: envInt(env, 'RFC_LOCAL_TIMEOUT_MS', 300),
    idoo: { apiKey: idooApiKey, baseUrl: envStr(env, 'IDOO_BASE_URL', 'https://idoo.dev/v1/valida-rfc'), timeoutMs: envInt(env, 'IDOO_TIMEOUT_MS', 30000), retries: envInt(env, 'IDOO_MAX_RETRIES', 1) },
    validationTokenMinutes: Math.ceil(envInt(env, 'RFC_VALIDATION_TTL_SECONDS', 1800) / 60),
    pacMode: envStr(env, 'PAC_MODE', 'local').toLowerCase(),
    mapboxPublicToken: envStr(env, 'MAPBOX_PUBLIC_TOKEN', DEFAULT_MAPBOX_PUBLIC_TOKEN),
    gpsStaleSeconds: envInt(env, 'GPS_STALE_SECONDS', 120),
    gpsOfflineSeconds: envInt(env, 'GPS_OFFLINE_SECONDS', 900),
    simulatorEnabled: envBool(env, 'SIMULATOR_ENABLED', !production),
    simulatorStepSeconds: envInt(env, 'SIMULATOR_STEP_SECONDS', 5),
    queuePollMs: envInt(env, 'QUEUE_POLL_MS', 1000),
    queueLeaseSeconds: envInt(env, 'QUEUE_LEASE_SECONDS', 60),
    queueMaxAttempts: envInt(env, 'QUEUE_MAX_ATTEMPTS', 5),
    ...overrides,
  };
  return cfg;
}

/** Errores de configuración que impiden arrancar en producción. */
function validateConfig(cfg) {
  const errors = [];
  if (cfg.production && !cfg.dataEncryptionKey) errors.push('Define DATA_ENCRYPTION_KEY en producción.');
  if (cfg.production && cfg.mailMode === 'local') errors.push('MAIL_MODE=local no está permitido en producción.');
  if (!['local', 'smtp'].includes(cfg.mailMode)) errors.push('MAIL_MODE debe ser local o smtp.');
  if (!['local', 'idoo'].includes(cfg.rfcMode)) errors.push('RFC_MODE debe ser local o idoo.');
  if (!['local', 'sandbox', 'live'].includes(cfg.pacMode)) errors.push('PAC_MODE debe ser local, sandbox o live.');
  return errors;
}

function isLoopbackUrl(url) { return /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:|\/|$)/i.test(url); }
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}

module.exports = { createConfig, validateConfig, loadEnvFile, envStr, isLoopbackUrl, lanAddresses, BACKEND_ROOT };
