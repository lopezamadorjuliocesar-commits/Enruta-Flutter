'use strict';
const { iso } = require('../../utils/ids');

const SELECT = `SELECT r.*, u.name AS operator_name, u.status AS operator_status, v.plate AS vehicle_plate
  FROM routes r LEFT JOIN users u ON u.id=r.operator_user_id LEFT JOIN vehicles v ON v.id=r.vehicle_id`;
const inList = (col, ids, p, prefix) => `${col} IN (${ids.map((id, i) => { p[`${prefix}${i}`] = id; return `@${prefix}${i}`; }).join(',')})`;

module.exports = function routesRepos(conn) {
  const get = (sql, ...p) => conn.prepare(sql).get(...p);
  const all = (sql, ...p) => conn.prepare(sql).all(...p);
  const run = (sql, ...p) => conn.prepare(sql).run(...p);
  return {
    routes: {
      async list(companyId, centerIds) {
        if (!centerIds.length) return [];
        const p = { companyId }; return all(`${SELECT} WHERE r.company_id=@companyId AND ${inList('r.center_id', centerIds, p, 'c')} ORDER BY r.created_at, r.rowid`, p);
      },
      async get(companyId, id, centerIds = null) {
        const row = get(`${SELECT} WHERE r.company_id=? AND r.id=?`, companyId, id);
        return row && (!centerIds || centerIds.includes(row.center_id)) ? row : undefined;
      },
      async listAssigned(companyId, userId, statuses) {
        const p = { companyId, userId }; return all(`${SELECT} WHERE r.company_id=@companyId AND r.operator_user_id=@userId AND ${inList('r.status', statuses, p, 's')} ORDER BY r.updated_at DESC`, p);
      },
      async create(r) {
        const t = iso();
        run(`INSERT INTO routes (id,company_id,center_id,zone_id,name,day,color,operator_user_id,vehicle_id,created_by,created_at,updated_at)
             VALUES (@id,@companyId,@centerId,@zoneId,@name,@day,@color,@operatorId,@vehicleId,@createdBy,@t,@t)`, { zoneId: null, day: null, color: null, operatorId: null, vehicleId: null, createdBy: null, ...r, t });
        return get(`${SELECT} WHERE r.id=?`, r.id);
      },
      /** `patch` usa nombres de columna. */
      async update(companyId, id, patch) {
        const keys = Object.keys(patch); if (!keys.length) return 0;
        const params = { _c: companyId, _id: id, _t: iso() }; for (const k of keys) params[k] = patch[k];
        return run(`UPDATE routes SET ${keys.map((k) => `${k}=@${k}`).join(',')}, updated_at=@_t WHERE company_id=@_c AND id=@_id`, params).changes;
      },
      async delete(companyId, id) { return run('DELETE FROM routes WHERE company_id=? AND id=?', companyId, id).changes; },
      async nameTaken(companyId, name, exceptId = null) { return !!get('SELECT 1 x FROM routes WHERE company_id=? AND lower(name)=lower(?) AND id<>?', companyId, name, exceptId ?? ''); },
      async stops(routeId) { return all('SELECT client_id, seq FROM route_stops WHERE route_id=? ORDER BY seq', routeId); },
      async stopsOf(routeIds) {
        if (!routeIds.length) return new Map();
        const p = {}; const rows = all(`SELECT route_id, client_id, seq FROM route_stops WHERE ${inList('route_id', routeIds, p, 'r')} ORDER BY seq`, p); const out = new Map();
        for (const r of rows) out.set(r.route_id, [...(out.get(r.route_id) ?? []), r.client_id]);
        return out;
      },
      async setStops(routeId, clientIds) {
        run('DELETE FROM route_stops WHERE route_id=?', routeId);
        const ins = conn.prepare('INSERT INTO route_stops (route_id,client_id,seq) VALUES (?,?,?)'); clientIds.forEach((c, i) => ins.run(routeId, c, i + 1));
      },
      async stopClients(routeId) {
        return all(`SELECT c.id, c.name, c.address, c.phone, c.lat, c.lng, c.status, s.seq FROM route_stops s JOIN clients c ON c.id=s.client_id WHERE s.route_id=? ORDER BY s.seq`, routeId);
      },
    },
    approvals: {
      async create(a) { run('INSERT INTO route_approvals (id,route_id,revision,requested_by,requested_at) VALUES (@id,@routeId,@revision,@requestedBy,@at)', a); },
      async open(routeId) { return get(`SELECT * FROM route_approvals WHERE route_id=? AND decision='PENDING' ORDER BY requested_at DESC LIMIT 1`, routeId); },
      async decide(id, { decision, by, at, reason = null, selfApproved = 0 }) { return run('UPDATE route_approvals SET decision=?, decided_by=?, decided_at=?, reason=?, self_approved=? WHERE id=? AND decision=\'PENDING\'', decision, by, at, reason, selfApproved, id).changes; },
      /** Una edicion relevante invalida la solicitud pendiente y la aprobacion vigente. */
      async invalidateFor(routeId, at, reason) {
        return run(`UPDATE route_approvals SET decision='INVALIDATED', decided_at=?, reason=? WHERE route_id=? AND decision IN ('PENDING','APPROVED')`, at, reason, routeId).changes;
      },
      async list(routeId) { return all('SELECT * FROM route_approvals WHERE route_id=? ORDER BY requested_at, rowid', routeId); },
    },
    routeHistory: {
      async add(h) { run('INSERT INTO route_status_history (route_id,from_status,to_status,revision,actor_id,note,at) VALUES (@routeId,@from,@to,@revision,@actorId,@note,@at)', { from: null, actorId: null, note: null, ...h }); },
      async list(routeId) { return all('SELECT * FROM route_status_history WHERE route_id=? ORDER BY id', routeId); },
    },
    routeRefs: {
      async clientsByIds(companyId, ids) {
        if (!ids.length) return [];
        const p = { companyId }; return all(`SELECT * FROM clients WHERE company_id=@companyId AND ${inList('id', ids, p, 'i')}`, p);
      },
    },
  };
};
