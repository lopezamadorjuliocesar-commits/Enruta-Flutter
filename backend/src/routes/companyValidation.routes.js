'use strict';
const express = require('express'); const crypto = require('crypto'); const rateLimit = require('express-rate-limit');
const ctl = require('../controllers/companyValidation.controller');
const router = express.Router();

// Misma llave de aplicación que usa el resto de la API (x-api-key). El alta es previa al login, por eso no exige x-company.
function appKey(req, res, next) {
  const expected = process.env.ADMIN_API_KEY || 'dev-admin-key'; const key = req.get('x-api-key') || '';
  const ok = key.length === expected.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected));
  return ok ? next() : res.status(401).json({ error: 'API key inválida.' });
}
const limiter = (max) => rateLimit({ windowMs: 60_000, max, standardHeaders: true, legacyHeaders: false, message: { ok: false, code: 'RATE_LIMITED', message: 'Demasiadas solicitudes. Intenta de nuevo en un minuto.' } });

router.post('/validate-rfc', appKey, limiter(Number(process.env.VALIDATE_RFC_MAX_PER_MIN || 6)), ctl.validateRfc);
router.post('/register', appKey, limiter(10), ctl.register);
router.get('/validation-status', appKey, ctl.status);
module.exports = router;
