'use strict';
/**
 * Consulta fiscal vía idoo.dev (POST /v1/valida-rfc/validar, Bearer).
 * Contrato confirmado en https://idoo.dev/apis/valida-rfc.md:
 *  - body: { rfc, nombre?, cp? }  - respuesta: { valid, status, message, data:{ rfc, nombre, cp, resultado, valido, simulado, idoo } }
 *  - key idoo_sk_test_ => sandbox (simulado, siempre valido:true); idoo_sk_live_ => producción (consulta real al SAT).
 *  - 200 no es veredicto: el veredicto es data.valido. 402 cuota, 429 rate limit, 502/503/504 transitorios.
 * El ambiente se decide SOLO por la API key del servidor; el frontend no envía nada al respecto.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { createIdooClient, IdooError, environmentOf } = require('../clients/idoo.client');
const { checkMoralRfc, normalizeName, normalizeCp, validCp } = require('../utils/rfc');

const cfg = () => ({
  apiKey: process.env.IDOO_API_KEY || '',
  baseUrl: (process.env.IDOO_BASE_URL || 'https://idoo.dev/v1/valida-rfc').replace(/\/$/, ''),
  timeoutMs: Number(process.env.IDOO_TIMEOUT_MS || 30000), // la doc recomienda >= 30 s
  retries: Number(process.env.IDOO_MAX_RETRIES ?? 1),       // cada reintento descuenta cuota: acotado
  perMinute: Number(process.env.IDOO_LOCAL_RATE_PER_MIN || 2), // plan gratuito: 2 peticiones/min
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  tokenTtl: Number(process.env.RFC_VALIDATION_TTL_SECONDS || 1800),
  cacheOkMs: 24 * 3600e3, cacheBadMs: 15 * 60e3,
});

function environment() { return environmentOf(cfg().apiKey); }

// ---- Límite local (protege el rate limit del proveedor) y deduplicación de consultas en vuelo
const stamps = []; const inflight = new Map(); let quotaBlockedUntil = 0;
function localSlot() {
  const { perMinute } = cfg(); const now = Date.now();
  while (stamps.length && now - stamps[0] > 60000) stamps.shift();
  if (stamps.length >= perMinute) return Math.ceil((60000 - (now - stamps[0])) / 1000);
  stamps.push(now); return 0;
}

const out = (status, code, message, extra = {}) => ({ httpStatus: status, body: { ok: status < 400 && extra.verified === true, code, message, ...extra } });
const hashKey = (rfc, nombre, cp) => crypto.createHash('sha256').update([rfc, nombre.toLowerCase(), cp].join('|')).digest('hex');

async function validateRfc(input) {
  const c = cfg();
  const f = checkMoralRfc(input.rfc);
  if (!f.ok) return out(422, f.code, f.message, { verified: false, status: 'FORMAT_ERROR' });
  const nombre = normalizeName(input.razonSocial); const cp = normalizeCp(input.codigoPostal);
  if (!nombre) return out(422, 'NAME_REQUIRED', 'Escribe la razón social tal como aparece en la constancia de situación fiscal.', { verified: false, status: 'FORMAT_ERROR' });
  if (nombre.length > 250) return out(422, 'NAME_TOO_LONG', 'La razón social es demasiado larga.', { verified: false, status: 'FORMAT_ERROR' });
  if (cp && !validCp(cp)) return out(422, 'CP_BAD_FORMAT', 'El código postal debe tener 5 dígitos.', { verified: false, status: 'FORMAT_ERROR' });

  const env = environment();
  if (env === 'NOT_CONFIGURED' || env === 'UNKNOWN')
    return out(503, 'PROVIDER_NOT_CONFIGURED', 'La validación fiscal no está configurada en el servidor.', { verified: false, status: 'PROVIDER_ERROR' });

  const dup = await pool.query('SELECT 1 FROM companies WHERE rfc=$1', [f.rfc]);
  if (dup.rowCount) return out(409, 'RFC_ALREADY_REGISTERED', 'Ya existe una empresa registrada con ese RFC.', { verified: false, status: 'DUPLICATE' });

  const key = hashKey(f.rfc, nombre, cp);
  // Caché: no repetir consultas idénticas (ahorra cuota del plan gratuito)
  const cached = await pool.query(`SELECT * FROM company_validations WHERE request_hash=$1 AND provider_http=200 AND created_at > now() - ($2 * interval '1 millisecond') ORDER BY created_at DESC LIMIT 1`, [key, c.cacheOkMs]);
  const row = cached.rows[0];
  if (row && (row.status === 'VERIFIED' || row.status === 'SIMULATED' || Date.now() - new Date(row.created_at).getTime() < c.cacheBadMs)) return fromRow(row, true);

  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const wait = localSlot();
    if (wait) return out(429, 'LOCAL_RATE_LIMIT', `Se alcanzó el límite de consultas por minuto. Intenta de nuevo en ${wait} s.`, { verified: false, status: 'RATE_LIMITED', retryAfter: wait });
    if (Date.now() < quotaBlockedUntil) return out(402, 'QUOTA_EXHAUSTED', 'Se agotó la cuota mensual de consultas fiscales.', { verified: false, status: 'QUOTA_EXHAUSTED' });
    const client = createIdooClient({ apiKey: c.apiKey, baseUrl: c.baseUrl, timeoutMs: c.timeoutMs, maxRetries: c.retries });
    let result = null; let error = null;
    try { result = await client.validar({ rfc: f.rfc, nombre, cp }); } catch (e) { if (!(e instanceof IdooError)) throw e; error = e; }
    return handleProviderResult(result, error, { rfc: f.rfc, nombre, cp, key, env });
  })().finally(() => inflight.delete(key));
  inflight.set(key, p); return p;
}

function classifyMessage(msg) { return /no coinciden/i.test(msg || ''); }

async function handleProviderResult(result, error, ctx) {
  const { rfc, nombre, cp, key } = ctx; const retry = 'No fue posible consultar el servicio. Inténtalo nuevamente.';
  if (error) {
    console.error('[idoo]', error.code, error.status || '', error.providerError || '');
    switch (error.code) {
      case 'TIMEOUT': return out(504, 'PROVIDER_TIMEOUT', retry, { verified: false, status: 'PROVIDER_ERROR' });
      case 'NETWORK': return out(504, 'PROVIDER_UNREACHABLE', retry, { verified: false, status: 'PROVIDER_ERROR' });
      case 'AUTH': return out(502, 'PROVIDER_AUTH', 'La API Key del servicio fiscal es inválida o no tiene suscripción activa.', { verified: false, status: 'PROVIDER_ERROR' });
      case 'QUOTA_EXHAUSTED': {
        const until = Date.parse(error.payload?.data?.periodo_reinicia || ''); quotaBlockedUntil = Number.isFinite(until) ? until : Date.now() + 3600e3;
        return out(402, 'QUOTA_EXHAUSTED', 'Se agotó la cuota mensual de consultas fiscales.', { verified: false, status: 'QUOTA_EXHAUSTED' });
      }
      case 'RATE_LIMIT': return out(429, 'PROVIDER_RATE_LIMIT', 'El servicio fiscal limitó las consultas. Intenta de nuevo en unos segundos.', { verified: false, status: 'RATE_LIMITED', retryAfter: error.retryAfter });
      case 'INVALID_INPUT': return out(422, 'PROVIDER_REJECTED_INPUT', error.message || 'El servicio fiscal rechazó los datos enviados.', { verified: false, status: 'FORMAT_ERROR' });
      default: return out(502, 'PROVIDER_ERROR', retry, { verified: false, status: 'PROVIDER_ERROR' });
    }
  }
  const simulated = result.simulado === true || ctx.env === 'SANDBOX';
  const production = ctx.env === 'PRODUCTION' && result.simulado === false;
  let status;
  if (simulated && result.valido) status = 'SIMULATED';
  else if (simulated) status = classifyMessage(result.resultado) ? 'MISMATCH' : 'REJECTED';
  else if (result.valido) status = production ? 'VERIFIED' : 'SIMULATED';
  else status = classifyMessage(result.resultado) ? 'MISMATCH' : 'REJECTED';

  const ins = await pool.query(`INSERT INTO company_validations (rfc, razon_social, cp, request_hash, status, provider_valid, provider_message, simulated, environment, quota_remaining, provider_http)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,200) RETURNING *`, [rfc, nombre, cp || null, key, status, result.valido, result.resultado.slice(0, 500), simulated, ctx.env, result.quotaRemaining]);
  return fromRow(ins.rows[0], false);
}

const MESSAGES = {
  VERIFIED: 'RFC validado correctamente.',
  SIMULATED: 'Resultado simulado: puedes continuar con el alta de prueba, pero no se verificó ante el SAT.',
  REJECTED: 'El RFC no pudo ser confirmado ante el servicio fiscal.',
  MISMATCH: 'La razón social o el código postal no coinciden con los datos fiscales.',
};
function fromRow(row, cached) {
  const verified = row.status === 'VERIFIED' && !row.simulated;
  const sandboxSimulation = row.status === 'SIMULATED' && row.simulated && row.environment === 'SANDBOX' && row.provider_valid === true;
  const body = { ok: verified, verified, code: row.status, status: row.status, message: MESSAGES[row.status] || 'Consulta procesada.',
    simulated: row.simulated, real: !row.simulated, environment: row.environment, cached, providerMessage: row.provider_message, rfc: row.rfc };
  if (verified || sandboxSimulation) {
    body.validationToken = jwt.sign({
      typ: sandboxSimulation ? 'rfc-validation-sandbox' : 'rfc-validation',
      vid: row.id,
      rfc: row.rfc,
      nh: crypto.createHash('sha256').update(row.razon_social.toLowerCase()).digest('hex'),
    }, cfg().jwtSecret, { algorithm: 'HS256', expiresIn: cfg().tokenTtl });
  }
  return { httpStatus: 200, body };
}

/** El token real solo se emite tras verificar el RFC; sandbox permite altas explícitamente no verificadas. */
async function registerCompany(b) {
  const bad = (status, code, message) => ({ httpStatus: status, body: { ok: false, code, message } });
  let t; try { t = jwt.verify(String(b.validationToken || ''), cfg().jwtSecret, { algorithms: ['HS256'] }); } catch { return bad(403, 'VALIDATION_REQUIRED', 'Debes validar el RFC antes de registrar la empresa.'); }
  const sandboxToken = t.typ === 'rfc-validation-sandbox';
  if (t.typ !== 'rfc-validation' && !sandboxToken) return bad(403, 'VALIDATION_REQUIRED', 'Debes validar el RFC antes de registrar la empresa.');
  if (sandboxToken && environment() !== 'SANDBOX') return bad(403, 'VALIDATION_REQUIRED', 'La validación de prueba solo puede usarse en modo sandbox.');
  if (!sandboxToken && environment() !== 'PRODUCTION') return bad(403, 'VALIDATION_REQUIRED', 'La validación real solo puede usarse en modo producción.');
  const rfc = checkMoralRfc(b.rfc).rfc; const nombre = normalizeName(b.razonSocial);
  const email = String(b.adminEmail || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(422, 'EMAIL_INVALID', 'Escribe un correo válido.');
  if (!String(b.adminName || '').trim()) return bad(422, 'ADMIN_REQUIRED', 'Falta el nombre del administrador.');
  if (rfc !== t.rfc || crypto.createHash('sha256').update(nombre.toLowerCase()).digest('hex') !== t.nh) return bad(403, 'VALIDATION_MISMATCH', 'Los datos cambiaron después de validar. Vuelve a validar el RFC.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const v = (await client.query('SELECT * FROM company_validations WHERE id=$1 FOR UPDATE', [t.vid])).rows[0];
    const validForEnvironment = sandboxToken
      ? v?.status === 'SIMULATED' && v.simulated && v.environment === 'SANDBOX' && v.provider_valid === true
      : v?.status === 'VERIFIED' && !v.simulated && v.environment === 'PRODUCTION';
    if (!validForEnvironment) { await client.query('ROLLBACK'); return bad(403, 'VALIDATION_REQUIRED', 'La validación fiscal no corresponde al modo de ejecución o no fue satisfactoria.'); }
    if (v.consumed_at) { await client.query('ROLLBACK'); return bad(409, 'VALIDATION_USED', 'Esta validación ya se utilizó.'); }
    const s = (x) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, 200) : null);
    const fiscalStatus = sandboxToken ? 'SIMULATED' : 'VERIFIED';
    const r = await client.query(`INSERT INTO companies (rfc, razon_social, giro, country, timezone, admin_name, admin_email, phone, fiscal_status, fiscal_verified_at, validation_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $9='VERIFIED' THEN now() ELSE NULL END,$10) RETURNING id, rfc, fiscal_status`, [rfc, nombre, s(b.industry), s(b.country), s(b.timezone), s(b.adminName), email, s(b.phone), fiscalStatus, v.id]);
    await client.query('UPDATE company_validations SET consumed_at=now() WHERE id=$1', [v.id]);
    await client.query('COMMIT');
    return { httpStatus: 201, body: { ok: true, company: r.rows[0] } };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return bad(409, e.constraint?.includes('email') ? 'EMAIL_ALREADY_REGISTERED' : 'RFC_ALREADY_REGISTERED', e.constraint?.includes('email') ? 'Ya existe una empresa con ese correo de administrador.' : 'Ya existe una empresa registrada con ese RFC.');
    throw e;
  } finally { client.release(); }
}

module.exports = { validateRfc, registerCompany, environment, _internal: { classifyMessage, resetLimiter: () => { stamps.length = 0; quotaBlockedUntil = 0; } } };
