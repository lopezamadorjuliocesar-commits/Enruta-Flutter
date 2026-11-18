'use strict';
// Parámetros operativos con herencia en cascada (DT-45): Usuario > Ruta > Zona > Centro > Empresa > valor del sistema.
const { unprocessable } = require('../utils/errors');

const SCOPES = ['EMPRESA', 'CENTRO', 'ZONA', 'RUTA', 'USUARIO'];
const PRECEDENCE = ['USUARIO', 'RUTA', 'ZONA', 'CENTRO', 'EMPRESA'];

/** Valores por defecto del sistema. `loading_window` y `min_client_version` vacíos = sin restricción hasta que la empresa los defina. */
const DEFAULTS = { visit_radius_m: 150, cash_tolerance_cents: 5000, overdue_block_days: 30, loading_window: '', min_client_version: '' };

const RULES = {
  visit_radius_m: { label: 'Radio de visita (m)', parse: (v) => int(v, 10, 5000, 'El radio de visita debe estar entre 10 y 5000 m.') },
  cash_tolerance_cents: { label: 'Tolerancia de efectivo (centavos)', parse: (v) => int(v, 0, 100_000_00, 'La tolerancia de efectivo no es válida.') },
  overdue_block_days: { label: 'Días de saldo vencido para bloquear crédito', parse: (v) => int(v, 0, 365, 'Los días de saldo vencido deben estar entre 0 y 365.') },
  loading_window: { label: 'Horario de embarque (HH:MM-HH:MM)', parse: (v) => { const s = String(v).trim(); if (!/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw unprocessable('El horario de embarque debe ser HH:MM-HH:MM.', 'PARAM_INVALID'); return s; } },
  min_client_version: { label: 'Versión mínima del cliente', parse: (v) => { const s = String(v).trim(); if (!/^\d+\.\d+\.\d+$/.test(s)) throw unprocessable('La versión mínima debe tener el formato 1.2.3.', 'PARAM_INVALID'); return s; } },
};
function int(v, min, max, message) { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw unprocessable(message, 'PARAM_INVALID'); return n; }

/** Valida y normaliza el mapa de parámetros de UN ámbito. Vacío / null = heredar (la clave se elimina). */
function parseScopeValues(values) {
  const out = {};
  for (const [k, v] of Object.entries(values || {})) {
    if (!RULES[k]) throw unprocessable(`Parámetro desconocido: ${k}`, 'PARAM_UNKNOWN');
    if (v === null || v === undefined || String(v).trim() === '') continue;
    out[k] = RULES[k].parse(v);
  }
  return out;
}

/** `scope` = { companyScope (siempre), centerId, zoneId, routeId, userId }. */
function resolve(parameters, scope = {}) {
  const ids = { EMPRESA: 'EMPRESA', CENTRO: scope.centerId && `CENTRO:${scope.centerId}`, ZONA: scope.zoneId && `ZONA:${scope.zoneId}`, RUTA: scope.routeId && `RUTA:${scope.routeId}`, USUARIO: scope.userId && `USUARIO:${scope.userId}` };
  const values = {}; const origins = {};
  for (const key of Object.keys(DEFAULTS)) {
    values[key] = DEFAULTS[key]; origins[key] = 'SISTEMA';
    for (const level of PRECEDENCE) {
      const bag = ids[level] && parameters?.[ids[level]];
      if (bag && bag[key] !== undefined) { values[key] = bag[key]; origins[key] = level; break; }
    }
  }
  return { values, origins };
}

const cmpVersion = (a, b) => { const x = String(a).split('.').map(Number); const y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1; } return 0; };

/** ¿La hora local (en la zona de la empresa) cae dentro de `HH:MM-HH:MM`? Soporta ventanas que cruzan la medianoche. */
function insideWindow(window, date, timeZone = 'America/Mexico_City') {
  if (!window) return true;
  const [from, to] = window.split('-');
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const now = `${parts.find((p) => p.type === 'hour').value.replace('24', '00')}:${parts.find((p) => p.type === 'minute').value}`;
  return from <= to ? now >= from && now <= to : now >= from || now <= to;
}

module.exports = { SCOPES, DEFAULTS, RULES, parseScopeValues, resolve, cmpVersion, insideWindow };
