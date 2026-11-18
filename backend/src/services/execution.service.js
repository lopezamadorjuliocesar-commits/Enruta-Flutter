'use strict';
// Ejecución en campo (3.A): llegada, entrega total/parcial/fallida, evidencias, cobros, saldo, cierre de visita y de ruta, incidencias.
// Las acciones del repartidor llegan con Idempotency-Key (ver middleware/idempotency.js): un doble clic o un reintento no duplica nada.
const crypto = require('crypto');
const { uuid, iso } = require('../utils/ids');
const { HttpError, conflict, notFound, unprocessable, forbidden } = require('../utils/errors');
const { str, num } = require('../utils/validate');
const { detectImage } = require('../storage/file-store');
const { makeAudit } = require('./context');
const params = require('./params');
const forms = require('./forms');
const core = require('./commerce.core');

const INCIDENT_REASONS = { CLIENT_CLOSED: 'Cliente cerrado', NO_ONE: 'Nadie atiende', REJECTED: 'Rechazó el pedido', NO_CASH: 'Sin efectivo / sin pago', ADDRESS: 'Dirección incorrecta', STOCKOUT: 'Sin existencias', DAMAGED: 'Producto dañado', OTHER: 'Otro' };
const METHODS = ['CASH', 'TRANSFER', 'CARD'];
const DAY = 86_400_000;

function distanceMeters(a, b) {
  const R = 6371000; const rad = (d) => (d * Math.PI) / 180; const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x));
}
/** Saldo FIFO: los abonos liquidan primero los cargos más antiguos. `overdue` = lo pendiente de cargos con más de `overdueDays` días. */
function computeBalance(entries, nowMs, overdueDays) {
  let paid = entries.filter((e) => e.kind === 'PAYMENT').reduce((s, e) => s + e.amount_cents, 0); let balance = 0; let overdue = 0; let oldest = 0;
  for (const c of entries.filter((e) => e.kind === 'CHARGE')) {
    const take = Math.min(paid, c.amount_cents); paid -= take; const rest = c.amount_cents - take; balance += rest;
    const age = Math.floor((nowMs - Date.parse(c.created_at)) / DAY);
    if (rest > 0 && overdueDays > 0 && age > overdueDays) { overdue += rest; oldest = Math.max(oldest, age); }
  }
  return { balanceCents: balance, overdueCents: overdue, oldestOverdueDays: oldest };
}

