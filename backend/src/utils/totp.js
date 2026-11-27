'use strict';
// TOTP RFC 6238 (HMAC-SHA1, 6 dígitos, paso de 30 s) con base32 RFC 4648.
const crypto = require('crypto');
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  let bits = 0, value = 0; const out = [];
  for (const ch of String(str).toUpperCase().replace(/[\s=]/g, '')) {
    const idx = ALPHABET.indexOf(ch); if (idx < 0) throw new Error('Secreto base32 inválido.');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
const newSecret = () => base32Encode(crypto.randomBytes(20));
function hotp(secretB32, counter, digits = 6) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}
const totp = (secret, atMs = Date.now()) => hotp(secret, Math.floor(atMs / 30000));
function verifyTotp(secret, code, atMs = Date.now(), window = 1) {
  const c = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const step = Math.floor(atMs / 30000); let ok = false;
  for (let i = -window; i <= window; i++) {
    const exp = hotp(secret, step + i);
    if (crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(c))) ok = true;   // sin cortocircuito: tiempo constante
  }
  return ok;
}
const otpauthUrl = (secret, account, issuer = 'EnRuta') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
module.exports = { newSecret, totp, verifyTotp, otpauthUrl, base32Encode, base32Decode };
