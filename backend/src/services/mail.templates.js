'use strict';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function passwordResetEmail({ email, link, minutes, local }) {
  const banner = local ? '<p style="background:#fff4d6;border:1px solid #e6c15a;padding:8px 12px;border-radius:6px;font-size:12px;color:#6b4e00">MODO LOCAL — mensaje de desarrollo; no se envió por correo real.</p>' : '';
  const html = `<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;color:#1f2d3d;background:#f4f6f9;margin:0;padding:24px">
<div style="max-width:480px;margin:auto;background:#fff;border:1px solid #e4e9ef;border-radius:10px;padding:28px">${banner}
<h1 style="font-size:20px">Restablece tu contraseña de EnRuta</h1>
<p style="font-size:14px;line-height:1.6">Recibimos una solicitud para la cuenta <strong>${esc(email)}</strong>. Pulsa el botón para elegir una contraseña nueva.</p>
<p style="text-align:center"><a href="${esc(link)}" style="display:inline-block;background:#2f6fb0;color:#fff;text-decoration:none;font-weight:bold;padding:12px 32px;border-radius:7px">Restablecer</a></p>
<p style="font-size:13px">El enlace es de un solo uso y <strong>expira en ${minutes} minutos</strong>.</p>
<p style="font-size:12px;color:#617387;word-break:break-all">Si el botón no funciona copia esta dirección: ${esc(link)}</p>
<p style="font-size:12px;color:#617387">Si no lo solicitaste, ignora este mensaje: tu contraseña seguirá igual.</p></div></body></html>`;
  const text = `Restablece tu contraseña de EnRuta\n\nCuenta: ${email}\nAbre este enlace (un solo uso, expira en ${minutes} minutos):\n${link}\n\nSi no lo solicitaste, ignora este mensaje.`;
  return { subject: 'Restablece tu contraseña de EnRuta', html, text };
}
module.exports = { passwordResetEmail };
