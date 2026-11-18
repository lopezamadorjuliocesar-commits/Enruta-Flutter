'use strict';
const { iso } = require('../../utils/ids');
const inList = (col, ids, p, prefix) => `${col} IN (${ids.map((id, i) => { p[`${prefix}${i}`] = id; return `@${prefix}${i}`; }).join(',')})`;

module.exports = function executionRepos(conn) {
  const get = (sql, ...p) => conn.prepare(sql).get(...p);
  const all = (sql, ...p) => conn.prepare(sql).all(...p);
  const run = (sql, ...p) => conn.prepare(sql).run(...p);
  return {
    visits: {
      async get(companyId, id) { return get('SELECT * FROM visits WHERE company_id=? AND id=?', companyId, id); },
      async byRouteClient(routeId, clientId) { return get('SELECT * FROM visits WHERE route_id=? AND client_id=?', routeId, clientId); },
      async listByRoute(routeId) { return all('SELECT v.*, c.name AS client_name FROM visits v JOIN clients c ON c.id=v.client_id WHERE v.route_id=? ORDER BY v.seq', routeId); },
      async create(v) {
        run(`INSERT INTO visits (id,company_id,center_id,route_id,client_id,seq,status,arrived_at,lat,lng,distance_m,outside_radius_reason,skip_reason,closed_at,created_by,created_at)
             VALUES (@id,@companyId,@centerId,@routeId,@clientId,@seq,@status,@arrivedAt,@lat,@lng,@distanceM,@outsideReason,@skipReason,@closedAt,@createdBy,@createdAt)`,
          { formVersion: null, formData: null, status: 'OPEN', arrivedAt: null, lat: null, lng: null, distanceM: null, outsideReason: null, skipReason: null, closedAt: null, createdBy: null, createdAt: iso(), ...v });
        return get('SELECT * FROM visits WHERE id=?', v.id);
      },
      async update(id, patch) {
        const keys = Object.keys(patch); const p = { _id: id }; for (const k of keys) p[k] = patch[k];
        run(`UPDATE visits SET ${keys.map((k) => `${k}=@${k}`).join(',')} WHERE id=@_id`, p);
      },
      async summary(routeIds) {
        if (!routeIds.length) return new Map();
        const p = {}; const rows = all(`SELECT route_id, status, COUNT(*) n FROM visits WHERE ${inList('route_id', routeIds, p, 'r')} GROUP BY route_id, status`, p);
        const pay = all(`SELECT route_id, COALESCE(SUM(amount_cents),0) c FROM payments WHERE ${inList('route_id', routeIds, p, 'r')} GROUP BY route_id`, p);
        const out = new Map(); for (const id of routeIds) out.set(id, { closed: 0, skipped: 0, open: 0, collectedCents: 0 });
        for (const r of rows) out.get(r.route_id)[r.status === 'CLOSED' ? 'closed' : r.status === 'SKIPPED' ? 'skipped' : 'open'] = r.n;
        for (const r of pay) out.get(r.route_id).collectedCents = r.c; return out;
      },
    },
    deliveries: {
      async byVisit(visitId) { return get('SELECT * FROM deliveries WHERE visit_id=?', visitId); },
      async linesOf(deliveryId) { return all('SELECT l.*, p.name AS product_name, p.sku FROM delivery_lines l JOIN products p ON p.id=l.product_id WHERE l.delivery_id=?', deliveryId); },
      async replace(d, lines) {
        const existing = get('SELECT id FROM deliveries WHERE visit_id=?', d.visitId); const t = iso();
        if (existing) { run('DELETE FROM delivery_lines WHERE delivery_id=?', existing.id); run('DELETE FROM deliveries WHERE id=?', existing.id); }
        run(`INSERT INTO deliveries (id,company_id,visit_id,status,incident_reason,notes,form_version,form_data,total_cents,created_at,updated_at) VALUES (@id,@companyId,@visitId,@status,@incidentReason,@notes,@formVersion,@formData,@totalCents,@t,@t)`, { ...d, t });
        const ins = conn.prepare('INSERT INTO delivery_lines (delivery_id,product_id,qty_planned,qty_delivered,unit_price_cents,discount_bp,reason) VALUES (?,?,?,?,?,?,?)');
        for (const l of lines) ins.run(d.id, l.productId, l.qtyPlanned, l.qtyDelivered, l.unitPriceCents, l.discountBp, l.reason ?? null);
        return get('SELECT * FROM deliveries WHERE id=?', d.id);
      },
    },
    evidences: {
      async create(e) { run('INSERT INTO evidences (id,company_id,visit_id,kind,path,mime,size,sha256,created_by,created_at) VALUES (@id,@companyId,@visitId,@kind,@path,@mime,@size,@sha256,@createdBy,@createdAt)', { createdBy: null, createdAt: iso(), ...e }); },
      async get(companyId, id) { return get('SELECT * FROM evidences WHERE company_id=? AND id=?', companyId, id); },
      async byVisit(visitId) { return all('SELECT id, kind, mime, size, created_at FROM evidences WHERE visit_id=? ORDER BY created_at', visitId); },
      async count(visitId, kind) { return get('SELECT COUNT(*) n FROM evidences WHERE visit_id=@v AND (@k IS NULL OR kind=@k)', { v: visitId, k: kind ?? null }).n; },
    },
    payments: {
      async create(p) {
        run('INSERT INTO payments (id,company_id,route_id,visit_id,client_id,method,amount_cents,reference,form_data,created_by,created_at) VALUES (@id,@companyId,@routeId,@visitId,@clientId,@method,@amountCents,@reference,@formData,@createdBy,@createdAt)', { formData: null, reference: null, createdBy: null, createdAt: iso(), ...p });
      },
      async byVisit(visitId) { return all('SELECT * FROM payments WHERE visit_id=? ORDER BY created_at, rowid', visitId); },
      async sumByVisit(visitId) { return get('SELECT COALESCE(SUM(amount_cents),0) s FROM payments WHERE visit_id=?', visitId).s; },
      async byRoute(routeId) { return all('SELECT method, SUM(amount_cents) c, COUNT(*) n FROM payments WHERE route_id=? GROUP BY method', routeId); },
    },
    ledger: {
      async add(e) { run('INSERT INTO client_ledger (id,company_id,client_id,kind,amount_cents,route_id,visit_id,ref_id,created_at) VALUES (@id,@companyId,@clientId,@kind,@amountCents,@routeId,@visitId,@refId,@createdAt)', { routeId: null, visitId: null, refId: null, createdAt: iso(), ...e }); },
      async removeChargesOfVisit(visitId) { run(`DELETE FROM client_ledger WHERE visit_id=? AND kind='CHARGE'`, visitId); },
      async entries(companyId, clientId) { return all('SELECT * FROM client_ledger WHERE company_id=? AND client_id=? ORDER BY created_at, rowid', companyId, clientId); },
    },
    incidents: {
      async create(i) { run('INSERT INTO incidents (id,company_id,route_id,visit_id,reason,detail,created_by,created_at) VALUES (@id,@companyId,@routeId,@visitId,@reason,@detail,@createdBy,@createdAt)', { visitId: null, detail: null, createdBy: null, createdAt: iso(), ...i }); },
      async byRoute(routeId) { return all('SELECT * FROM incidents WHERE route_id=? ORDER BY created_at', routeId); },
    },
    idempotency: {
      /** Reserva la clave. Devuelve la fila existente si ya estaba (otra petición la tomó). */
      async reserve(companyId, key, hash, at) {
        const r = run('INSERT INTO idempotency_keys (company_id,key,request_hash,created_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING', companyId, key, hash, at);
        return r.changes ? null : get('SELECT * FROM idempotency_keys WHERE company_id=? AND key=?', companyId, key);
      },
      async complete(companyId, key, status, response) { run('UPDATE idempotency_keys SET status_code=?, response=? WHERE company_id=? AND key=?', status, response, companyId, key); },
      async release(companyId, key) { run('DELETE FROM idempotency_keys WHERE company_id=? AND key=?', companyId, key); },
      async purge(before) { return run('DELETE FROM idempotency_keys WHERE created_at<?', before).changes; },
    },
  };
};
