'use strict';
// Liquidaciones (DT-47): esperado = cobros en efectivo de la ruta; depósitos; diferencia contra la tolerancia heredada; autorización por otra persona.
// UNIQUE(route_id) impide la doble liquidación; una liquidación cerrada (conciliada / autorizada / rechazada) es inmutable.
const { uuid, iso } = require('../utils/ids');
const { HttpError, conflict, notFound, unprocessable } = require('../utils/errors');
const { str, num } = require('../utils/validate');
const { makeAudit, scopeCenterIds } = require('./context');
const params = require('./params');

const LABELS = { OPEN: 'Abierta', BALANCED: 'Conciliada', WITHIN_TOLERANCE: 'Conciliada (dentro de tolerancia)', PENDING_AUTHORIZATION: 'Pendiente de autorización', AUTHORIZED: 'Autorizada', REJECTED: 'Rechazada' };
const CLOSED = ['BALANCED', 'WITHIN_TOLERANCE', 'AUTHORIZED', 'REJECTED'];

function createSettlementsService({ store, clock, config }) {
  const audit = makeAudit(clock); const now = () => iso(new Date(clock()));
  const dto = (s, deposits = null) => ({
    id: s.id, routeId: s.route_id, routeName: s.route_name ?? null, operatorName: s.operator_name ?? null, centerId: s.center_id, status: s.status, statusLabel: LABELS[s.status],
    expectedCents: s.expected_cents, otherCents: s.other_cents, depositedCents: s.deposited_cents, diffCents: s.diff_cents, toleranceCents: s.tolerance_cents,
    decisionReason: s.decision_reason, createdAt: s.created_at, submittedAt: s.submitted_at, decidedAt: s.decided_at, closed: CLOSED.includes(s.status),
    ...(deposits ? { deposits: deposits.map((d) => ({ id: d.id, amountCents: d.amount_cents, reference: d.reference, depositedAt: d.deposited_at, by: d.created_by_name ?? null })) } : {}),
  });
  async function load(r, ctx, id) {
    const s = await r.settlements.get(ctx.companyId, id);
    if (!s || !scopeCenterIds(ctx).includes(s.center_id)) throw notFound('Liquidación no encontrada.');
    return s;
  }
  async function full(r, ctx, id) {
    const s = (await r.settlements.list(ctx.companyId, scopeCenterIds(ctx))).find((x) => x.id === id) ?? (await load(r, ctx, id));
    return dto(s, await r.settlements.deposits(id));
  }
  async function toleranceFor(r, ctx, s) {
    const route = await r.routes.get(ctx.companyId, s.route_id); const pub = await config.publishedPayload(r, ctx.companyId);
    return params.resolve(pub.payload.parameters, { centerId: route.center_id, zoneId: route.zone_id || undefined, routeId: route.id, userId: route.operator_user_id || undefined }).values.cash_tolerance_cents;
  }
  async function recompute(r, s) {
    const dep = await r.settlements.sumDeposits(s.id);
    await r.settlements.update(s.id, { deposited_cents: dep, diff_cents: dep - s.expected_cents });
    return dep;
  }

  return {
    async list(ctx) { return store.read(async (r) => (await r.settlements.list(ctx.companyId, scopeCenterIds(ctx))).map((s) => dto(s))); },
    async get(ctx, id) { return store.read((r) => full(r, ctx, id)); },

    /** Rutas finalizadas antes de existir este módulo: crea la liquidación abierta si falta. Una sola por ruta. */
    async openForRoute(ctx, routeId) {
      return store.tx(async (r) => {
        const route = await r.routes.get(ctx.companyId, routeId, scopeCenterIds(ctx)); if (!route) throw notFound('Ruta no encontrada.');
        if (route.status !== 'COMPLETED') throw conflict('Solo se liquida una ruta finalizada.', 'ROUTE_NOT_COMPLETED');
        if (await r.settlements.byRoute(routeId)) throw conflict('Esta ruta ya tiene una liquidación.', 'ALREADY_SETTLED');
        const pay = await r.payments.byRoute(routeId); const cash = pay.find((p) => p.method === 'CASH')?.c ?? 0; const other = pay.filter((p) => p.method !== 'CASH').reduce((a, p) => a + p.c, 0);
        const s = await r.settlements.create({ id: uuid(), companyId: ctx.companyId, centerId: route.center_id, routeId, expectedCents: cash, otherCents: other, createdBy: ctx.userId, createdAt: now() });
        await audit(r, ctx, 'settlement.opened', { entity: 'settlement', entityId: s.id, centerId: route.center_id, detail: { routeId, expectedCents: cash } });
        return full(r, ctx, s.id);
      });
    },

    async addDeposit(ctx, id, b = {}) {
      const amount = num(b.amount, 'El monto', { min: 0.01, max: 100_000_000, required: true }); const cents = Math.round(amount * 100);
      const reference = str(b.reference, 'La referencia', { max: 80 });
      return store.tx(async (r) => {
        const s = await load(r, ctx, id);
        if (s.status !== 'OPEN') throw conflict('La liquidación ya está cerrada o en autorización: no admite más depósitos.', 'SETTLEMENT_CLOSED');
        await r.settlements.addDeposit({ id: uuid(), settlementId: id, amountCents: cents, reference, depositedAt: b.depositedAt ? new Date(b.depositedAt).toISOString() : now(), createdBy: ctx.userId, createdAt: now() });
        const dep = await recompute(r, s);
        await audit(r, ctx, 'settlement.deposit_added', { entity: 'settlement', entityId: id, centerId: s.center_id, detail: { amountCents: cents, depositedCents: dep, expectedCents: s.expected_cents } });
        return full(r, ctx, id);
      });
    },

    /** Conciliar: compara lo depositado con lo esperado y la tolerancia efectiva PUBLICADA de la ruta. */
    async submit(ctx, id) {
      return store.tx(async (r) => {
        const s = await load(r, ctx, id); if (s.status !== 'OPEN') throw conflict('La liquidación ya fue conciliada.', 'SETTLEMENT_CLOSED');
        const deposits = await r.settlements.deposits(id);
        if (!deposits.length && s.expected_cents > 0) throw unprocessable('Registra al menos un depósito antes de conciliar.', 'DEPOSIT_REQUIRED');
        const dep = await recompute(r, s); const diff = dep - s.expected_cents; const tol = await toleranceFor(r, ctx, s);
        const status = diff === 0 ? 'BALANCED' : Math.abs(diff) <= tol ? 'WITHIN_TOLERANCE' : 'PENDING_AUTHORIZATION';
        await r.settlements.update(id, { status, tolerance_cents: tol, submitted_by: ctx.userId, submitted_at: now(), diff_cents: diff });
        if (status === 'PENDING_AUTHORIZATION') {
          const route = await r.routes.get(ctx.companyId, s.route_id);
          await r.notifications.add({ companyId: ctx.companyId, centerId: s.center_id, category: 'Liquidaciones', title: 'Diferencia por autorizar', detail: `${route.name}: diferencia de $${(diff / 100).toFixed(2)} (tolerancia $${(tol / 100).toFixed(2)}).`, createdAt: now() });
        }
        await audit(r, ctx, 'settlement.submitted', { entity: 'settlement', entityId: id, centerId: s.center_id, detail: { status, diffCents: diff, toleranceCents: tol } });
        return full(r, ctx, id);
      });
    },

    async decide(ctx, id, approve, b = {}) {
      const reason = str(b.reason, 'El motivo', { max: 240, required: !approve });
      return store.tx(async (r) => {
        const s = await load(r, ctx, id);
        if (s.status !== 'PENDING_AUTHORIZATION') throw conflict('Solo se autoriza o rechaza una liquidación pendiente de autorización.', 'SETTLEMENT_STATE');
        if (s.submitted_by === ctx.userId) throw new HttpError(403, 'SELF_AUTHORIZATION', 'La diferencia la autoriza otra persona distinta de quien concilió.');
        await r.settlements.update(id, { status: approve ? 'AUTHORIZED' : 'REJECTED', decided_by: ctx.userId, decided_at: now(), decision_reason: reason });
        await audit(r, ctx, approve ? 'settlement.authorized' : 'settlement.rejected', { entity: 'settlement', entityId: id, centerId: s.center_id, detail: { diffCents: s.diff_cents, reason } });
        return full(r, ctx, id);
      });
    },
  };
}
module.exports = { createSettlementsService };
