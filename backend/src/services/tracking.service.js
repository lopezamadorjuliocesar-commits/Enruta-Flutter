'use strict';
// GPS y torre de control (3.B). Estado visual del vehículo (DT-41): REAL / SIMULATED (≤ GPS_STALE_SECONDS), STALE, OFFLINE.
// El simulador es EXPLÍCITO: genera posiciones con source=SIMULATED y nunca se presenta como GPS real.
const { iso } = require('../utils/ids');
const { conflict, notFound, unprocessable, forbidden } = require('../utils/errors');
const { scopeCenterIds, makeAudit } = require('./context');
const { distanceMeters } = require('./execution.service');

function createTrackingService({ store, clock, bus, config }) {
  const audit = makeAudit(clock); const now = () => iso(new Date(clock()));
  const staleS = config.gpsStaleSeconds; const offlineS = config.gpsOfflineSeconds;
  const timers = new Map();   // routeId → intervalo del simulador

  const statusOf = (source, ageS) => (ageS <= staleS ? source : ageS <= offlineS ? 'STALE' : 'OFFLINE');
  const toDto = (p, route, nowMs) => {
    const age = Math.max(0, Math.round((nowMs - Date.parse(p.recorded_at)) / 1000));
    return { routeId: route.id, routeName: route.name, color: route.color, operatorName: route.operator_name, lat: p.lat, lng: p.lng, accuracyM: p.accuracy_m, speedMps: p.speed_mps, source: p.source, recordedAt: p.recorded_at, ageSeconds: age, status: statusOf(p.source, age) };
  };

  /** Camino del simulador: los puntos (lat,lng) de las paradas en orden. */
  const pathOf = (stops) => { const pts = stops.filter((s) => s.lat !== null && s.lng !== null).map((s) => ({ lat: s.lat, lng: s.lng })); const segs = []; let total = 0; for (let i = 1; i < pts.length; i++) { const d = distanceMeters(pts[i - 1], pts[i]); segs.push({ a: pts[i - 1], b: pts[i], d, start: total }); total += d; } return { pts, segs, total }; };
  const pointAt = (path, m) => { if (!path.segs.length) return path.pts[0]; const seg = path.segs.find((s) => m <= s.start + s.d) ?? path.segs.at(-1); const f = seg.d ? Math.min(1, Math.max(0, (m - seg.start) / seg.d)) : 1; return { lat: seg.a.lat + (seg.b.lat - seg.a.lat) * f, lng: seg.a.lng + (seg.b.lng - seg.a.lng) * f }; };

  const svc = {
    statusOf,
    /** Posiciones REALES enviadas por el dispositivo del operador. */
    async ingest(ctx, routeId, list) {
      if (!Array.isArray(list) || !list.length || list.length > 100) throw unprocessable('Envía entre 1 y 100 posiciones.', 'POSITIONS_INVALID');
      const t = clock(); const rows = []; let discarded = 0;
      for (const p of list) {
        const lat = Number(p?.lat); const lng = Number(p?.lng); const acc = p.accuracy === undefined || p.accuracy === null ? null : Number(p.accuracy); const at = Date.parse(p?.recordedAt ?? '');
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (acc !== null && (!Number.isFinite(acc) || acc > 500)) || !Number.isFinite(at) || at > t + 60_000) { discarded++; continue; }
        rows.push({ lat, lng, accuracyM: acc, speedMps: Number.isFinite(Number(p.speed)) ? Number(p.speed) : null, heading: Number.isFinite(Number(p.heading)) ? Number(p.heading) : null, source: 'REAL', recordedAt: iso(at) });
      }
      const out = await store.tx(async (r) => {
        const route = await r.routes.get(ctx.companyId, routeId); if (!route || route.operator_user_id !== ctx.userId) throw notFound('Ruta no encontrada.');
        if (route.status !== 'IN_PROGRESS') throw conflict('La ruta no está en ejecución.', 'ROUTE_NOT_STARTED');
        const accepted = await r.positions.insertMany(rows.map((x) => ({ ...x, companyId: ctx.companyId, centerId: route.center_id, routeId, userId: ctx.userId, receivedAt: now() })));
        return { route, accepted };
      });
      const last = rows.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)).at(-1);
      if (last && out.accepted) bus?.publish({ companyId: ctx.companyId, centerId: out.route.center_id, type: 'position', data: { routeId, lat: last.lat, lng: last.lng, source: 'REAL', recordedAt: last.recordedAt } });
      return { accepted: out.accepted, discarded, duplicates: rows.length - out.accepted };
    },

    async live(ctx) {
      return store.read(async (r) => {
        const routes = (await r.routes.list(ctx.companyId, scopeCenterIds(ctx))).filter((x) => x.status === 'IN_PROGRESS'); const nowMs = clock(); const vehicles = [];
        const latest = new Map((await r.positions.latestForRoutes(routes.map((x) => x.id))).map((p) => [p.route_id, p]));
        for (const route of routes) {
          const p = latest.get(route.id);
          vehicles.push(p ? toDto(p, route, nowMs) : { routeId: route.id, routeName: route.name, color: route.color, operatorName: route.operator_name, lat: null, lng: null, source: null, recordedAt: null, ageSeconds: null, status: 'OFFLINE' });
        }
        const sims = []; for (const route of routes) { const s = await r.simulations.get(route.id); if (s?.status === 'RUNNING') sims.push(route.id); }
        return { serverTime: now(), thresholds: { staleSeconds: staleS, offlineSeconds: offlineS }, vehicles, simulationsRunning: sims, simulatorEnabled: config.simulatorEnabled };
      });
    },

    async history(ctx, routeId, q = {}) {
      return store.read(async (r) => { const route = await r.routes.get(ctx.companyId, routeId, scopeCenterIds(ctx)); if (!route) throw notFound('Ruta no encontrada.'); return { routeId, points: (await r.positions.history(routeId, q)).map((p) => ({ lat: p.lat, lng: p.lng, accuracyM: p.accuracy_m, source: p.source, recordedAt: p.recorded_at })) }; });
    },

    // ----- simulador explícito -----
    async startSimulation(ctx, routeId, b = {}) {
      if (!config.simulatorEnabled) throw forbidden('El simulador está desactivado en este entorno.', 'SIMULATOR_DISABLED');
      const speed = Number(b.speedKmh ?? 40); if (!Number.isFinite(speed) || speed < 5 || speed > 120) throw unprocessable('La velocidad debe estar entre 5 y 120 km/h.', 'SPEED_INVALID');
      const route = await store.tx(async (r) => {
        const route = await r.routes.get(ctx.companyId, routeId, scopeCenterIds(ctx)); if (!route) throw notFound('Ruta no encontrada.');
        if (route.status !== 'IN_PROGRESS') throw conflict('Solo se puede simular una ruta en ejecución.', 'ROUTE_NOT_STARTED');
        if ((await r.routes.stopClients(routeId)).filter((s) => s.lat !== null).length < 2) throw unprocessable('La ruta necesita al menos 2 paradas con ubicación para simular.', 'PATH_TOO_SHORT');
        await r.simulations.start({ routeId, companyId: ctx.companyId, speedKmh: speed, startedBy: ctx.userId });
        await audit(r, ctx, 'simulation.started', { entity: 'route', entityId: routeId, centerId: route.center_id, detail: { speedKmh: speed } });
        return route;
      });
      svc.schedule(routeId, ctx.companyId); await svc.tick(routeId);
      bus?.publish({ companyId: ctx.companyId, centerId: route.center_id, type: 'route.updated', data: { routeId, status: route.status, revision: route.revision, what: 'simulation' } });
      return { routeId, status: 'RUNNING', speedKmh: speed, source: 'SIMULATED' };
    },
    async stopSimulation(ctx, routeId) {
      const route = await store.tx(async (r) => { const route = await r.routes.get(ctx.companyId, routeId, scopeCenterIds(ctx)); if (!route) throw notFound('Ruta no encontrada.'); await r.simulations.progress(routeId, (await r.simulations.get(routeId))?.progress_m ?? 0, 'STOPPED', now()); await audit(r, ctx, 'simulation.stopped', { entity: 'route', entityId: routeId, centerId: route.center_id }); return route; });
      svc.unschedule(routeId);
      bus?.publish({ companyId: ctx.companyId, centerId: route.center_id, type: 'route.updated', data: { routeId, status: route.status, revision: route.revision, what: 'simulation' } });
      return { routeId, status: 'STOPPED' };
    },
    /** Avanza un paso del simulador (llamado por el temporizador o directamente en pruebas). */
    async tick(routeId) {
      const out = await store.tx(async (r) => {
        const sim = await r.simulations.get(routeId); if (!sim || sim.status !== 'RUNNING') return null;
        const route = await r.routes.get(sim.company_id, routeId); if (!route || route.status !== 'IN_PROGRESS') { await r.simulations.progress(routeId, sim.progress_m, 'STOPPED', now()); return { stop: true }; }
        const path = pathOf(await r.routes.stopClients(routeId)); const step = (sim.speed_kmh / 3.6) * config.simulatorStepSeconds; const m = Math.min(path.total, sim.progress_m + step); const pt = pointAt(path, m); const done = m >= path.total;
        await r.positions.insertMany([{ companyId: sim.company_id, centerId: route.center_id, routeId, userId: null, lat: pt.lat, lng: pt.lng, accuracyM: 5, speedMps: sim.speed_kmh / 3.6, heading: null, source: 'SIMULATED', recordedAt: now(), receivedAt: now() }]);
        await r.simulations.progress(routeId, m, done ? 'DONE' : 'RUNNING', now());
        return { route, pt, done, companyId: sim.company_id };
      });
      if (!out) { svc.unschedule(routeId); return null; }
      if (out.stop) { svc.unschedule(routeId); return null; }
      bus?.publish({ companyId: out.companyId, centerId: out.route.center_id, type: 'position', data: { routeId, lat: out.pt.lat, lng: out.pt.lng, source: 'SIMULATED', recordedAt: now() } });
      if (out.done) svc.unschedule(routeId); return out.pt;
    },
    schedule(routeId) { if (timers.has(routeId) || config.simulatorStepSeconds <= 0) return; const t = setInterval(() => { svc.tick(routeId).catch(() => {}); }, config.simulatorStepSeconds * 1000); t.unref?.(); timers.set(routeId, t); },
    unschedule(routeId) { clearInterval(timers.get(routeId)); timers.delete(routeId); },
    /** Al arrancar el servidor ninguna simulación sigue activa (los temporizadores no sobreviven al proceso). */
    async resetSimulations() { return store.tx((r) => r.simulations.stopAllRunning(now())); },
    stopAll() { for (const id of [...timers.keys()]) svc.unschedule(id); },
  };
  return svc;
}
module.exports = { createTrackingService };
