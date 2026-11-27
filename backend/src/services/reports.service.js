'use strict';
// Indicadores calculados desde la BD real (entregas, cumplimiento, tiempos, cobros, diferencias, incidencias) con filtros y exportación CSV.
const { unprocessable, notFound } = require('../utils/errors');
const { scopeCenterIds } = require('./context');
const { INCIDENT_REASONS } = require('./execution.service');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/; const DAY = 86_400_000;
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const n = (v) => Number(v ?? 0);
const csvCell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (rows) => `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
const money = (c) => (n(c) / 100).toFixed(2);

function createReportsService({ store, clock }) {
  function filters(ctx, q = {}) {
    const today = new Date(clock()).toISOString().slice(0, 10);
    const to = q.to ? String(q.to) : today; const from = q.from ? String(q.from) : new Date(Date.parse(to) - 29 * DAY).toISOString().slice(0, 10);
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw unprocessable('Las fechas deben tener el formato AAAA-MM-DD.', 'DATE_INVALID');
    if (from > to) throw unprocessable('La fecha inicial no puede ser posterior a la final.', 'RANGE_INVALID');
    let centerIds = scopeCenterIds(ctx);
    if (q.centerId) { if (!ctx.accessibleCenterIds.includes(String(q.centerId))) throw notFound('Centro no encontrado.'); centerIds = [String(q.centerId)]; }
    return { companyId: ctx.companyId, from, to, centerIds, routeId: q.routeId ? String(q.routeId) : null, operatorId: q.operatorId ? String(q.operatorId) : null };
  }

  async function summary(ctx, q) {
    const f = filters(ctx, q);
    if (!f.centerIds.length) return { filters: { from: f.from, to: f.to }, empty: true };
    return store.read(async (r) => {
      const R = r.reports; const v = R.visits(f); const del = Object.fromEntries(R.deliveries(f).map((d) => [d.status, d])); const u = R.units(f);
      const delivered = n(del.DELIVERED?.n); const partial = n(del.PARTIAL?.n); const failed = n(del.FAILED?.n); const skipped = n(v.skipped); const resolved = delivered + partial + failed + skipped;
      const pays = R.payments(f); const collected = pays.reduce((a, p) => a + n(p.cents), 0);
      const sets = R.settlements(f); const sum = (k) => sets.reduce((a, s) => a + n(s[k]), 0);
      const inc = new Map(); for (const i of [...R.incidents(f), ...R.extraIncidents(f)]) inc.set(i.reason, (inc.get(i.reason) ?? 0) + n(i.n));
      const sales = ['DELIVERED', 'PARTIAL', 'FAILED'].reduce((a, k) => a + n(del[k]?.cents), 0);
      return {
        filters: { from: f.from, to: f.to, centerId: f.centerIds.length === 1 ? f.centerIds[0] : null, routeId: f.routeId, operatorId: f.operatorId },
        visits: { total: n(v.total), closed: n(v.closed), skipped, open: n(v.open), outsideRadius: n(v.outside), outsideRadiusPct: pct(n(v.outside), n(v.total)), avgVisitMinutes: v.avg_min === null ? null : Math.round(n(v.avg_min) * 10) / 10 },
        deliveries: { delivered, partial, failed, resolved, compliancePct: pct(delivered, resolved), completionPct: pct(delivered + partial, resolved), salesCents: sales, unitsPlanned: n(u.planned), unitsDelivered: n(u.delivered), fillRatePct: pct(n(u.delivered), n(u.planned)) },
        payments: { totalCents: collected, count: pays.reduce((a, p) => a + n(p.n), 0), byMethod: Object.fromEntries(pays.map((p) => [p.method, { cents: n(p.cents), count: n(p.n) }])) },
        settlements: { count: sets.reduce((a, s) => a + n(s.n), 0), expectedCents: sum('expected'), depositedCents: sum('deposited'), diffCents: sum('diff'), withDifference: sum('with_diff'), byStatus: Object.fromEntries(sets.map((s) => [s.status, n(s.n)])) },
        incidents: [...inc].map(([reason, count]) => ({ reason, label: INCIDENT_REASONS[reason] ?? reason, count })).sort((a, b) => b.count - a.count),
        routes: { byStatus: Object.fromEntries(R.routeStatus(f).map((s) => [s.status, n(s.n)])) },
        byRoute: R.byRoute(f).map((x) => ({ routeId: x.route_id, route: x.route_name, operator: x.operator_name, visits: n(x.visits), closed: n(x.closed), skipped: n(x.skipped), delivered: n(x.delivered), partial: n(x.partial), failed: n(x.failed), salesCents: n(x.sales_cents), collectedCents: n(x.collected_cents), compliancePct: pct(n(x.delivered), n(x.closed) + n(x.skipped)) })),
        byDay: R.byDay(f).map((d) => ({ day: d.day, visits: n(d.visits), closed: n(d.closed) })),
      };
    });
  }

  return {
    summary,
    /** CSV con las mismas cifras que ve la pantalla (para que exportación y vista coincidan). */
    async exportCsv(ctx, q) {
      const s = await summary(ctx, q); if (s.empty) return csv([['Sin datos']]);
      const rows = [['Indicador', 'Valor'], ['Periodo', `${s.filters.from} a ${s.filters.to}`], ['Visitas', s.visits.total], ['Visitas cerradas', s.visits.closed], ['Visitas sin visitar', s.visits.skipped], ['Llegadas fuera de radio', s.visits.outsideRadius],
        ['Tiempo promedio por visita (min)', s.visits.avgVisitMinutes], ['Entregas totales', s.deliveries.delivered], ['Entregas parciales', s.deliveries.partial], ['Entregas fallidas', s.deliveries.failed], ['Cumplimiento (%)', s.deliveries.compliancePct],
        ['Surtido de unidades (%)', s.deliveries.fillRatePct], ['Ventas (MXN)', money(s.deliveries.salesCents)], ['Cobrado (MXN)', money(s.payments.totalCents)],
        ...Object.entries(s.payments.byMethod).map(([m, x]) => [`Cobrado ${m} (MXN)`, money(x.cents)]), ['Efectivo esperado (MXN)', money(s.settlements.expectedCents)], ['Efectivo depositado (MXN)', money(s.settlements.depositedCents)], ['Diferencia (MXN)', money(s.settlements.diffCents)], ['Liquidaciones con diferencia', s.settlements.withDifference],
        ...s.incidents.map((i) => [`Incidencia: ${i.label}`, i.count]), [], ['Ruta', 'Operador', 'Visitas', 'Cerradas', 'Sin visitar', 'Totales', 'Parciales', 'Fallidas', 'Ventas (MXN)', 'Cobrado (MXN)', 'Cumplimiento (%)'],
        ...s.byRoute.map((x) => [x.route, x.operator, x.visits, x.closed, x.skipped, x.delivered, x.partial, x.failed, money(x.salesCents), money(x.collectedCents), x.compliancePct])];
      return csv(rows);
    },
  };
}
module.exports = { createReportsService, csv };
