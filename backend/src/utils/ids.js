'use strict';
const crypto = require('crypto');
const uuid = () => crypto.randomUUID();
const iso = (d = new Date()) => (d instanceof Date ? d : new Date(d)).toISOString();
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const addMinutes = (d, m) => new Date(new Date(d).getTime() + m * 60_000);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
module.exports = { uuid, iso, sha256, randomToken, addMinutes, UUID_RE };
