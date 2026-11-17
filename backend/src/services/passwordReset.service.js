'use strict';
/**
 * Restablecimiento de contraseña SIN base de datos.
 *  - El enlace lleva un JWT (HS256, 15 min) con { email, jti }.
 *  - Los jti ya utilizados se guardan en un Map en memoria (se purgan al vencer el token).
 *  - Las cuentas de EnRuta viven en el navegador, por lo que este servicio NO guarda contraseñas:
 *    verifica el token, lo consume y devuelve el correo para que el frontend actualice su cuenta local.
 *  Limitación: al ser memoria, reiniciar el servidor olvida los jti usados (el token sigue limitado a 15 min).
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const TOKEN_TTL_SECONDS = 15 * 60;
const COOLDOWN_MS = 60_000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

const usedJti = new Map();      // jti -> exp (segundos epoch)
const lastSent = new Map();     // email -> timestamp del último envío
let transport = null;

const secret = () => process.env.PASSWORD_RESET_SECRET || process.env.JWT_SECRET || 'dev-secret-change-me';
const frontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:4200').replace(/\/+$/, '');
const normalizeEmail = (v) => String(v ?? '').trim().toLowerCase();
const validEmail = (v) => v.length <= 254 && EMAIL_RE.test(v);
const validPassword = (v) => typeof v === 'string' && v.length >= 12 && v.length <= 128 && /[A-Z]/.test(v) && /[0-9]/.test(v);

function sweep() {
  const now = Math.floor(Date.now() / 1000);
  for (const [jti, exp] of usedJti) if (exp < now) usedJti.delete(jti);
  for (const [email, t] of lastSent) if (Date.now() - t > COOLDOWN_MS) lastSent.delete(email);
}
setInterval(sweep, 5 * 60_000).unref();

function mailConfigured() { return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) || !!transport; }
function getTransport() {
  if (transport) return transport;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  });
  return transport;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function buildEmail(email, link) {
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#1f2d3d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e4e9ef;border-radius:10px">
<tr><td style="padding:28px 32px 8px"><span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;border-radius:7px;background:#2f6fb0;color:#fff;font-weight:bold">E</span>
<span style="font-size:18px;font-weight:bold;vertical-align:middle;margin-left:8px">EnRuta</span></td></tr>
<tr><td style="padding:8px 32px 0"><h1 style="font-size:20px;margin:12px 0 8px">Restablece tu contraseña</h1>
<p style="font-size:14px;line-height:1.6;margin:0 0 20px;color:#44546a">Recibimos una solicitud para restablecer la contraseña de la cuenta asociada a <strong>${esc(email)}</strong>. Pulsa el botón para elegir una contraseña nueva.</p></td></tr>
<tr><td align="center" style="padding:0 32px 20px"><a href="${esc(link)}" style="display:inline-block;background:#2f6fb0;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 32px;border-radius:7px">Restablecer</a></td></tr>
<tr><td style="padding:0 32px 8px"><p style="font-size:13px;line-height:1.6;margin:0 0 12px;color:#44546a">Este enlace es de un solo uso y <strong>expira en 15 minutos</strong>.</p>
<p style="font-size:12px;line-height:1.6;margin:0 0 12px;color:#617387">Si el botón no funciona, copia y pega esta dirección en tu navegador:<br><span style="word-break:break-all">${esc(link)}</span></p></td></tr>
<tr><td style="padding:12px 32px 28px;border-top:1px solid #e4e9ef"><p style="font-size:12px;line-height:1.6;margin:0;color:#617387">Si no solicitaste este cambio, ignora este mensaje: tu contraseña seguirá siendo la misma.</p></td></tr>
</table><p style="font-size:11px;color:#8a99ab;margin:16px 0 0">© 2026 EnRuta</p></td></tr></table></body></html>`;
  const text = `Restablece tu contraseña de EnRuta\n\nRecibimos una solicitud para la cuenta ${email}.\nAbre este enlace (expira en 15 minutos, un solo uso):\n${link}\n\nSi no lo solicitaste, ignora este mensaje.`;
  return { html, text };
}

function issueToken(email) {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ typ: 'password-reset', email }, secret(), { algorithm: 'HS256', expiresIn: TOKEN_TTL_SECONDS, jwtid: jti });
  return { token, jti };
}

/** Envía el correo. Devuelve { sent:boolean, throttled?:boolean }. Lanza si SMTP falla. */
async function requestReset(rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!validEmail(email)) { const e = new Error('Correo inválido'); e.code = 'EMAIL_INVALID'; throw e; }
  const t = getTransport();
  if (!t) { const e = new Error('SMTP no configurado'); e.code = 'MAIL_NOT_CONFIGURED'; throw e; }
  const last = lastSent.get(email);
  if (last && Date.now() - last < COOLDOWN_MS) return { sent: false, throttled: true };
  lastSent.set(email, Date.now());
  const { token } = issueToken(email);
  const link = `${frontendUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const { html, text } = buildEmail(email, link);
  try {
    await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: email, subject: 'Restablece tu contraseña de EnRuta', html, text });
  } catch (err) { lastSent.delete(email); const e = new Error('Fallo al enviar el correo'); e.code = 'MAIL_SEND_FAILED'; e.cause = err; throw e; }
  return { sent: true };
}

/** @returns {{ok:true,email:string,jti:string,exp:number}|{ok:false,reason:'MISSING'|'EXPIRED'|'INVALID'|'USED'}} */
function inspectToken(token) {
  if (typeof token !== 'string' || !token.trim() || token.length > 2048) return { ok: false, reason: 'MISSING' };
  let p;
  try { p = jwt.verify(token.trim(), secret(), { algorithms: ['HS256'] }); }
  catch (e) { return { ok: false, reason: e.name === 'TokenExpiredError' ? 'EXPIRED' : 'INVALID' }; }
  if (p.typ !== 'password-reset' || !p.jti || !p.email) return { ok: false, reason: 'INVALID' };
  if (usedJti.has(p.jti)) return { ok: false, reason: 'USED' };
  return { ok: true, email: p.email, jti: p.jti, exp: p.exp };
}

/** Verifica y consume el token (síncrono: sin carrera entre dos peticiones simultáneas). */
function consumeToken(token) {
  const r = inspectToken(token);
  if (r.ok) usedJti.set(r.jti, r.exp);
  return r;
}

module.exports = { requestReset, inspectToken, consumeToken, validEmail, normalizeEmail, validPassword, mailConfigured,
  _internal: { setTransport: (t) => { transport = t; }, reset: () => { usedJti.clear(); lastSent.clear(); }, issueToken } };
