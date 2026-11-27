'use strict';
// Idempotencia (DT-34): la misma Idempotency-Key + el mismo cuerpo devuelve la MISMA respuesta sin repetir el efecto (doble clic, reintento de red).
// Una clave con cuerpo distinto → 422; una petición simultánea con la misma clave → 409 mientras la primera se procesa.
// Solo se conservan las respuestas 2xx: tras un error la clave se libera para reintentar corregido.
const { HttpError } = require('../utils/errors');
const { sha256, iso } = require('../utils/ids');

module.exports = function idempotency({ store, clock }) {
  return async function idempotent(req, res, next) {
    try {
      const key = req.get('idempotency-key');
      if (!key || !/^[A-Za-z0-9_-]{8,80}$/.test(key)) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Falta el encabezado Idempotency-Key (8 a 80 caracteres: letras, números, _ o -).');
      const body = Buffer.isBuffer(req.body) ? sha256(req.body.toString('latin1')) : JSON.stringify(req.body ?? {});
      const hash = sha256(`${req.method} ${req.baseUrl}${req.path}|${body}`); const companyId = req.ctx.companyId;
      const existing = await store.tx((r) => r.idempotency.reserve(companyId, key, hash, iso(new Date(clock()))));
      if (existing) {
        if (existing.request_hash !== hash) throw new HttpError(422, 'IDEMPOTENCY_MISMATCH', 'Esa Idempotency-Key ya se usó con una petición distinta.');
        if (existing.status_code === null) throw new HttpError(409, 'IDEMPOTENCY_IN_PROGRESS', 'La acción ya se está procesando.');
        res.set('Idempotent-Replay', 'true'); return res.status(existing.status_code).json(JSON.parse(existing.response));
      }
      const send = res.json.bind(res);
      res.json = (payload) => {
        const code = res.statusCode;
        const settle = code >= 200 && code < 300 ? store.tx((r) => r.idempotency.complete(companyId, key, code, JSON.stringify(payload))) : store.tx((r) => r.idempotency.release(companyId, key));
        settle.then(() => send(payload), () => send(payload)); return res;
      };
      next();
    } catch (e) { next(e); }
  };
};
