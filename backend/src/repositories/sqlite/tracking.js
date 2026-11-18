'use strict';
const { iso } = require('../../utils/ids');

module.exports = function trackingRepos(conn) {
  const get = (sql, ...p) => conn.prepare(sql).get(...p);
  const all = (sql, ...p) => conn.prepare(sql).all(...p);
  const run = (sql, ...p) => conn.prepare(sql).run(...p);
  return {
    positions: {
      async insertMany(rows) {
        const ins = conn.prepare(`INSERT INTO positions (company_id,center_id,route_id,user_id,lat,lng,accuracy_m,speed_mps,heading,source,recorded_at,received_at)
          VALUES (@companyId,@centerId,@routeId,@userId,@lat,@lng,@accuracyM,@speedMps,@heading,@source,@recordedAt,@receivedAt) ON CONFLICT DO NOTHING`);
        let n = 0; for (const r of rows) n += ins.run({ userId: null, accuracyM: null, speedMps: null, heading: null, ...r }).changes; return n;
      },
      /** Última posición por ruta (la más reciente por `recorded_at`, REAL o SIMULATED). */
      async latestForRoutes(routeIds) {
        const out = []; for (const id of routeIds) { const r = get('SELECT * FROM positions WHERE route_id=? ORDER BY recorded_at DESC, id DESC LIMIT 1', id); if (r) out.push(r); } return out;
      },
      async history(routeId, { from, to, limit = 1000 } = {}) {
        const p = [routeId]; let where = 'route_id=?'; if (from) { where += ' AND recorded_at>=?'; p.push(from); } if (to) { where += ' AND recorded_at<=?'; p.push(to); }
        return all(`SELECT lat,lng,accuracy_m,speed_mps,heading,source,recorded_at FROM positions WHERE ${where} ORDER BY recorded_at LIMIT ?`, ...p, Math.min(Number(limit) || 1000, 5000));
      },
    },
    simulations: {
      async get(routeId) { return get('SELECT * FROM simulations WHERE route_id=?', routeId); },
      async running() { return all(`SELECT * FROM simulations WHERE status='RUNNING'`); },
      async start(s) { run(`INSERT INTO simulations (route_id,company_id,status,speed_kmh,progress_m,started_by,started_at,updated_at) VALUES (@routeId,@companyId,'RUNNING',@speedKmh,0,@startedBy,@t,@t)
        ON CONFLICT(route_id) DO UPDATE SET status='RUNNING', speed_kmh=excluded.speed_kmh, progress_m=0, started_by=excluded.started_by, started_at=excluded.started_at, updated_at=excluded.updated_at`, { ...s, t: iso() }); },
      async progress(routeId, progressM, status, at) { run('UPDATE simulations SET progress_m=?, status=?, updated_at=? WHERE route_id=?', progressM, status, at, routeId); },
      async stopAllRunning(at) { return run(`UPDATE simulations SET status='STOPPED', updated_at=? WHERE status='RUNNING'`, at).changes; },
    },
  };
};
