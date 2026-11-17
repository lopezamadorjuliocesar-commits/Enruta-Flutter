'use strict';
// Validación de FORMATO de RFC (no consulta al SAT). Persona moral = 12 caracteres.
const MORAL = /^[A-ZÑ&]{3}(\d{2})(\d{2})(\d{2})[A-Z0-9]{3}$/;
const FISICA = /^[A-ZÑ&]{4}(\d{2})(\d{2})(\d{2})[A-Z0-9]{3}$/;

function validDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
// El RFC solo trae 2 dígitos de año: se acepta si la fecha existe en 19xx o 20xx.
function dateOk(yy, mm, dd) {
  const y = Number(yy), m = Number(mm), d = Number(dd);
  return validDate(1900 + y, m, d) || validDate(2000 + y, m, d);
}
function normalizeRfc(v) { return String(v ?? '').trim().toUpperCase().replace(/\s+/g, ''); }

/** @returns {{ok:boolean, code?:string, message?:string, rfc:string}} */
function checkMoralRfc(input) {
  const rfc = normalizeRfc(input);
  if (!rfc) return { ok: false, rfc, code: 'RFC_REQUIRED', message: 'Escribe el RFC de la empresa.' };
  if (rfc.length === 13 && FISICA.test(rfc)) {
    const m = FISICA.exec(rfc);
    return dateOk(m[1], m[2], m[3])
      ? { ok: false, rfc, code: 'RFC_NOT_MORAL', message: 'El RFC corresponde a una persona física. Solo se aceptan personas morales (12 caracteres).' }
      : { ok: false, rfc, code: 'RFC_BAD_DATE', message: 'La fecha incluida en el RFC no es válida.' };
  }
  if (rfc.length !== 12) return { ok: false, rfc, code: 'RFC_BAD_FORMAT', message: 'El RFC de una persona moral debe tener 12 caracteres.' };
  const m = MORAL.exec(rfc);
  if (!m) return { ok: false, rfc, code: 'RFC_BAD_FORMAT', message: 'El formato del RFC no es válido (3 letras, 6 dígitos de fecha y 3 de homoclave).' };
  if (!dateOk(m[1], m[2], m[3])) return { ok: false, rfc, code: 'RFC_BAD_DATE', message: 'La fecha incluida en el RFC no es válida.' };
  return { ok: true, rfc };
}
const normalizeName = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
const normalizeCp = (v) => String(v ?? '').trim();
const validCp = (v) => /^\d{5}$/.test(v);

module.exports = { checkMoralRfc, normalizeRfc, normalizeName, normalizeCp, validCp };
