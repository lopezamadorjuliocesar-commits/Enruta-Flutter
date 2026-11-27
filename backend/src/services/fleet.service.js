'use strict';
// Conductores, vehículos, dispositivos y vinculación QR. Mismas reglas que la versión PostgreSQL, ahora con sesión, empresa del contexto y SQLite.
const { uuid, iso, sha256, randomToken, addMinutes } = require('../utils/ids');
const { HttpError, badRequest, conflict, notFound, unprocessable } = require('../utils/errors');
const { str } = require('../utils/validate');
const { makeAudit } = require('./context');

const STATUSES = ['Activo', 'Inactivo', 'Reparación', 'Robado'];
const LINK_TTL_MIN = 15;
const nul = (v) => { if (v === undefined || v === null) return null; const s = String(v).trim(); return s === '' ? null : s; };

function deviceFields(b) {
  const errors = [];
  const alias = nul(b.alias); const imei = nul(b.imei_serial);
  if (!alias) errors.push('El alias es obligatorio.');
  if (!imei) errors.push('El IMEI o número de serie es obligatorio.');
  else if (!/^\d{15}$/.test(imei) && !/^[A-Za-z0-9-]{5,40}$/.test(imei)) errors.push('Escribe un IMEI de 15 dígitos o un número de serie alfanumérico (5-40).');
  if (b.phone && !/^[0-9+\s()-]{7,20}$/.test(String(b.phone))) errors.push('El teléfono no es válido.');
  if (b.status && !STATUSES.includes(b.status)) errors.push('Estado no válido.');
  if (errors.length) throw unprocessable(errors[0], 'DEVICE_INVALID');
  return { alias, imei, brand: nul(b.brand), model: nul(b.model), os: nul(b.os), osVersion: nul(b.os_version), phone: nul(b.phone), driverId: nul(b.driver_id), vehicleId: nul(b.vehicle_id), status: b.status || 'Activo' };
}
function mapDbError(e) {
  if (!/UNIQUE|FOREIGN KEY/i.test(e.message || '')) return e;
  const m = e.message || '';
  if (/FOREIGN KEY/i.test(m)) return unprocessable('El conductor o vehículo indicado no existe.', 'REFERENCE_INVALID');
  if (/imei_serial|devices_company_imei/.test(m)) return conflict('Ya existe un dispositivo con ese IMEI/serie.', 'DUPLICATE_IMEI');
  if (/driver_id|devices_company_driver/.test(m)) return conflict('Ese conductor ya tiene un dispositivo asignado.', 'DRIVER_TAKEN');
  if (/vehicle_id|devices_company_vehicle/.test(m)) return conflict('Ese vehículo ya tiene un dispositivo asignado.', 'VEHICLE_TAKEN');
  if (/plate|vehicles_company_plate/.test(m)) return conflict('Ya existe un vehículo con esa placa.', 'DUPLICATE_PLATE');
  return conflict('Registro duplicado.', 'DUPLICATE');
}

