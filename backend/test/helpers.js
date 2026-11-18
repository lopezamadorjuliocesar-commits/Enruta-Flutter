'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createConfig } = require('../src/config');
const { createRuntime } = require('../src/runtime');

const silent = { log() {}, warn() {}, error() {}, info() {} };
const PASSWORD = 'Clave-Segura-123';

/** Reloj controlable: las pruebas avanzan el tiempo sin esperar. */
function makeClock(start = '2026-11-17T12:00:00.000Z') {
  let t = Date.parse(start); const clock = () => t;
  clock.advance = (ms) => { t += ms; return t; }; clock.set = (iso) => { t = Date.parse(iso); };
  return clock;
}

/** Cliente HTTP de pruebas. mode 'mobile' → Bearer; mode 'web' → cookie jar (como un navegador). */
class Client {
  constructor(baseUrl, { mode = 'mobile', name = 'cliente' } = {}) { this.baseUrl = baseUrl; this.mode = mode; this.name = name; this.token = null; this.cookie = null; }
  async request(method, url, body, { headers = {}, raw = false, noClientHeader = false } = {}) {
    const h = { ...headers };
    if (!noClientHeader) h['X-EnRuta-Client'] = this.mode;
    if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
    if (this.mode === 'mobile' && this.token) h.Authorization = `Bearer ${this.token}`;
    if (this.mode === 'web' && this.cookie) h.Cookie = this.cookie;
    const res = await fetch(this.baseUrl + url, { method, headers: h, body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)) });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) { const [pair] = c.split(';'); if (pair.startsWith('enruta_sid=')) this.cookie = pair.endsWith('=') ? null : pair; }
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* binario */ }
    if (json?.token && json?.session) this.token = json.token;   // solo respuestas de login/registro (otras respuestas, p. ej. el QR, también traen `token`)
    return { status: res.status, body: json, text, headers: res.headers, setCookie: set };
  }
  get(url, o) { return this.request('GET', url, undefined, o); }
  post(url, body = {}, o) { return this.request('POST', url, body, o); }
  put(url, body = {}, o) { return this.request('PUT', url, body, o); }
  patch(url, body = {}, o) { return this.request('PATCH', url, body, o); }
  delete(url, o) { return this.request('DELETE', url, undefined, o); }
  /** Un "navegador nuevo" contra el mismo servidor. */
  fork(opts) { return new Client(this.baseUrl, opts); }
}

async function startApp(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enruta-test-'));
  const config = createConfig({}, { dbPath: ':memory:', storageDir: path.join(dir, 'storage'), bcryptCost: 4, rateLimit: false, mailMode: 'local', rfcMode: 'local', pacMode: 'local',
    rfcLocalTimeoutMs: 10, queuePollMs: 25, publicWebUrl: 'http://localhost:4200', ...over });
  const clock = over.clock || makeClock();
  const rt = await createRuntime(config, { clock, logger: silent, fetchImpl: over.fetchImpl });
  const server = http.createServer(rt.app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    rt, config, clock, dir, baseUrl, server,
    client: (opts) => new Client(baseUrl, opts),
    async stop() { await new Promise((r) => server.close(r)); await rt.close(); },
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

let rfcCounter = 0;
const nextRfc = () => { rfcCounter += 1; const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; return `${letters[rfcCounter % 24]}${letters[Math.floor(rfcCounter / 24) % 24]}X2001${String(10 + (rfcCounter % 18)).padStart(2, '0')}A${String(rfcCounter % 10)}${letters[rfcCounter % 24]}`; };

/** Alta completa vía API (RFC local → registro). Devuelve el cliente ya autenticado como administrador. */
async function registerCompany(app, { name = 'Empresa Prueba SA de CV', rfc, email, adminName = 'Admin Prueba', password = PASSWORD, mode = 'mobile' } = {}) {
  const c = app.client({ mode });
  rfc = rfc || nextRfc(); email = email || `admin-${rfc.toLowerCase()}@prueba.mx`;
  const v = await c.post('/api/companies/validate-rfc', { rfc, razonSocial: name, codigoPostal: '91000' });
  if (!v.body?.validationToken) throw new Error(`validate-rfc falló: ${v.status} ${v.text}`);
  const r = await c.post('/api/companies/register', { validationToken: v.body.validationToken, rfc, razonSocial: name, adminName, adminEmail: email, password, industry: 'Distribución', country: 'México', timezone: 'America/Mexico_City' });
  if (r.status !== 201) throw new Error(`register falló: ${r.status} ${r.text}`);
  return { client: c, email, password, rfc, session: r.body.session, company: r.body.session.company };
}

/** Crea un usuario con un rol de sistema (por nombre) y devuelve su cliente autenticado. */
async function createUser(app, admin, { role = 'Repartidor', email, name = 'Usuario Prueba', centerIds, password = PASSWORD, mode = 'mobile' } = {}) {
  const roles = (await admin.client.get('/api/roles')).body; const r = roles.find((x) => x.name === role);
  const centers = centerIds || [admin.session.centers[0].id];
  const res = await admin.client.post('/api/users', { name, email, password, roleId: r.id, centerIds: centers });
  if (res.status !== 201) throw new Error(`crear usuario falló: ${res.status} ${res.text}`);
  const c = app.client({ mode }); const l = await c.post('/api/auth/login', { email, password });
  if (l.status !== 200) throw new Error(`login falló: ${l.status} ${l.text}`);
  return { client: c, user: res.body, session: l.body.session, email, password };
}

module.exports = { startApp, registerCompany, createUser, makeClock, Client, PASSWORD, silent };
