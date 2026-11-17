'use strict';
const svc = require('../services/passwordReset.service');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const REASONS = { MISSING: [400, 'Falta el token.'], INVALID: [400, 'El enlace no es válido.'], EXPIRED: [410, 'El enlace expiró.'], USED: [410, 'El enlace ya fue utilizado.'] };

exports.forgotPassword = wrap(async (req, res) => {
  try {
    await svc.requestReset(req.body?.email);
    // Respuesta idéntica haya o no envío (cooldown) para no revelar nada sobre el correo.
    res.json({ ok: true, message: 'Te enviamos un enlace de recuperación. Vence en 15 minutos.' });
  } catch (e) {
    if (e.code === 'EMAIL_INVALID') return res.status(422).json({ ok: false, code: e.code, message: 'Escribe un correo válido.' });
    if (e.code === 'MAIL_NOT_CONFIGURED') return res.status(503).json({ ok: false, code: e.code, message: 'El envío de correos no está configurado en el servidor.' });
    if (e.code === 'MAIL_SEND_FAILED') { console.error('[mail]', e.cause?.message); return res.status(502).json({ ok: false, code: e.code, message: 'No fue posible enviar el correo. Inténtalo nuevamente.' }); }
    throw e;
  }
});

exports.validateResetToken = (req, res) => {
  res.set('Cache-Control', 'no-store');
  const r = svc.inspectToken(req.query.token);
  if (!r.ok) { const [st, message] = REASONS[r.reason]; return res.status(st).json({ valid: false, reason: r.reason, message }); }
  res.json({ valid: true, email: r.email });
};

exports.resetPassword = (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { token, newPassword } = req.body || {};
  if (!svc.validPassword(newPassword)) return res.status(422).json({ ok: false, code: 'PASSWORD_WEAK', message: 'La contraseña necesita al menos 12 caracteres, una mayúscula y un número.' });
  const r = svc.consumeToken(token);
  if (!r.ok) { const [st, message] = REASONS[r.reason]; return res.status(st).json({ ok: false, reason: r.reason, message }); }
  // La contraseña NO se almacena ni se registra aquí: las cuentas residen en el frontend.
  res.status(200).json({ ok: true, email: r.email, message: 'Contraseña restablecida con éxito.' });
};