function createFleetService({ config, store, clock, bus }) {
  const audit = makeAudit(clock); const t = () => iso(new Date(clock()));
  const guarded = async (fn) => { try { return await fn(); } catch (e) { throw mapDbError(e); } };

  const drivers = {
    list: (ctx) => store.read((r) => r.drivers.list(ctx.companyId)),
    async create(ctx, b) {
      const name = str(b.name, 'El nombre del conductor', { required: true, max: 120 });
      return guarded(() => store.tx(async (r) => { const d = await r.drivers.create({ id: uuid(), companyId: ctx.companyId, name, email: nul(b.email), phone: nul(b.phone) }); await audit(r, ctx, 'driver.created', { entity: 'driver', entityId: d.id }); return d; }));
    },
    async update(ctx, id, b) {
      const name = str(b.name, 'El nombre del conductor', { required: true, max: 120 });
      return guarded(() => store.tx(async (r) => { if (!(await r.drivers.update(ctx.companyId, id, { name, email: nul(b.email), phone: nul(b.phone) }))) throw notFound('Conductor no encontrado.'); return (await r.drivers.list(ctx.companyId)).find((d) => d.id === id); }));
    },
    async remove(ctx, id) { await store.tx(async (r) => { if (!(await r.drivers.delete(ctx.companyId, id))) throw notFound('Conductor no encontrado.'); await audit(r, ctx, 'driver.deleted', { entity: 'driver', entityId: id }); }); },
    async sync(ctx, list) {
      return store.tx(async (r) => {
        for (const d of (Array.isArray(list) ? list : []).slice(0, 500)) { const email = nul(d.email); const name = nul(d.name); if (email && name) await r.drivers.upsertByEmail(ctx.companyId, { id: uuid(), name, email, phone: nul(d.phone) }); }
        return r.drivers.list(ctx.companyId);
      });
    },
  };

  const vehicles = {
    list: (ctx) => store.read((r) => r.vehicles.list(ctx.companyId)),
    async create(ctx, b) {
      const plate = str(b.plate, 'La placa', { required: true, max: 20 }).toUpperCase();
      return guarded(() => store.tx(async (r) => { const v = await r.vehicles.create({ id: uuid(), companyId: ctx.companyId, plate, description: nul(b.description) }); await audit(r, ctx, 'vehicle.created', { entity: 'vehicle', entityId: v.id }); return v; }));
    },
    async update(ctx, id, b) {
      const plate = str(b.plate, 'La placa', { required: true, max: 20 }).toUpperCase();
      return guarded(() => store.tx(async (r) => { if (!(await r.vehicles.update(ctx.companyId, id, { plate, description: nul(b.description) }))) throw notFound('Vehículo no encontrado.'); return r.vehicles.get(ctx.companyId, id); }));
    },
    async remove(ctx, id) { await store.tx(async (r) => { if (!(await r.vehicles.delete(ctx.companyId, id))) throw notFound('Vehículo no encontrado.'); await audit(r, ctx, 'vehicle.deleted', { entity: 'vehicle', entityId: id }); }); },
  };

  const devices = {
    list: (ctx) => store.read((r) => r.devices.list(ctx.companyId)),
    async get(ctx, id) { const d = await store.read((r) => r.devices.get(ctx.companyId, id)); if (!d) throw notFound('Dispositivo no encontrado.'); return d; },
    async create(ctx, b) {
      const f = deviceFields(b);
      return guarded(() => store.tx(async (r) => { const d = await r.devices.create({ id: uuid(), companyId: ctx.companyId, ...f }); await audit(r, ctx, 'device.created', { entity: 'device', entityId: d.id, detail: { alias: f.alias } }); return d; }));
    },
    async update(ctx, id, b) {
      const f = deviceFields(b);
      return guarded(() => store.tx(async (r) => { if (!(await r.devices.update(ctx.companyId, id, f))) throw notFound('Dispositivo no encontrado.'); await audit(r, ctx, 'device.updated', { entity: 'device', entityId: id }); return r.devices.get(ctx.companyId, id); }));
    },
    async remove(ctx, id) { await store.tx(async (r) => { if (!(await r.devices.delete(ctx.companyId, id))) throw notFound('Dispositivo no encontrado.'); await audit(r, ctx, 'device.deleted', { entity: 'device', entityId: id }); }); },

    /** QR para un dispositivo ya registrado: invalida los anteriores y emite uno nuevo de un solo uso. */
    async linkToken(ctx, id) {
      return store.tx(async (r) => {
        const d = await r.devices.get(ctx.companyId, id); if (!d) throw notFound('Dispositivo no encontrado.');
        if (d.status === 'Robado') throw new HttpError(403, 'DEVICE_STOLEN', 'Un dispositivo marcado como robado no puede vincularse.');
        return issueToken(r, ctx, id);
      });
    },
    /** QR genérico: el dispositivo se crea cuando la app escanea el código. */
    async linkQr(ctx) { return store.tx((r) => issueToken(r, ctx, null)); },
    /** Revoca el dispositivo: su credencial deja de servir de inmediato y el panel/otros clientes se enteran por SSE. */
    async revoke(ctx, id) {
      const out = await store.tx(async (r) => {
        const d = await r.devices.get(ctx.companyId, id); if (!d) throw notFound('Dispositivo no encontrado.');
        const at = iso(new Date(clock())); const n = await r.deviceSessions.revokeForDevice(id, at);
        await r.linkTokens.invalidateForDevice(id, at);
        await r.devices.update(ctx.companyId, id, { alias: d.alias, imei: d.imei_serial, brand: d.brand, model: d.model, os: d.os, osVersion: d.os_version, phone: d.phone, driverId: d.driver_id, vehicleId: d.vehicle_id, status: 'Inactivo' });
        await audit(r, ctx, 'device.revoked', { entity: 'device', entityId: id, detail: { alias: d.alias, credentials: n } });
        return { id, alias: d.alias, revoked: n };
      });
      bus?.publish({ companyId: ctx.companyId, type: 'device.revoked', data: { deviceId: id, alias: out.alias } });
      return out;
    },
    async linkQrStatus(ctx, jti) {
      return store.read(async (r) => {
        const tok = await r.linkTokens.get(ctx.companyId, jti); if (!tok) throw notFound('Código no encontrado.');
        if (tok.used_at && tok.created_device_id) return { status: 'linked', device: (await r.devices.get(ctx.companyId, tok.created_device_id)) || null };
        if (tok.used_at && tok.device_id) return { status: 'linked', device: (await r.devices.get(ctx.companyId, tok.device_id)) || null };
        if (tok.used_at || Date.parse(tok.expires_at) < clock()) return { status: 'expired' };
        return { status: 'pending' };
      });
    },
  };

  /** Credencial del dispositivo (X-Device-Token): válida, no revocada y dispositivo activo. */
  async function deviceFromToken(token) {
    if (!token || typeof token !== 'string') throw new HttpError(403, 'DEVICE_REQUIRED', 'Este dispositivo no está vinculado. Escanea el QR del panel para vincularlo.');
    return store.read(async (r) => {
      const s = await r.deviceSessions.findByHash(sha256(token));
      if (!s) throw new HttpError(403, 'DEVICE_REQUIRED', 'Este dispositivo no está vinculado. Escanea el QR del panel para vincularlo.');
      if (s.revoked_at) throw new HttpError(401, 'DEVICE_REVOKED', 'Este dispositivo fue desvinculado por un administrador.');
      const d = await r.devices.get(s.company_id, s.device_id);
      if (!d) throw new HttpError(401, 'DEVICE_REVOKED', 'Este dispositivo ya no existe.');
      if (d.status !== 'Activo') throw new HttpError(403, 'DEVICE_BLOCKED', `El dispositivo está ${d.status.toLowerCase()}.`);
      const driver = d.driver_id ? (await r.drivers.list(s.company_id)).find((x) => x.id === d.driver_id) : null;
      return { id: d.id, companyId: s.company_id, alias: d.alias, driverEmail: driver?.email?.toLowerCase() ?? null, driverName: driver?.name ?? null, vehiclePlate: d.vehicle_plate };
    });
  }

  async function issueToken(r, ctx, deviceId) {
    const token = randomToken(32); const id = uuid(); const at = new Date(clock()); const expiresAt = addMinutes(at, LINK_TTL_MIN);
    if (deviceId) await r.linkTokens.invalidateForDevice(deviceId, iso(at));
    await r.linkTokens.create({ id, tokenHash: sha256(token), companyId: ctx.companyId, deviceId, expiresAt: iso(expiresAt), createdAt: iso(at) });
    await audit(r, ctx, 'device.link_token_issued', { entity: 'device', entityId: deviceId, detail: { jti: id } });
    return { token, jti: id, expiresAt: iso(expiresAt), ttlSeconds: LINK_TTL_MIN * 60, apiUrl: config.publicApiUrl, linkUrl: `${config.publicWebUrl}/repartidor/vincular#t=${token}` };
  }

  /** La app móvil confirma la vinculación con el token del QR. Devuelve la credencial del dispositivo (Bearer). */
  async function mobileLink(b = {}) {
    if (!b.token || typeof b.token !== 'string') throw badRequest('Falta el token del QR.');
    const hash = sha256(b.token); const deviceToken = randomToken(32);
    return store.tx(async (r) => {
      const tok = await r.linkTokens.findByHash(hash);
      if (!tok) throw new HttpError(401, 'LINK_INVALID', 'El código QR no es válido. Genera uno nuevo desde la web.');
      if (tok.used_at || Date.parse(tok.expires_at) < clock()) throw new HttpError(410, 'LINK_USED', 'Este código QR ya se usó o expiró.');
      const companyId = tok.company_id; let d;
      if (tok.device_id) d = await r.devices.get(companyId, tok.device_id);
      else {
        const brand = nul(b.brand) || ''; const model = nul(b.model) || '';
        const alias = ((model.toLowerCase().startsWith(brand.toLowerCase()) ? model : `${brand} ${model}`).trim().slice(0, 60)) || 'Dispositivo móvil';
        let imei = nul(b.serial); if (!imei || !/^[A-Za-z0-9-]{5,40}$/.test(imei)) imei = `MOB-${tok.id.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
        d = await r.devices.findByImei(companyId, imei);
        if (d) d = await r.devices.get(companyId, d.id);
        else d = await r.devices.create({ id: uuid(), companyId, alias, imei, brand: brand || null, model: model || null, os: nul(b.os), osVersion: nul(b.osVersion), status: 'Activo' });
        await r.linkTokens.attachDevice(tok.id, d.id);
      }
      if (!d) throw notFound('Dispositivo no encontrado.');
      if (d.status === 'Robado') throw new HttpError(403, 'DEVICE_STOLEN', 'Dispositivo bloqueado.');
      const at = iso(new Date(clock()));
      await r.devices.markLinked(d.id, { model: nul(b.model), os: nul(b.os), osVersion: nul(b.osVersion), fcmToken: nul(b.fcmToken), at });
      await r.linkTokens.invalidateForDevice(d.id, at);
      await r.linkTokens.consume(tok.id, at);
      await r.devices.addLink({ id: uuid(), deviceId: d.id, driverId: d.driver_id, model: nul(b.model), os: nul(b.os), fcmToken: nul(b.fcmToken), linkedAt: at });
      await r.deviceSessions.revokeForDevice(d.id, at);
      await r.deviceSessions.create({ id: uuid(), tokenHash: sha256(deviceToken), deviceId: d.id, companyId, createdAt: at });
      await audit(r, { companyId, name: 'Dispositivo móvil' }, 'device.linked', { entity: 'device', entityId: d.id, detail: { alias: d.alias } });
      const info = await r.devices.get(companyId, d.id);
      return { _companyId: companyId, _jti: tok.id, ok: true, deviceToken, device: { id: info.id, alias: info.alias }, driver: info.driver_id ? { id: info.driver_id, name: info.driver_name } : null, vehicle: info.vehicle_plate || null };
    });
  }
  return { drivers, vehicles, devices, mobileLink: async (b) => { const out = await mobileLink(b); bus?.publish({ companyId: out._companyId, type: 'device.linked', data: { deviceId: out.device.id, alias: out.device.alias, jti: out._jti } }); delete out._companyId; delete out._jti; return out; }, deviceFromToken };
}
module.exports = { createFleetService };
