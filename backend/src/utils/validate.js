'use strict';
const { unprocessable } = require('./errors');
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const normalizeEmail = (v) => String(v ?? '').trim().toLowerCase();
const validEmail = (v) => v.length <= 254 && EMAIL_RE.test(v);
const validPassword = (v) => typeof v === 'string' && v.length >= 12 && v.length <= 128 && /[A-Z]/.test(v) && /[0-9]/.test(v);
const PASSWORD_MESSAGE = 'La contraseña necesita al menos 12 caracteres, una mayúscula y un número.';
function str(v, field, { min = 0, max = 200, required = false } = {}) {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (required) throw unprocessable(`${field} es obligatorio.`, 'FIELD_REQUIRED');
    return null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw unprocessable(`${field} no es válido.`, 'FIELD_INVALID');
  const s = String(v).trim();
  if (s.length < min) throw unprocessable(`${field} es demasiado corto.`, 'FIELD_INVALID');
  if (s.length > max) throw unprocessable(`${field} es demasiado largo (máx. ${max}).`, 'FIELD_INVALID');
  return s;
}
function num(v, field, { min = -Infinity, max = Infinity, required = false } = {}) {
  if (v === undefined || v === null || v === '') { if (required) throw unprocessable(`${field} es obligatorio.`, 'FIELD_REQUIRED'); return null; }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw unprocessable(`${field} no es válido.`, 'FIELD_INVALID');
  return n;
}
module.exports = { normalizeEmail, validEmail, validPassword, PASSWORD_MESSAGE, str, num };