function createExecutionService({ store, clock, bus, files, config, queue }) {
  const audit = makeAudit(clock); const now = () => iso(new Date(clock()));
  const emit = (ctx, route, what, extra = {}) => bus?.publish({ companyId: ctx.companyId, centerId: route.center_id, type: 'route.updated', data: { routeId: route.id, status: route.status, revision: route.revision, what, ...extra } });

  async function operatorRoute(r, ctx, routeId, { requireStarted = true } = {}) {
    const route = await r.routes.get(ctx.companyId, routeId);
    if (!route || route.operator_user_id !== ctx.userId) throw notFound('Ruta no encontrada.');
    if (requireStarted && route.status !== 'IN_PROGRESS') throw conflict('La ruta no está en ejecución: inícialas primero.', 'ROUTE_NOT_STARTED');
    return route;
  }
  async function openVisit(r, ctx, visitId) {
    const visit = await r.visits.get(ctx.companyId, visitId); if (!visit) throw notFound('Visita no encontrada.');
    const route = await operatorRoute(r, ctx, visit.route_id);
    if (visit.status !== 'OPEN') throw conflict('La visita ya está cerrada.', 'VISIT_CLOSED');
    return { visit, route };
  }
  async function effective(r, ctx, route) {
    const pub = await config.publishedPayload(r, ctx.companyId);
    return { ...params.resolve(pub.payload.parameters, { centerId: route.center_id, zoneId: route.zone_id || undefined, routeId: route.id, userId: ctx.userId }), forms: pub.payload.forms, version: pub.version, payload: pub.payload };
  }
  async function formFor(r, ctx, kind, declaredVersion, eff) {
    if (declaredVersion === undefined || declaredVersion === null || declaredVersion === '') return { version: eff.version || null, fields: eff.forms[kind] || [] };
    const v = Number(declaredVersion); if (!Number.isInteger(v)) throw unprocessable('formVersion no es válida.', 'FORM_VERSION_INVALID');
    if (v === 0) return { version: null, fields: [] };
    const payload = await config.payloadOfVersion(r, ctx.companyId, v); if (!payload) throw conflict('La versión del formulario no existe. Sincroniza la configuración.', 'FORM_VERSION_UNKNOWN');
    return { version: v, fields: payload.forms[kind] || [] };
  }
  const checkForm = (fields, values) => { const errors = forms.validateValues(fields, values || {}); if (errors.length) throw new HttpError(422, 'FORM_INVALID', errors[0].message, { errors }); };
  async function balanceOf(r, ctx, clientId, overdueDays, excludeVisitId = null) {
    const entries = (await r.ledger.entries(ctx.companyId, clientId)).filter((e) => !excludeVisitId || e.visit_id !== excludeVisitId);
    return computeBalance(entries, clock(), overdueDays);
  }
  const visitDto = (v, extra = {}) => ({ id: v.id, routeId: v.route_id, clientId: v.client_id, seq: v.seq, status: v.status, arrivedAt: v.arrived_at, distanceM: v.distance_m === null ? null : Math.round(v.distance_m), outsideRadiusReason: v.outside_radius_reason, skipReason: v.skip_reason, closedAt: v.closed_at, ...extra });

  return {
    INCIDENT_REASONS, computeBalance, distanceMeters,
    incidentCatalog: () => Object.entries(INCIDENT_REASONS).map(([code, label]) => ({ code, label })),

    /** Catálogo con el precio EFECTIVO para el cliente (lista → promoción) si se indica `clientId`; sin cliente, el precio base. */
    async catalog(ctx, clientId = null) {
      return store.read(async (r) => {
        const out = [];
        for (const p of await r.products.list(ctx.companyId, { status: 'ACTIVE' })) {
          let price = null; try { price = await core.unitPrice(r, { companyId: ctx.companyId, clientId, productId: p.id, nowMs: clock(), tz: ctx.company?.timezone }); } catch { /* sin precio: no se ofrece a la venta */ }
          out.push({ id: p.id, sku: p.sku, name: p.name, unit: p.unit, priceCents: price?.unitCents ?? null, listPriceCents: price?.listPriceCents ?? null, promoCents: price?.promoCents ?? 0, promotion: price?.promotion ?? null });
        }
        return out;
      });
    },

    /** Estado de ejecución de las paradas de una ruta del operador (para la vista móvil). */
    async stopsState(ctx, routeId) {
      return store.read(async (r) => {
        const route = await r.routes.get(ctx.companyId, routeId); if (!route) return []; const eff = await effective(r, ctx, route); const out = [];
        for (const s of await r.routes.stopClients(routeId)) {
          const v = await r.visits.byRouteClient(routeId, s.id); const d = v ? await r.deliveries.byVisit(v.id) : null; const bal = await balanceOf(r, ctx, s.id, eff.values.overdue_block_days);
          const order = await r.orders.openForClient(ctx.companyId, s.id); const assets = await r.assets.ofClient(ctx.companyId, s.id);
          out.push({ clientId: s.id, order: order ? { id: order.id, notes: order.notes, lines: (await r.orders.lines(order.id)).map((l) => ({ productId: l.product_id, name: l.product_name, unit: l.unit, qty: l.qty })) } : null, assets: assets.map((a) => ({ id: a.id, code: a.code, kind: a.kind })), displayAudit: v ? !!(await r.displayAudits.byVisit(v.id)) : false, visit: v ? visitDto(v, { deliveryStatus: d?.status ?? null, totalCents: d?.total_cents ?? 0, paidCents: await r.payments.sumByVisit(v.id), photos: await r.evidences.count(v.id, 'PHOTO'), signatures: await r.evidences.count(v.id, 'SIGNATURE') }) : null, ...bal });
        }
        return out;
      });
    },

    async arrive(ctx, routeId, clientId, b = {}) {
      const lat = num(b.lat, 'La latitud', { min: -90, max: 90, required: true }); const lng = num(b.lng, 'La longitud', { min: -180, max: 180, required: true });
      const out = await store.tx(async (r) => {
        const route = await operatorRoute(r, ctx, routeId);
        const stops = (await r.routes.stops(routeId)); const stop = stops.find((s) => s.client_id === clientId); if (!stop) throw notFound('Ese cliente no pertenece a la ruta.');
        const existing = await r.visits.byRouteClient(routeId, clientId);
        if (existing) { if (existing.status === 'OPEN') return { visit: visitDto(existing), created: false, route }; throw conflict('La visita ya está cerrada.', 'VISIT_CLOSED'); }
        const client = (await r.routeRefs.clientsByIds(ctx.companyId, [clientId]))[0]; const eff = await effective(r, ctx, route);
        const distance = client.lat === null ? null : distanceMeters({ lat, lng }, { lat: client.lat, lng: client.lng });
        const radius = eff.values.visit_radius_m; let outsideReason = null;
        if (distance !== null && distance > radius) {
          outsideReason = str(b.outsideReason, 'El motivo', { max: 200 });
          if (!outsideReason || outsideReason.length < 3) throw new HttpError(422, 'OUTSIDE_RADIUS', `Estás a ${Math.round(distance)} m del cliente (radio permitido: ${radius} m). Indica el motivo para registrar la llegada.`, { distanceM: Math.round(distance), radiusM: radius });
        }
        const form = await formFor(r, ctx, 'visita', b.formVersion, eff); checkForm(form.fields, b.form);
        const visit = await r.visits.create({ id: uuid(), companyId: ctx.companyId, centerId: route.center_id, routeId, clientId, seq: stop.seq, arrivedAt: now(), lat, lng, distanceM: distance, outsideReason, createdBy: ctx.userId, createdAt: now(), formVersion: form.version, formData: b.form ? JSON.stringify(b.form) : null });
        await audit(r, ctx, 'visit.arrived', { entity: 'visit', entityId: visit.id, centerId: route.center_id, detail: { clientId, distanceM: distance === null ? null : Math.round(distance), outside: !!outsideReason } });
        return { visit: visitDto(visit), created: true, route };
      });
      if (out.created) emit(ctx, out.route, 'visit'); return out.visit;
    },

    async delivery(ctx, visitId, b = {}) {
      const rawLines = Array.isArray(b.lines) ? b.lines : [];
      const out = await store.tx(async (r) => {
        const { visit, route } = await openVisit(r, ctx, visitId); const eff = await effective(r, ctx, route);
        const lines = []; const short = []; let totalCents = 0; let planned = 0; let delivered = 0; const seen = new Set();
        for (const l of rawLines) {
          const p = await r.products.get(ctx.companyId, l.productId); if (!p || p.status !== 'ACTIVE') throw unprocessable('Uno de los productos no existe o está inactivo.', 'PRODUCT_INVALID');
          if (seen.has(p.id)) throw unprocessable(`El producto ${p.name} está repetido.`, 'LINE_DUPLICATE'); seen.add(p.id);
          const qp = Number(l.qtyPlanned); const qd = Number(l.qtyDelivered);
          if (![qp, qd].every((n) => Number.isInteger(n) && n >= 0 && n <= 100000)) throw unprocessable(`Las cantidades de ${p.name} deben ser enteros ≥ 0.`, 'QTY_INVALID');
          if (qd > qp) throw unprocessable(`No puedes entregar más de lo pedido de ${p.name}.`, 'QTY_EXCEEDS');
          const bp = Number(l.discountBp ?? 0); if (!Number.isInteger(bp) || bp < 0 || bp > 10000) throw unprocessable('El descuento no es válido.', 'DISCOUNT_INVALID');
          if (bp > 0 && !ctx.can('discounts.apply')) throw forbidden('No tienes permiso para aplicar descuentos.', 'PERMISSION_DENIED');
          if (bp > ctx.maxDiscountBp && !ctx.can('discounts.over_limit')) throw new HttpError(403, 'DISCOUNT_LIMIT', `Tu tope de descuento es ${(ctx.maxDiscountBp / 100).toFixed(2)} %.`);
          if (qd < qp && !str(l.reason, 'El motivo', { max: 160 })) short.push(p.name);
          let pr = null; try { pr = await core.unitPrice(r, { companyId: ctx.companyId, clientId: visit.client_id, productId: p.id, nowMs: clock(), tz: ctx.company?.timezone }); } catch (e) { if (qd > 0 || e.code !== 'PRODUCT_NO_PRICE') throw e; }
          const unit = pr?.unitCents ?? 0; totalCents += Math.round((qd * unit * (10000 - bp)) / 10000); planned += qp; delivered += qd;
          lines.push({ productId: p.id, qtyPlanned: qp, qtyDelivered: qd, unitPriceCents: unit, listPriceCents: pr?.listPriceCents ?? null, promoCents: pr?.promoCents ?? 0, priceSource: pr?.source ?? null, discountBp: bp, reason: str(l.reason, 'El motivo', { max: 160 }) });
        }
        const status = !lines.length || delivered === 0 ? 'FAILED' : delivered === planned ? 'DELIVERED' : 'PARTIAL';
        // Preventa (pedido anticipado del cliente) y autoventa (venta desde la carga del camión): condicionadas al módulo publicado.
        const sale = b.sale === true; let order = null;
        if (sale) { core.requireModule(eff.payload, core.MODULE.AUTOVENTA); if (lines.some((l) => l.qtyPlanned !== l.qtyDelivered)) throw unprocessable('En autoventa se vende lo entregado: pedido y entregado deben coincidir.', 'SALE_QTY_MISMATCH'); }
        if (b.orderId) {
          core.requireModule(eff.payload, core.MODULE.PREVENTA);
          order = await r.orders.get(ctx.companyId, String(b.orderId));
          if (!order || order.client_id !== visit.client_id || !(order.status === 'OPEN' || order.delivered_visit_id === visitId)) throw new HttpError(409, 'ORDER_NOT_AVAILABLE', 'El pedido no existe, no es de este cliente o ya fue entregado.');
          const ol = new Map((await r.orders.lines(order.id)).map((x) => [x.product_id, x]));
          for (const l of lines) { const o = ol.get(l.productId); if (!o) throw unprocessable('La entrega incluye un producto que no está en el pedido.', 'ORDER_LINE_UNKNOWN'); if (l.qtyPlanned !== o.qty) throw unprocessable(`La cantidad pedida de ${o.product_name} debe ser ${o.qty} (la del pedido).`, 'ORDER_QTY_MISMATCH'); }
        }
        const prevLines = await r.deliveries.byVisit(visitId).then(async (d0) => (d0 ? r.deliveries.linesOf(d0.id) : []));
        await core.consumeLoad(r, route, { sale, prior: new Map(prevLines.map((x) => [x.product_id, x.qty_delivered])), next: new Map(lines.map((x) => [x.productId, x.qtyDelivered])) });
        if (status !== 'FAILED' && short.length) throw unprocessable(`Indica el motivo de la entrega parcial de ${short[0]}.`, 'LINE_REASON_REQUIRED');
        let incident = null;
        if (status === 'FAILED') { incident = String(b.incidentReason ?? ''); if (!INCIDENT_REASONS[incident]) throw unprocessable('Una entrega fallida requiere un motivo de incidencia.', 'INCIDENT_REQUIRED'); }
        const form = await formFor(r, ctx, 'entrega', b.formVersion, eff); checkForm(form.fields, b.form);
        const d = await r.deliveries.replace({ id: uuid(), companyId: ctx.companyId, visitId, status, incidentReason: incident, notes: str(b.notes, 'Las notas', { max: 300 }), formVersion: form.version, formData: b.form ? JSON.stringify(b.form) : null, totalCents }, lines);
        if (order) {
          const delivered2 = new Map(lines.map((x) => [x.productId, x.qtyDelivered]));
          for (const ol of await r.orders.lines(order.id)) await r.orders.setDelivered(order.id, ol.product_id, delivered2.get(ol.product_id) ?? 0);
          await r.orders.setStatus(order.id, (await r.orders.lines(order.id)).every((x) => x.qty_delivered >= x.qty) ? 'DELIVERED' : 'PARTIAL'); await r.orders.setDeliveredVisit(order.id, visitId);
        }
        await r.ledger.removeChargesOfVisit(visitId);
        if (totalCents > 0) await r.ledger.add({ id: uuid(), companyId: ctx.companyId, clientId: visit.client_id, kind: 'CHARGE', amountCents: totalCents, routeId: route.id, visitId, refId: d.id, createdAt: now() });
        await audit(r, ctx, 'delivery.recorded', { entity: 'delivery', entityId: d.id, centerId: route.center_id, detail: { visitId, status, totalCents, lines: lines.length, sale, orderId: order?.id ?? null } });
        return { route, delivery: { id: d.id, visitId, status, incidentReason: incident, totalCents, lines: lines.length, formVersion: form.version } };
      });
      emit(ctx, out.route, 'delivery'); return out.delivery;
    },

    async evidence(ctx, visitId, kind, buffer) {
      if (!['PHOTO', 'SIGNATURE'].includes(kind)) throw unprocessable('kind debe ser PHOTO o SIGNATURE.', 'EVIDENCE_KIND');
      if (!Buffer.isBuffer(buffer) || !buffer.length) throw unprocessable('Envía una imagen PNG, JPEG o WebP (máx. 8 MB).', 'IMAGE_REQUIRED');
      const type = detectImage(buffer); if (!type) throw unprocessable('El archivo no es una imagen válida.', 'IMAGE_INVALID');
      const id = uuid(); const d = new Date(clock()); const rel = `evidences/${ctx.companyId}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${id}.${type.ext}`;
      const sha = crypto.createHash('sha256').update(buffer).digest('hex'); let saved = false;
      try {
        const out = await store.tx(async (r) => {
          const { visit, route } = await openVisit(r, ctx, visitId);
          if ((await r.evidences.count(visit.id, null)) >= 10) throw conflict('Una visita admite hasta 10 evidencias.', 'EVIDENCE_LIMIT');
          await files.save(rel, buffer); saved = true;
          await r.evidences.create({ id, companyId: ctx.companyId, visitId, kind, path: rel, mime: type.mime, size: buffer.length, sha256: sha, createdBy: ctx.userId, createdAt: now() });
          await audit(r, ctx, 'evidence.uploaded', { entity: 'evidence', entityId: id, centerId: route.center_id, detail: { visitId, kind, size: buffer.length } });
          return { route, evidence: { id, kind, mime: type.mime, size: buffer.length, sha256: sha } };
        });
        emit(ctx, out.route, 'evidence'); return out.evidence;
      } catch (e) { if (saved) await files.remove(rel).catch(() => {}); throw e; }
    },

    async payment(ctx, visitId, b = {}) {
      const method = String(b.method ?? ''); if (!METHODS.includes(method)) throw unprocessable('Método de cobro no válido (CASH, TRANSFER o CARD).', 'METHOD_INVALID');
      const cents = b.amountCents !== undefined ? Number(b.amountCents) : Math.round(Number(b.amount) * 100);
      if (!Number.isInteger(cents) || cents <= 0 || cents > 1e10) throw unprocessable('El monto debe ser mayor a cero.', 'AMOUNT_INVALID');
      const reference = str(b.reference, 'La referencia', { max: 80 });
      if (method !== 'CASH' && (!reference || reference.length < 4)) throw unprocessable('Transferencias y tarjetas requieren una referencia de al menos 4 caracteres.', 'REFERENCE_REQUIRED');
      const out = await store.tx(async (r) => {
        const { visit, route } = await openVisit(r, ctx, visitId); const eff = await effective(r, ctx, route);
        const form = await formFor(r, ctx, 'cobro', b.formVersion, eff); checkForm(form.fields, b.form);
        const before = await balanceOf(r, ctx, visit.client_id, eff.values.overdue_block_days);
        if (cents > before.balanceCents) throw new HttpError(422, 'OVERPAYMENT', `El monto excede el saldo pendiente del cliente (${(before.balanceCents / 100).toFixed(2)}).`, { balanceCents: before.balanceCents });
        const id = uuid();
        await r.payments.create({ id, companyId: ctx.companyId, routeId: route.id, visitId, clientId: visit.client_id, method, amountCents: cents, reference, formData: b.form ? JSON.stringify(b.form) : null, createdBy: ctx.userId, createdAt: now() });
        await r.ledger.add({ id: uuid(), companyId: ctx.companyId, clientId: visit.client_id, kind: 'PAYMENT', amountCents: cents, routeId: route.id, visitId, refId: id, createdAt: now() });
        await audit(r, ctx, 'payment.collected', { entity: 'payment', entityId: id, centerId: route.center_id, detail: { visitId, method, amountCents: cents } });
        return { route, payment: { id, method, amountCents: cents, reference }, ...(await balanceOf(r, ctx, visit.client_id, eff.values.overdue_block_days)) };
      });
      emit(ctx, out.route, 'payment'); const { route, ...rest } = out; return rest;
    },

    async closeVisit(ctx, visitId) {
      const out = await store.tx(async (r) => {
        const { visit, route } = await openVisit(r, ctx, visitId); const eff = await effective(r, ctx, route);
        const d = await r.deliveries.byVisit(visitId); if (!d) throw conflict('Registra la entrega (o su incidencia) antes de cerrar la visita.', 'DELIVERY_REQUIRED');
        const fields = d.form_version ? ((await config.payloadOfVersion(r, ctx.companyId, d.form_version))?.forms.entrega ?? []) : [];   // el formulario de la versión con que se capturó
        if (d.status !== 'FAILED') {
          const need = forms.requiredEvidence(fields);
          if (need.photo && (await r.evidences.count(visitId, 'PHOTO')) < 1) throw new HttpError(422, 'EVIDENCE_REQUIRED', 'El formulario exige una foto antes de cerrar la visita.', { kind: 'PHOTO' });
          if (need.signature && (await r.evidences.count(visitId, 'SIGNATURE')) < 1) throw new HttpError(422, 'EVIDENCE_REQUIRED', 'El formulario exige la firma del cliente antes de cerrar la visita.', { kind: 'SIGNATURE' });
        }
        checkForm(fields, d.form_data ? JSON.parse(d.form_data) : {});
        // Bloqueo por saldo vencido: con saldo vencido anterior solo se entrega de contado (o con autorización de crédito).
        const prior = await balanceOf(r, ctx, visit.client_id, eff.values.overdue_block_days, visitId); const paid = await r.payments.sumByVisit(visitId);
        if (prior.overdueCents > 0 && paid < d.total_cents && !ctx.can('credit.authorize')) throw new HttpError(409, 'CREDIT_BLOCKED', `El cliente tiene ${(prior.overdueCents / 100).toFixed(2)} vencidos (más de ${eff.values.overdue_block_days} días): cobra el total de la entrega o pide autorización de crédito.`, { overdueCents: prior.overdueCents, dueCents: d.total_cents - paid });
        await r.visits.update(visitId, { status: 'CLOSED', closed_at: now() });
        await audit(r, ctx, 'visit.closed', { entity: 'visit', entityId: visitId, centerId: route.center_id, detail: { delivery: d.status, totalCents: d.total_cents, paidCents: paid } });
        return { route, visit: visitDto({ ...visit, status: 'CLOSED', closed_at: now() }, { deliveryStatus: d.status, totalCents: d.total_cents, paidCents: paid }) };
      });
      emit(ctx, out.route, 'visit'); return out.visit;
    },

    /** Auditoría de exhibición (módulo publicado): frentes observados por producto en la visita abierta. Se reemplaza al guardar de nuevo. */
    async displayAudit(ctx, visitId, b = {}) {
      const raw = Array.isArray(b.lines) ? b.lines : [];
      if (!raw.length || raw.length > 100) throw unprocessable('Registra al menos un producto observado (máx. 100).', 'AUDIT_LINES');
      const out = await store.tx(async (r) => {
        const { visit, route } = await openVisit(r, ctx, visitId); const eff = await effective(r, ctx, route); core.requireModule(eff.payload, core.MODULE.EXHIBICION);
        const lines = []; const seen = new Set();
        for (const l of raw) {
          const p = await r.products.get(ctx.companyId, l.productId); if (!p || p.status !== 'ACTIVE') throw unprocessable('Uno de los productos no existe o está inactivo.', 'PRODUCT_INVALID');
          if (seen.has(p.id)) throw unprocessable(`El producto ${p.name} está repetido.`, 'LINE_DUPLICATE'); seen.add(p.id);
          const fronts = Number(l.fronts); const exp = l.expectedFronts === undefined || l.expectedFronts === null || l.expectedFronts === '' ? null : Number(l.expectedFronts);
          if (!Number.isInteger(fronts) || fronts < 0 || fronts > 1000 || (exp !== null && (!Number.isInteger(exp) || exp < 0 || exp > 1000))) throw unprocessable(`Los frentes de ${p.name} deben ser enteros ≥ 0.`, 'FRONTS_INVALID');
          lines.push({ productId: p.id, fronts, expectedFronts: exp });
        }
        const id = uuid(); await r.displayAudits.replace({ id, companyId: ctx.companyId, visitId, clientId: visit.client_id, notes: str(b.notes, 'Las notas', { max: 300 }), createdBy: ctx.userId, createdAt: now() }, lines);
        await audit(r, ctx, 'display_audit.recorded', { entity: 'display_audit', entityId: id, centerId: route.center_id, detail: { visitId, lines: lines.length, below: lines.filter((x) => x.expectedFronts !== null && x.fronts < x.expectedFronts).length } });
        return { route, audit: { id, visitId, lines: lines.length, belowExpected: lines.filter((x) => x.expectedFronts !== null && x.fronts < x.expectedFronts).length } };
      });
      emit(ctx, out.route, 'display_audit'); return out.audit;
    },

    /** Comodato en la visita: verificar el activo del cliente (presente / faltante), entregar uno del centro o recogerlo. */
    async assetAction(ctx, visitId, action, b = {}) {
      if (!['verify', 'loan', 'return'].includes(action)) throw unprocessable('Acción de comodato no válida.', 'ASSET_ACTION');
      const out = await store.tx(async (r) => {
        const { visit, route } = await openVisit(r, ctx, visitId); const eff = await effective(r, ctx, route); core.requireModule(eff.payload, core.MODULE.COMODATO);
        const asset = await r.assets.get(ctx.companyId, String(b.assetId ?? '')); if (!asset || asset.center_id !== route.center_id) throw notFound('Activo no encontrado.');
        const t = now(); const note = str(b.note, 'La nota', { max: 200 });
        if (action === 'verify') {
          if (asset.status !== 'LOANED' || asset.client_id !== visit.client_id) throw conflict('Ese activo no está en comodato con este cliente.', 'ASSET_STATE');
          const present = b.present !== false; if (!present && !note) throw unprocessable('Indica en la nota qué pasó con el activo faltante.', 'NOTE_REQUIRED');
          await r.assets.addEvent({ companyId: ctx.companyId, assetId: asset.id, kind: present ? 'VERIFIED' : 'MISSING', clientId: visit.client_id, visitId, note, createdBy: ctx.userId, createdAt: t });
        } else if (action === 'loan') {
          if (asset.status !== 'IN_STOCK') throw conflict('El activo no está disponible en el almacén.', 'ASSET_STATE');
          await r.assets.update(ctx.companyId, asset.id, { status: 'LOANED', client_id: visit.client_id });
          await r.assets.addEvent({ companyId: ctx.companyId, assetId: asset.id, kind: 'LOAN', clientId: visit.client_id, visitId, note, createdBy: ctx.userId, createdAt: t });
        } else {
          if (asset.status !== 'LOANED' || asset.client_id !== visit.client_id) throw conflict('Ese activo no está en comodato con este cliente.', 'ASSET_STATE');
          await r.assets.update(ctx.companyId, asset.id, { status: 'IN_STOCK', client_id: null });
          await r.assets.addEvent({ companyId: ctx.companyId, assetId: asset.id, kind: 'RETURN', clientId: visit.client_id, visitId, note, createdBy: ctx.userId, createdAt: t });
        }
        await audit(r, ctx, `asset.${action}`, { entity: 'asset', entityId: asset.id, centerId: route.center_id, detail: { visitId, code: asset.code, present: action === 'verify' ? b.present !== false : undefined } });
        return { route, asset: { id: asset.id, code: asset.code, action } };
      });
      emit(ctx, out.route, 'asset'); return out.asset;
    },

    async skip(ctx, routeId, clientId, b = {}) {
      const reason = str(b.reason, 'El motivo', { required: true, max: 200 });
      const out = await store.tx(async (r) => {
        const route = await operatorRoute(r, ctx, routeId); const stop = (await r.routes.stops(routeId)).find((s) => s.client_id === clientId); if (!stop) throw notFound('Ese cliente no pertenece a la ruta.');
        const v = await r.visits.byRouteClient(routeId, clientId);
        if (v && v.status === 'SKIPPED') return { route, visit: visitDto(v) };
        if (v && (v.status === 'CLOSED' || (await r.deliveries.byVisit(v.id)))) throw conflict('La parada ya tiene una visita registrada.', 'VISIT_CLOSED');
        let visit; if (v) { await r.visits.update(v.id, { status: 'SKIPPED', skip_reason: reason, closed_at: now() }); visit = { ...v, status: 'SKIPPED', skip_reason: reason, closed_at: now() }; }
        else visit = await r.visits.create({ id: uuid(), companyId: ctx.companyId, centerId: route.center_id, routeId, clientId, seq: stop.seq, status: 'SKIPPED', skipReason: reason, closedAt: now(), createdBy: ctx.userId, createdAt: now() });
        await audit(r, ctx, 'visit.skipped', { entity: 'visit', entityId: visit.id, centerId: route.center_id, detail: { clientId, reason } });
        return { route, visit: visitDto(visit) };
      });
      emit(ctx, out.route, 'visit'); return out.visit;
    },

    async finish(ctx, routeId) {
      const out = await store.tx(async (r) => {
        const route = await operatorRoute(r, ctx, routeId); const stops = await r.routes.stops(routeId); const visits = await r.visits.listByRoute(routeId);
        const pending = stops.filter((s) => !visits.find((v) => v.client_id === s.client_id && v.status !== 'OPEN'));
        if (pending.length) { const names = (await r.routeRefs.clientsByIds(ctx.companyId, pending.map((p) => p.client_id))).map((c) => c.name); throw new HttpError(409, 'VISITS_PENDING', `Faltan ${pending.length} parada(s) por cerrar o marcar como no visitadas: ${names.join(', ')}.`, { pending: names }); }
        const t = now(); await r.routes.update(ctx.companyId, routeId, { status: 'COMPLETED', finished_at: t });
        await r.routeHistory.add({ routeId, from: 'IN_PROGRESS', to: 'COMPLETED', revision: route.revision, actorId: ctx.userId, at: t });
        await core.returnLoad(r, route, { userId: ctx.userId, at: t });
        const summary = await this.routeSummary(r, routeId);
        const cash = (await r.payments.byRoute(routeId)).reduce((a, x) => { if (x.method === 'CASH') a.cash += x.c; else a.other += x.c; return a; }, { cash: 0, other: 0 });
        const st = await r.settlements.create({ id: uuid(), companyId: ctx.companyId, centerId: route.center_id, routeId, expectedCents: cash.cash, otherCents: cash.other, createdBy: ctx.userId, createdAt: t });
        await audit(r, ctx, 'settlement.opened', { entity: 'settlement', entityId: st.id, centerId: route.center_id, detail: { routeId, expectedCents: cash.cash, otherCents: cash.other } });
        await audit(r, ctx, 'route.finished', { entity: 'route', entityId: routeId, centerId: route.center_id, detail: summary });
        await r.notifications.add({ companyId: ctx.companyId, centerId: route.center_id, category: 'Sistema', title: 'Ruta finalizada', detail: `${route.name}: ${summary.delivered} entregas, ${summary.partial} parciales, ${summary.failed} fallidas, ${summary.skipped} sin visitar.`, createdAt: t });
        return { route: { ...route, status: 'COMPLETED' }, summary };
      });
      emit(ctx, out.route, 'finished'); return { status: 'COMPLETED', summary: out.summary };
    },

    async routeSummary(r, routeId) {
      const visits = await r.visits.listByRoute(routeId); const s = { delivered: 0, partial: 0, failed: 0, skipped: 0, totalCents: 0, collectedCents: 0, byMethod: {} };
      for (const v of visits) { if (v.status === 'SKIPPED') { s.skipped++; continue; } const d = await r.deliveries.byVisit(v.id); if (d) { s[d.status.toLowerCase()]++; s.totalCents += d.total_cents; } }
      for (const p of await r.payments.byRoute(routeId)) { s.byMethod[p.method] = p.c; s.collectedCents += p.c; }
      return s;
    },

    async incident(ctx, b = {}) {
      const reason = String(b.reason ?? ''); if (!INCIDENT_REASONS[reason]) throw unprocessable('Motivo de incidencia no válido.', 'INCIDENT_REASON');
      const out = await store.tx(async (r) => {
        const route = await operatorRoute(r, ctx, b.routeId, { requireStarted: false }); let visitId = null;
        if (b.visitId) { const v = await r.visits.get(ctx.companyId, b.visitId); if (!v || v.route_id !== route.id) throw notFound('Visita no encontrada.'); visitId = v.id; }
        const id = uuid(); await r.incidents.create({ id, companyId: ctx.companyId, routeId: route.id, visitId, reason, detail: str(b.detail, 'El detalle', { max: 300 }), createdBy: ctx.userId, createdAt: now() });
        await audit(r, ctx, 'incident.reported', { entity: 'incident', entityId: id, centerId: route.center_id, detail: { reason, visitId } });
        await r.notifications.add({ companyId: ctx.companyId, centerId: route.center_id, category: 'Críticas', title: `Incidencia: ${INCIDENT_REASONS[reason]}`, detail: `${route.name}${b.detail ? ' · ' + String(b.detail).slice(0, 120) : ''}`, createdAt: now() });
        return { route, incident: { id, reason, label: INCIDENT_REASONS[reason] } };
      });
      emit(ctx, out.route, 'incident'); return out.incident;
    },

    // ----- lectura del panel -----
    async executionOf(ctx, routeId, centerIds) {
      return store.read(async (r) => {
        const route = await r.routes.get(ctx.companyId, routeId, centerIds); if (!route) throw notFound('Ruta no encontrada.');
        const visits = []; for (const v of await r.visits.listByRoute(routeId)) {
          const d = await r.deliveries.byVisit(v.id);
          visits.push({ ...visitDto(v), clientName: v.client_name, delivery: d ? { status: d.status, incidentReason: d.incident_reason, totalCents: d.total_cents, notes: d.notes, formVersion: d.form_version, form: d.form_data ? JSON.parse(d.form_data) : null,
            lines: (await r.deliveries.linesOf(d.id)).map((l) => ({ productId: l.product_id, product: l.product_name, qtyPlanned: l.qty_planned, qtyDelivered: l.qty_delivered, unitPriceCents: l.unit_price_cents, discountBp: l.discount_bp, reason: l.reason })) } : null,
            payments: (await r.payments.byVisit(v.id)).map((p) => ({ id: p.id, method: p.method, amountCents: p.amount_cents, reference: p.reference })), evidences: (await r.evidences.byVisit(v.id)).map((e) => ({ id: e.id, kind: e.kind, mime: e.mime, size: e.size, url: `/api/evidences/${e.id}` })) });
        }
        return { routeId, status: route.status, visits, incidents: (await r.incidents.byRoute(routeId)).map((i) => ({ id: i.id, reason: i.reason, label: INCIDENT_REASONS[i.reason], detail: i.detail, at: i.created_at })), summary: await this.routeSummary(r, routeId) };
      });
    },
    /** Evidencia servida con sesión: misma empresa y centro visible. */
    async evidenceFile(ctx, id, centerIds) {
      const e = await store.read(async (r) => { const row = await r.evidences.get(ctx.companyId, id); if (!row) return null; const v = await r.visits.get(ctx.companyId, row.visit_id); return centerIds.includes(v.center_id) ? row : null; });
      if (!e) throw notFound('Evidencia no encontrada.'); return { buffer: await files.read(e.path), mime: e.mime };
    },
  };
}
module.exports = { createExecutionService, INCIDENT_REASONS, computeBalance, distanceMeters };
