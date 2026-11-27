'use strict';
const { HttpError, unauthorized, forbidden } = require('../utils/errors');

const COOKIE = 'enruta_sid';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
/** Token de sesión: Bearer (Flutter/repartidor) o cookie HttpOnly (web). */
function tokenOf(req) {
  const h = req.get('authorization') || '';
  if (/^Bearer\s+\S+/i.test(h)) return { token: h.replace(/^Bearer\s+/i, '').trim(), via: 'bearer' };
  const c = parseCookies(req.get('cookie'))[COOKIE]; return c ? { token: c, via: 'cookie' } : { token: null, via: null };
}
/** Anti-CSRF (DT-09): toda petición mutante debe llevar X-EnRuta-Client; un formulario de otro sitio no puede enviarlo sin preflight CORS. */
function csrfGuard(req, _res, next) {
  if (SAFE.has(req.method)) return next();
  if (req.path === '/mobile/link' || req.path === '/mobile/v1/link' || /^Bearer\s+\S+/i.test(req.get('authorization') || '')) return next();   // contrato móvil / Bearer: no dependen de cookies
  const v = req.get('x-enruta-client');
  if (v !== 'web' && v !== 'mobile') return next(new HttpError(403, 'CSRF', 'Falta el encabezado X-EnRuta-Client.'));
  next();
}
function sessionCookie(config, token, { keep, expiresAt }) {
  const parts = [`${COOKIE}=${token}`, 'HttpOnly', 'Path=/api', 'SameSite=Lax'];
  if (keep) parts.push(`Expires=${new Date(expiresAt).toUTCString()}`);
  if (config.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}
const clearCookie = (config) => `${COOKIE}=; HttpOnly; Path=/api; SameSite=Lax; Max-Age=0${config.cookieSecure ? '; Secure' : ''}`;

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const meta = (req) => ({ ip: req.ip, ua: req.get('user-agent') || '' });

function requireAuth(auth) {
  return wrap(async (req, _res, next) => {
    const { token, via } = tokenOf(req);
    // X-EnRuta-Background: consultas automáticas del navegador (p. ej. detectar cierres de sesión) que NO cuentan como actividad del usuario.
    const ctx = await auth.authenticate(token, { touch: req.get('x-enruta-background') !== '1' && req.path !== '/events' });
    ctx.ip = req.ip; req.ctx = ctx; req.authVia = via; next();
  });
}
/** Todos los permisos indicados son obligatorios. */
const requirePermission = (...codes) => (req, _res, next) => {
  const missing = codes.filter((c) => !req.ctx.permissions.has(c));
  next(missing.length ? forbidden(`No tienes permiso para esta acción (${missing.join(', ')}).`, 'PERMISSION_DENIED') : undefined);
};
/** Basta con uno de los permisos. */
const requireAnyPermission = (...codes) => (req, _res, next) => next(codes.some((c) => req.ctx.permissions.has(c)) ? undefined : forbidden(`No tienes permiso para esta acción (${codes.join(' o ')}).`, 'PERMISSION_DENIED'));

function errorHandler(logger) {
  return (err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code, ...(err.extra || {}) });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'El cuerpo de la petición no es JSON válido.', code: 'BAD_JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'La petición es demasiado grande.', code: 'TOO_LARGE' });
    logger.error?.(`[error] ${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ error: 'Error interno del servidor.', code: 'INTERNAL' });
  };
}
module.exports = { COOKIE, tokenOf, csrfGuard, sessionCookie, clearCookie, wrap, meta, requireAuth, requirePermission, requireAnyPermission, errorHandler, parseCookies };
