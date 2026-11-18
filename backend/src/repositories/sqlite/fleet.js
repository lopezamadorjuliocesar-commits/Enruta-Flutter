'use strict';
const { iso } = require('../../utils/ids');
const DEVICE_SELECT = `SELECT d.*, dr.name AS driver_name, v.plate AS vehicle_plate, v.description AS vehicle_description
  FROM devices d LEFT JOIN drivers dr ON dr.id=d.driver_id LEFT JOIN vehicles v ON v.id=d.vehicle_id`;

module.exports = function fleetRepos(conn) {
  const get = (sql, ...p) => conn.prepare(sql).get(...p);
  const all = (sql, ...p) => conn.prepare(sql).all(...p);
  const run = (sql, ...p) => conn.prepare(sql).run(...p);
  return {
    drivers: {
      async list(companyId) { return all('SELECT * FROM drivers WHERE company_id=? ORDER BY name COLLATE NOCASE', companyId); },
      async create(d) { run('INSERT INTO drivers (id,company_id,name,email,phone,created_at) VALUES (@id,@companyId,@name,@email,@phone,@createdAt)', { email: null, phone: null, createdAt: iso(), ...d }); return get('SELECT * FROM drivers WHERE id=?', d.id); },
      async update(companyId, id, d) { return run('UPDATE drivers SET name=@name,email=@email,phone=@phone WHERE id=@id AND company_id=@companyId', { ...d, id, companyId }).changes; },
      async delete(companyId, id) { return run('DELETE FROM drivers WHERE id=? AND company_id=?', id, companyId).changes; },
      async upsertByEmail(companyId, d) {
        run(`INSERT INTO drivers (id,company_id,name,email,phone,created_at) VALUES (@id,@companyId,@name,@email,@phone,@createdAt)
             ON CONFLICT (company_id, lower(email)) WHERE email IS NOT NULL DO UPDATE SET name=excluded.name, phone=COALESCE(excluded.phone, drivers.phone)`, { phone: null, createdAt: iso(), ...d, companyId });
      },
    },
    vehicles: {
      async list(companyId) { return all('SELECT * FROM vehicles WHERE company_id=? ORDER BY plate', companyId); },
      async create(v) { run('INSERT INTO vehicles (id,company_id,plate,description,created_at) VALUES (@id,@companyId,@plate,@description,@createdAt)', { description: null, createdAt: iso(), ...v }); return get('SELECT * FROM vehicles WHERE id=?', v.id); },
      async update(companyId, id, v) { return run('UPDATE vehicles SET plate=@plate,description=@description WHERE id=@id AND company_id=@companyId', { ...v, id, companyId }).changes; },
      async delete(companyId, id) { return run('DELETE FROM vehicles WHERE id=? AND company_id=?', id, companyId).changes; },
      async get(companyId, id) { return get('SELECT * FROM vehicles WHERE id=? AND company_id=?', id, companyId); },
    },
    devices: {
      async list(companyId) { return all(`${DEVICE_SELECT} WHERE d.company_id=? ORDER BY d.created_at DESC, d.rowid DESC`, companyId); },
      async get(companyId, id) { return get(`${DEVICE_SELECT} WHERE d.id=? AND d.company_id=?`, id, companyId); },
      async create(d) {
        const t = iso();
        run(`INSERT INTO devices (id,company_id,alias,imei_serial,brand,model,os,os_version,phone,driver_id,vehicle_id,status,created_at,updated_at)
             VALUES (@id,@companyId,@alias,@imei,@brand,@model,@os,@osVersion,@phone,@driverId,@vehicleId,@status,@t,@t)`, { brand: null, model: null, os: null, osVersion: null, phone: null, driverId: null, vehicleId: null, status: 'Activo', ...d, t });
        return get(`${DEVICE_SELECT} WHERE d.id=?`, d.id);
      },
      async update(companyId, id, d) {
        return run(`UPDATE devices SET alias=@alias,imei_serial=@imei,brand=@brand,model=@model,os=@os,os_version=@osVersion,phone=@phone,driver_id=@driverId,vehicle_id=@vehicleId,status=@status,updated_at=@t
                    WHERE id=@id AND company_id=@companyId`, { ...d, id, companyId, t: iso() }).changes;
      },
      async delete(companyId, id) { return run('DELETE FROM devices WHERE id=? AND company_id=?', id, companyId).changes; },
      async findByImei(companyId, imei) { return get('SELECT * FROM devices WHERE company_id=? AND upper(imei_serial)=upper(?)', companyId, imei); },
      async markLinked(id, { model, os, osVersion, fcmToken, at }) {
        run(`UPDATE devices SET reported_model=?, reported_os=?, os_version=COALESCE(os_version,?), fcm_token=?, linked_at=?,
             status=CASE WHEN status='Inactivo' THEN 'Activo' ELSE status END, updated_at=? WHERE id=?`, model, os, osVersion, fcmToken, at, at, id);
      },
      async addLink(l) { run('INSERT INTO device_links (id,device_id,driver_id,model,os,fcm_token,linked_at) VALUES (@id,@deviceId,@driverId,@model,@os,@fcmToken,@linkedAt)', l); },
    },
    linkTokens: {
      async create(t) { run('INSERT INTO device_link_tokens (id,token_hash,company_id,device_id,expires_at,created_at) VALUES (@id,@tokenHash,@companyId,@deviceId,@expiresAt,@createdAt)', { deviceId: null, createdAt: iso(), ...t }); },
      async findByHash(hash) { return get('SELECT * FROM device_link_tokens WHERE token_hash=?', hash); },
      async get(companyId, id) { return get('SELECT * FROM device_link_tokens WHERE id=? AND company_id=?', id, companyId); },
      async invalidateForDevice(deviceId, at) { run('UPDATE device_link_tokens SET used_at=? WHERE device_id=? AND used_at IS NULL', at, deviceId); },
      async consume(id, at) { return run('UPDATE device_link_tokens SET used_at=? WHERE id=? AND used_at IS NULL', at, id).changes; },
      async attachDevice(id, deviceId) { run('UPDATE device_link_tokens SET device_id=?, created_device_id=? WHERE id=?', deviceId, deviceId, id); },
    },
    deviceSessions: {
      async create(s) { run('INSERT INTO device_sessions (id,token_hash,device_id,company_id,created_at) VALUES (@id,@tokenHash,@deviceId,@companyId,@createdAt)', { createdAt: iso(), ...s }); },
      async findByHash(hash) { return get('SELECT * FROM device_sessions WHERE token_hash=?', hash); },
      async revokeForDevice(deviceId, at) { return run('UPDATE device_sessions SET revoked_at=? WHERE device_id=? AND revoked_at IS NULL', at, deviceId).changes; },
    },
  };
};
