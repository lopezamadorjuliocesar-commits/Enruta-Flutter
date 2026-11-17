'use strict';
const svc = require('../services/companyValidation.service');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
// Solo se leen campos conocidos: el frontend NO puede enviar estado fiscal ni elegir ambiente.
exports.validateRfc = wrap(async (req, res) => {
  const { rfc, razonSocial, codigoPostal } = req.body || {};
  const r = await svc.validateRfc({ rfc, razonSocial, codigoPostal });
  if (r.body.retryAfter) res.set('Retry-After', String(r.body.retryAfter));
  res.status(r.httpStatus).json(r.body);
});
exports.register = wrap(async (req, res) => {
  const b = req.body || {};
  const r = await svc.registerCompany({ validationToken: b.validationToken, rfc: b.rfc, razonSocial: b.razonSocial, industry: b.industry, country: b.country, timezone: b.timezone, adminName: b.adminName, adminEmail: b.adminEmail, phone: b.phone });
  res.status(r.httpStatus).json(r.body);
});
exports.status = (_req, res) => res.json({ environment: svc.environment() });
