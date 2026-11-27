'use strict';
// Constructor de formularios: definición válida y validación REAL de capturas (mismo contrato que `src/app/core/form-validator.ts`).
const { unprocessable } = require('../utils/errors');

const TYPES = ['Texto', 'Número', 'Fecha', 'Selección', 'Foto', 'Firma', 'Código de barras', 'Casilla'];
const KINDS = ['entrega', 'cobro', 'visita'];

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

/** Normaliza y valida la definición de un formulario (lista de campos). */
function parseFields(kind, fields) {
  if (!Array.isArray(fields)) throw unprocessable('Los campos del formulario deben ser una lista.', 'FORM_INVALID');
  if (fields.length > 60) throw unprocessable('Un formulario admite como máximo 60 campos.', 'FORM_INVALID');
  const seen = new Set();
  return fields.map((f, i) => {
    const label = String(f?.label ?? '').trim();
    if (!label || label.length > 80) throw unprocessable(`El campo ${i + 1} necesita una etiqueta de hasta 80 caracteres.`, 'FORM_INVALID');
    if (seen.has(label.toLowerCase())) throw unprocessable(`La etiqueta «${label}» está repetida.`, 'FORM_INVALID'); seen.add(label.toLowerCase());
    if (!TYPES.includes(f.type)) throw unprocessable(`Tipo de campo no válido en «${label}».`, 'FORM_INVALID');
    const options = f.type === 'Selección' ? (Array.isArray(f.options) ? f.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 50) : []) : [];
    if (f.type === 'Selección' && options.length < 2) throw unprocessable(`«${label}» necesita al menos 2 opciones.`, 'FORM_INVALID');
    const min = num(f.min); const max = num(f.max); const maxLength = num(f.maxLength);
    for (const [n, v] of [['mínimo', min], ['máximo', max], ['longitud máxima', maxLength]]) if (v !== null && !Number.isFinite(v)) throw unprocessable(`El ${n} de «${label}» no es un número.`, 'FORM_INVALID');
    if (min !== null && max !== null && min > max) throw unprocessable(`El mínimo de «${label}» no puede ser mayor que el máximo.`, 'FORM_INVALID');
    return { id: String(f.id ?? `${kind}-${i + 1}`), label, type: f.type, required: !!f.required, placeholder: String(f.placeholder ?? '').slice(0, 120), helpText: String(f.helpText ?? '').slice(0, 240), options,
      min: min === null ? '' : String(min), max: max === null ? '' : String(max), maxLength: maxLength === null ? '' : String(maxLength), defaultValue: String(f.defaultValue ?? '').slice(0, 120), visible: f.visible !== false };
  });
}

/** Valida los valores capturados. Los campos Foto/Firma no llevan valor: se comprueban como evidencias. */
function validateValues(fields, values = {}) {
  const errors = [];
  for (const f of fields || []) {
    if (f.visible === false || f.type === 'Foto' || f.type === 'Firma') continue;
    const raw = values[f.label]; const empty = raw === undefined || raw === null || raw === '' || (f.type === 'Casilla' && raw === false && false);
    if (empty) { if (f.required) errors.push({ field: f.label, message: `«${f.label}» es obligatorio.` }); continue; }
    const s = String(raw); const err = (m) => errors.push({ field: f.label, message: m });
    switch (f.type) {
      case 'Texto': { const max = num(f.maxLength); if (max && s.length > max) err(`«${f.label}» admite hasta ${max} caracteres.`); break; }
      case 'Número': { const n = Number(s); if (!Number.isFinite(n)) { err(`«${f.label}» debe ser un número.`); break; } const lo = num(f.min); const hi = num(f.max); if (lo !== null && n < lo) err(`«${f.label}» debe ser ≥ ${lo}.`); if (hi !== null && n > hi) err(`«${f.label}» debe ser ≤ ${hi}.`); break; }
      case 'Fecha': if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) err(`«${f.label}» debe ser una fecha válida (AAAA-MM-DD).`); break;
      case 'Selección': if (!(f.options || []).includes(s)) err(`«${f.label}»: elige una de las opciones.`); break;
      case 'Código de barras': if (!/^[A-Za-z0-9\-_.]{4,64}$/.test(s)) err(`«${f.label}» no es un código válido.`); break;
      case 'Casilla': if (typeof raw !== 'boolean' && !['true', 'false'].includes(s)) err(`«${f.label}» debe ser sí o no.`); else if (f.required && (raw === false || s === 'false')) err(`«${f.label}» debe marcarse.`); break;
      default: break;
    }
  }
  return errors;
}

/** Evidencias que exige el formulario: campos Foto/Firma obligatorios y visibles. */
const requiredEvidence = (fields) => ({ photo: (fields || []).some((f) => f.type === 'Foto' && f.required && f.visible !== false), signature: (fields || []).some((f) => f.type === 'Firma' && f.required && f.visible !== false) });

module.exports = { TYPES, KINDS, parseFields, validateValues, requiredEvidence };
