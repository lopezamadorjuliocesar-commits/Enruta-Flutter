'use strict';
class HttpError extends Error {
  constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
const badRequest = (message, code = 'BAD_REQUEST', extra) => new HttpError(400, code, message, extra);
const unauthorized = (code = 'NO_SESSION', message = 'Inicia sesión para continuar.') => new HttpError(401, code, message);
const forbidden = (message = 'No tienes permiso para realizar esta acción.', code = 'FORBIDDEN') => new HttpError(403, code, message);
const notFound = (message = 'No encontrado.') => new HttpError(404, 'NOT_FOUND', message);
const conflict = (message, code = 'CONFLICT') => new HttpError(409, code, message);
const unprocessable = (message, code = 'INVALID') => new HttpError(422, code, message);
module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable };
