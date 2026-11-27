'use strict';
// Cifrado AES-256-GCM de secretos en reposo (secreto TOTP). Formato: v1.<iv>.<tag>.<datos> en base64url.
const crypto = require('crypto');
const keyOf = (secret) => crypto.createHash('sha256').update(String(secret)).digest();
function encrypt(plain, secret) {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}
function decrypt(blob, secret) {
  const [v, iv, tag, data] = String(blob).split('.');
  if (v !== 'v1') throw new Error('Formato de secreto no soportado.');
  const d = crypto.createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}
module.exports = { encrypt, decrypt };
