'use strict';
const express = require('express'); const crypto = require('crypto'); const rateLimit = require('express-rate-limit');
const ctl = require('../controllers/passwordReset.controller');
const router = express.Router();

function appKey(req, res, next) {
  const expected = process.env.ADMIN_API_KEY || 'dev-admin-key'; const key = req.get('x-api-key') || '';
  const ok = key.length === expected.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected));
  return ok ? next() : res.status(401).json({ error: 'API key inválida.' });
}
const limiter = (max, windowMs = 15 * 60_000) => rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { ok: false, code: 'RATE_LIMITED', message: 'Demasiadas solicitudes. Inténtalo más tarde.' } });

router.post('/forgot-password', appKey, limiter(Number(process.env.FORGOT_PASSWORD_MAX_PER_15MIN || 5)), ctl.forgotPassword);
router.get('/validate-reset-token', appKey, limiter(60), ctl.validateResetToken);
router.post('/reset-password', appKey, limiter(10), ctl.resetPassword);
module.exports = router;
