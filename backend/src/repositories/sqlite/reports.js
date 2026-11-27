'use strict';
// Consultas agregadas para indicadores: todo se calcula desde las tablas operativas (visitas, entregas, cobros, liquidaciones, incidencias).
module.exports = function reportRepos(conn) {
  const all = (sql, p) => conn.prepare(sql).all(p);
  const get = (sql, p) => conn.prepare(sql).get(p);
  /** Filtro común de visitas: empresa, centros visibles, periodo (por fecha de llegada) y ruta/operador opcionales. */
  const scope = (f) => {
    const p = { c: f.companyId, from: f.from, to: f.to }; const where = ['v.company_id=@c', "substr(COALESCE(v.arrived_at, v.created_at),1,10) BETWEEN @from AND @to"];
    where.push(`v.center_id IN (${f.centerIds.map((id, i) => { p[`k${i}`] = id; return `@k${i}`; }).join(',')})`);
    if (f.routeId) { where.push('v.route_id=@route'); p.route = f.routeId; } if (f.operatorId) { where.push('r.operator_user_id=@op'); p.op = f.operatorId; }
    return { p, w: where.join(' AND ') };
  };
  const base = 'FROM visits v JOIN routes r ON r.id=v.route_id';
  return {
    reports: {
      visits(f) { const { p, w } = scope(f); return get(`SELECT COUNT(*) total, SUM(v.status='CLOSED') closed, SUM(v.status='SKIPPED') skipped, SUM(v.status='OPEN') open, SUM(v.outside_radius_reason IS NOT NULL) outside,
        AVG(CASE WHEN v.status='CLOSED' AND v.closed_at IS NOT NULL AND v.arrived_at IS NOT NULL THEN (julianday(v.closed_at)-julianday(v.arrived_at))*1440 END) avg_min ${base} WHERE ${w}`, p); },
      deliveries(f) { const { p, w } = scope(f); return all(`SELECT d.status, COUNT(*) n, COALESCE(SUM(d.total_cents),0) cents ${base} JOIN deliveries d ON d.visit_id=v.id WHERE ${w} GROUP BY d.status`, p); },
      units(f) { const { p, w } = scope(f); return get(`SELECT COALESCE(SUM(l.qty_planned),0) planned, COALESCE(SUM(l.qty_delivered),0) delivered ${base} JOIN deliveries d ON d.visit_id=v.id JOIN delivery_lines l ON l.delivery_id=d.id WHERE ${w}`, p); },
      payments(f) { const { p, w } = scope(f); return all(`SELECT pay.method, COUNT(*) n, COALESCE(SUM(pay.amount_cents),0) cents ${base} JOIN payments pay ON pay.visit_id=v.id WHERE ${w} GROUP BY pay.method`, p); },
      incidents(f) { const { p, w } = scope(f); return all(`SELECT d.incident_reason reason, COUNT(*) n ${base} JOIN deliveries d ON d.visit_id=v.id WHERE ${w} AND d.status='FAILED' AND d.incident_reason IS NOT NULL GROUP BY d.incident_reason`, p); },
      extraIncidents(f) {
        const p = { c: f.companyId, from: f.from, to: f.to }; const w = ['i.company_id=@c', 'substr(i.created_at,1,10) BETWEEN @from AND @to', `r.center_id IN (${f.centerIds.map((id, i) => { p[`k${i}`] = id; return `@k${i}`; }).join(',')})`];
        if (f.routeId) { w.push('i.route_id=@route'); p.route = f.routeId; } if (f.operatorId) { w.push('r.operator_user_id=@op'); p.op = f.operatorId; }
        return all(`SELECT i.reason, COUNT(*) n FROM incidents i JOIN routes r ON r.id=i.route_id WHERE ${w.join(' AND ')} GROUP BY i.reason`, p);
      },
      byRoute(f) { const { p, w } = scope(f); return all(`SELECT r.id route_id, r.name route_name, u.name operator_name, COUNT(*) visits, SUM(v.status='CLOSED') closed, SUM(v.status='SKIPPED') skipped,
        SUM(d.status='DELIVERED') delivered, SUM(d.status='PARTIAL') partial, SUM(d.status='FAILED') failed, COALESCE(SUM(d.total_cents),0) sales_cents,
        COALESCE((SELECT SUM(pay.amount_cents) FROM payments pay JOIN visits v2 ON v2.id=pay.visit_id WHERE pay.route_id=r.id AND substr(COALESCE(v2.arrived_at, v2.created_at),1,10) BETWEEN @from AND @to),0) collected_cents
        ${base} LEFT JOIN users u ON u.id=r.operator_user_id LEFT JOIN deliveries d ON d.visit_id=v.id WHERE ${w} GROUP BY r.id ORDER BY r.name COLLATE NOCASE`, p); },
      byDay(f) { const { p, w } = scope(f); return all(`SELECT substr(COALESCE(v.arrived_at, v.created_at),1,10) day, COUNT(*) visits, SUM(v.status='CLOSED') closed FROM visits v JOIN routes r ON r.id=v.route_id WHERE ${w} GROUP BY day ORDER BY day`, p); },
      settlements(f) {
        const p = { c: f.companyId, from: f.from, to: f.to }; const w = ['s.company_id=@c', 'substr(s.created_at,1,10) BETWEEN @from AND @to', `s.center_id IN (${f.centerIds.map((id, i) => { p[`k${i}`] = id; return `@k${i}`; }).join(',')})`];
        if (f.routeId) { w.push('s.route_id=@route'); p.route = f.routeId; } if (f.operatorId) { w.push('r.operator_user_id=@op'); p.op = f.operatorId; }
        return all(`SELECT s.status, COUNT(*) n, COALESCE(SUM(s.expected_cents),0) expected, COALESCE(SUM(s.deposited_cents),0) deposited, COALESCE(SUM(s.diff_cents),0) diff, SUM(s.diff_cents<>0) with_diff FROM settlements s JOIN routes r ON r.id=s.route_id WHERE ${w.join(' AND ')} GROUP BY s.status`, p);
      },
      routeStatus(f) {
        const p = { c: f.companyId }; const w = ['r.company_id=@c', `r.center_id IN (${f.centerIds.map((id, i) => { p[`k${i}`] = id; return `@k${i}`; }).join(',')})`];
        if (f.routeId) { w.push('r.id=@route'); p.route = f.routeId; } if (f.operatorId) { w.push('r.operator_user_id=@op'); p.op = f.operatorId; }
        return all(`SELECT r.status, COUNT(*) n FROM routes r WHERE ${w.join(' AND ')} GROUP BY r.status`, p);
      },
    },
  };
};
