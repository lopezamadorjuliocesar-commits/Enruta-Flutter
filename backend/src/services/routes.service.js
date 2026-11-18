'use strict';
// Ciclo de rutas (DT-23…25): DRAFT → PENDING_APPROVAL → PUBLISHED → IN_PROGRESS → COMPLETED, más rechazo y cancelación.
// Cada edición relevante incrementa `revision`; la aprobación es de una revisión exacta y se invalida al editar.
const { uuid, iso } = require('../utils/ids');
const { HttpError, conflict, notFound, unprocessable, badRequest } = require('../utils/errors');
const { str } = require('../utils/validate');
const { scopeCenterIds, makeAudit } = require('./context');

const STATUS = { DRAFT: 'DRAFT', PENDING: 'PENDING_APPROVAL', PUBLISHED: 'PUBLISHED', IN_PROGRESS: 'IN_PROGRESS', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED' };
const EDITABLE = new Set([STATUS.DRAFT, STATUS.PENDING, STATUS.PUBLISHED]);
const LABELS = { DRAFT: 'Borrador', PENDING_APPROVAL: 'Pendiente de aprobación', PUBLISHED: 'Publicada', IN_PROGRESS: 'En ejecución', COMPLETED: 'Finalizada', CANCELLED: 'Cancelada' };

const dto = (r, stopIds = [], approval = null) => ({
  id: r.id, name: r.name, day: r.day, color: r.color, centerId: r.center_id, zoneId: r.zone_id, operatorId: r.operator_user_id, operatorName: r.operator_name ?? null,
  vehicleId: r.vehicle_id, vehiclePlate: r.vehicle_plate ?? null, status: r.status, statusLabel: r.last_decision === 'REJECTED' && r.status === 'DRAFT' ? 'Rechazada' : LABELS[r.status],
  revision: r.revision, approvedRevision: r.approved_revision, lastDecision: r.last_decision, lastDecisionReason: r.last_decision_reason,
  startedAt: r.started_at, finishedAt: r.finished_at, createdAt: r.created_at, updatedAt: r.updated_at, stopIds,
  approval: approval ? { id: approval.id, revision: approval.revision, decision: approval.decision, requestedBy: approval.requested_by, requestedAt: approval.requested_at } : null,
});

function createRoutesService({ store, clock, bus }) {
  const audit = makeAudit(clock);
  const now = () => iso(new Date(clock()));
  const emit = (r, ctx, route, what) => bus?.publish({ companyId: ctx.companyId, centerId: route.center_id, type: 'route.updated', data: { routeId: route.id, status: route.status, revision: route.revision, what } });

  async function load(r, ctx, id) {
    const route = await r.routes.get(ctx.companyId, id, scopeCenterIds(ctx));
    if (!route) throw notFound('Ruta no encontrada.');
    return route;
  }
  const needRevision = (b) => { const n = Number(b?.revision); if (!Number.isInteger(n) || n < 1) throw badRequest('Indica la revisión de la ruta (revision).', 'REVISION_REQUIRED'); return n; };
  const checkRevision = (route, n) => { if (route.revision !== n) throw conflict(`La ruta cambió (revisión ${route.revision}; tú tenías la ${n}). Recarga y vuelve a intentarlo.`, 'REVISION_CONFLICT'); };
  const needEditable = (route) => { if (!EDITABLE.has(route.status)) throw conflict(`La ruta está ${LABELS[route.status].toLowerCase()} y ya no se puede editar.`, 'ROUTE_LOCKED'); };

  async function present(r, ctx, rows) {
    const stops = await r.routes.stopsOf(rows.map((x) => x.id)); const out = [];
    for (const row of rows) out.push(dto(row, stops.get(row.id) ?? [], row.status === 'PENDING_APPROVAL' ? await r.approvals.open(row.id) : null));
    return out;
  }
  const presentOne = async (r, ctx, id) => (await present(r, ctx, [await r.routes.get(ctx.companyId, id)]))[0];

  /** Un cambio relevante sube la revisión; si la ruta estaba pendiente o publicada vuelve a BORRADOR y se invalida la aprobación. */
  async function bump(r, ctx, route, what) {
    const t = now(); let status = route.status; let invalidated = false;
    if (route.status === STATUS.PENDING || route.status === STATUS.PUBLISHED) {
      status = STATUS.DRAFT; invalidated = true;
      await r.approvals.invalidateFor(route.id, t, `Editada: ${what}`);
      await r.routeHistory.add({ routeId: route.id, from: route.status, to: STATUS.DRAFT, revision: route.revision + 1, actorId: ctx.userId, note: `Aprobación invalidada por edición (${what})`, at: t });
      await r.notifications.add({ companyId: ctx.companyId, centerId: route.center_id, category: 'Aprobaciones', title: 'Aprobación invalidada', detail: `La ruta ${route.name} se editó (${what}); debe aprobarse de nuevo.`, createdAt: t });
      await audit(r, ctx, 'route.approval_invalidated', { entity: 'route', entityId: route.id, centerId: route.center_id, detail: { from: route.status, revision: route.revision + 1, what } });
    }
    const patch = { revision: route.revision + 1, status, last_decision: null, last_decision_reason: null };
    if (invalidated) patch.approved_revision = null;
    await r.routes.update(ctx.companyId, route.id, patch);
    return { ...route, ...patch };
  }

  async function validateForApproval(r, ctx, route) {
    const problems = [];
    if (!route.operator_user_id) problems.push('Asigna un operador a la ruta.');
    else {
      const op = await r.users.getById(route.operator_user_id);
      if (!op || op.company_id !== ctx.companyId) problems.push('El operador asignado no existe.');
      else if (op.status !== 'ACTIVE') problems.push(`El operador ${op.name} está inactivo.`);
      else {
        const perms = await r.users.permissionsOf(op.id);
        if (!perms.includes('deliveries.execute')) problems.push(`${op.name} no tiene permiso para entregar (rol sin operación en campo).`);
        const centers = await r.users.centerIds(op.id);
        if (!perms.includes('centers.all') && !centers.includes(route.center_id)) problems.push(`${op.name} no está asignado al centro de la ruta.`);
      }
    }
    const stops = await r.routes.stopClients(route.id);
    if (!stops.length) problems.push('Agrega al menos una parada.');
    for (const s of stops) {
      if (s.status !== 'ACTIVE') problems.push(`El cliente ${s.name} está inactivo.`);
      if (s.lat === null || s.lng === null) problems.push(`El cliente ${s.name} no tiene ubicación.`);
    }
    if (problems.length) throw new HttpError(422, 'ROUTE_INVALID', problems[0], { problems });
  }

  async function checkOperator(r, ctx, operatorId, centerId) {
    if (!operatorId) return null;
    const op = await r.users.get(ctx.companyId, operatorId);
    if (!op) throw unprocessable('El operador no existe.', 'OPERATOR_INVALID');
    return op.id;
  }
  async function checkVehicle(r, ctx, vehicleId) {
    if (!vehicleId) return null;
    if (!(await r.vehicles.get(ctx.companyId, vehicleId))) throw unprocessable('El vehículo no existe.', 'VEHICLE_INVALID');
    return vehicleId;
  }
  async function checkZone(r, ctx, zoneId, centerId) {
    if (!zoneId) return null;
    const z = await r.zones.get(ctx.companyId, zoneId); if (!z || z.center_id !== centerId) throw unprocessable('La zona no pertenece al centro de la ruta.', 'ZONE_INVALID'); return zoneId;
  }

  return {
    LABELS,
    async list(ctx) { return store.read(async (r) => present(r, ctx, await r.routes.list(ctx.companyId, scopeCenterIds(ctx)))); },
    async get(ctx, id) { return store.read(async (r) => { const route = await load(r, ctx, id); return { ...(await present(r, ctx, [route]))[0], history: (await r.routeHistory.list(id)).map((h) => ({ from: h.from_status, to: h.to_status, revision: h.revision, actorId: h.actor_id, note: h.note, at: h.at })), approvals: (await r.approvals.list(id)).map((a) => ({ id: a.id, revision: a.revision, decision: a.decision, requestedBy: a.requested_by, decidedBy: a.decided_by, reason: a.reason, selfApproved: !!a.self_approved, requestedAt: a.requested_at, decidedAt: a.decided_at })) }; }); },

    async create(ctx, b) {
      const name = str(b.name, 'El nombre de la ruta', { required: true, max: 120 });
      const centerId = b.centerId || ctx.centerId;
      if (!centerId) throw unprocessable('Selecciona un centro para la ruta.', 'CENTER_REQUIRED');
      if (!scopeCenterIds(ctx).includes(centerId)) throw notFound('Centro no encontrado.');
      return store.tx(async (r) => {
        if (await r.routes.nameTaken(ctx.companyId, name)) throw conflict('Ya existe una ruta con ese nombre.', 'ROUTE_NAME_TAKEN');
        const route = await r.routes.create({ id: uuid(), companyId: ctx.companyId, centerId, zoneId: await checkZone(r, ctx, b.zoneId, centerId), name, day: str(b.day, 'El día', { max: 30 }), color: str(b.color, 'El color', { max: 20 }),
          operatorId: await checkOperator(r, ctx, b.operatorId, centerId), vehicleId: await checkVehicle(r, ctx, b.vehicleId), createdBy: ctx.userId });
        await r.routeHistory.add({ routeId: route.id, to: STATUS.DRAFT, revision: 1, actorId: ctx.userId, note: 'Creada', at: now() });
        await audit(r, ctx, 'route.created', { entity: 'route', entityId: route.id, centerId, detail: { name } });
        emit(r, ctx, route, 'created');
        return presentOne(r, ctx, route.id);
      });
    },

    /** Edición de datos de la ruta. `color` es cosmético (no sube la revisión); el resto sí. */
    async update(ctx, id, b) {
      const revision = needRevision(b);
      return store.tx(async (r) => {
        const route = await load(r, ctx, id); checkRevision(route, revision); needEditable(route);
        const patch = {}; const changed = [];
        if (b.name !== undefined) { const name = str(b.name, 'El nombre de la ruta', { required: true, max: 120 }); if (name !== route.name) { if (await r.routes.nameTaken(ctx.companyId, name, id)) throw conflict('Ya existe una ruta con ese nombre.', 'ROUTE_NAME_TAKEN'); patch.name = name; changed.push('nombre'); } }
        if (b.day !== undefined) { const day = str(b.day, 'El día', { max: 30 }); if (day !== route.day) { patch.day = day; changed.push('día'); } }
        if (b.operatorId !== undefined) { const op = await checkOperator(r, ctx, b.operatorId || null, route.center_id); if (op !== route.operator_user_id) { patch.operator_user_id = op; changed.push('operador'); } }
        if (b.vehicleId !== undefined) { const v = await checkVehicle(r, ctx, b.vehicleId || null); if (v !== route.vehicle_id) { patch.vehicle_id = v; changed.push('vehículo'); } }
        if (b.zoneId !== undefined) { const z = await checkZone(r, ctx, b.zoneId || null, route.center_id); if (z !== route.zone_id) { patch.zone_id = z; changed.push('zona'); } }
        const cosmetic = {}; if (b.color !== undefined) { const c = str(b.color, 'El color', { max: 20 }); if (c !== route.color) cosmetic.color = c; }
        if (changed.length) { await r.routes.update(ctx.companyId, id, patch); await bump(r, ctx, { ...route, ...patch }, changed.join(', ')); }
        if (Object.keys(cosmetic).length) await r.routes.update(ctx.companyId, id, cosmetic);
        if (changed.length) await audit(r, ctx, 'route.updated', { entity: 'route', entityId: id, centerId: route.center_id, detail: { changed } });
        const fresh = await r.routes.get(ctx.companyId, id); emit(r, ctx, fresh, 'updated');
        return presentOne(r, ctx, id);
      });
    },

    async setStops(ctx, id, b) {
      const revision = needRevision(b); const ids = Array.isArray(b.clientIds) ? b.clientIds : null;
      if (!ids) throw badRequest('clientIds debe ser una lista.', 'STOPS_INVALID');
      if (new Set(ids).size !== ids.length) throw unprocessable('Un cliente no puede repetirse en la ruta.', 'STOPS_DUPLICATE');
      return store.tx(async (r) => {
        const route = await load(r, ctx, id); checkRevision(route, revision); needEditable(route);
        const clients = await r.routeRefs.clientsByIds(ctx.companyId, ids);
        if (clients.length !== ids.length) throw unprocessable('Uno de los clientes no existe.', 'STOPS_INVALID');
        for (const c of clients) if (c.center_id !== route.center_id) throw unprocessable(`El cliente ${c.name} pertenece a otro centro.`, 'STOPS_CENTER');
        const current = (await r.routes.stops(id)).map((s) => s.client_id);
        if (JSON.stringify(current) === JSON.stringify(ids)) return presentOne(r, ctx, id);
        await r.routes.setStops(id, ids);
        await bump(r, ctx, route, 'paradas');
        await audit(r, ctx, 'route.stops_changed', { entity: 'route', entityId: id, centerId: route.center_id, detail: { count: ids.length } });
        emit(r, ctx, await r.routes.get(ctx.companyId, id), 'stops');
        return presentOne(r, ctx, id);
      });
    },

    async submit(ctx, id, b) {
      const revision = needRevision(b);
      return store.tx(async (r) => {
        const route = await load(r, ctx, id); checkRevision(route, revision);
        if (route.status !== STATUS.DRAFT) throw conflict(`Solo se puede enviar a aprobación una ruta en borrador (está ${LABELS[route.status].toLowerCase()}).`, 'ROUTE_STATE');
        await validateForApproval(r, ctx, route);
        const t = now();
        await r.approvals.create({ id: uuid(), routeId: id, revision: route.revision, requestedBy: ctx.userId, at: t });
        await r.routes.update(ctx.companyId, id, { status: STATUS.PENDING });
        await r.routeHistory.add({ routeId: id, from: STATUS.DRAFT, to: STATUS.PENDING, revision: route.revision, actorId: ctx.userId, at: t });
        await r.notifications.add({ companyId: ctx.companyId, centerId: route.center_id, category: 'Aprobaciones', title: 'Aprobación pendiente', detail: `La ruta ${route.name} (revisión ${route.revision}) espera autorización.`, createdAt: t });
        await audit(r, ctx, 'route.submitted', { entity: 'route', entityId: id, centerId: route.center_id, detail: { revision: route.revision } });
        emit(r, ctx, { ...route, status: STATUS.PENDING }, 'submitted');
        return presentOne(r, ctx, id);
      });
    },

    /** La aprobación valida la VERSIÓN EXACTA: si la ruta cambió desde que se solicitó, se rechaza con 409. */
    async approve(ctx, id, b) {
      const revision = needRevision(b);
      return store.tx(async (r) => {
        const route = await load(r, ctx, id);
        if (route.status !== STATUS.PENDING) throw conflict(`La ruta no está pendiente de aprobación (está ${LABELS[route.status].toLowerCase()}).`, 'ROUTE_STATE');
        if (route.revision !== revision) throw conflict(`Esta aprobación es de la revisión ${revision}, pero la ruta está en la ${route.revision}. Revisa los cambios.`, 'REVISION_MISMATCH');
        const open = await r.approvals.open(id);
        if (!open || open.revision !== route.revision) throw conflict('La solicitud de aprobación ya no corresponde a esta versión de la ruta.', 'REVISION_MISMATCH');
        await validateForApproval(r, ctx, route);
        const t = now(); const self = open.requested_by === ctx.userId ? 1 : 0;
        await r.approvals.decide(open.id, { decision: 'APPROVED', by: ctx.userId, at: t, selfApproved: self });
        await r.routes.update(ctx.companyId, id, { status: STATUS.PUBLISHED, approved_revision: route.revision, last_decision: null, last_decision_reason: null });
        await r.routeHistory.add({ routeId: id, from: STATUS.PENDING, to: STATUS.PUBLISHED, revision: route.revision, actorId: ctx.userId, note: self ? 'Autoaprobada' : null, at: t });
        await audit(r, ctx, 'route.approved', { entity: 'route', entityId: id, centerId: route.center_id, detail: { revision: route.revision, selfApproved: !!self } });
        emit(r, ctx, { ...route, status: STATUS.PUBLISHED }, 'approved');
        if (route.operator_user_id) bus?.publish({ companyId: ctx.companyId, userId: route.operator_user_id, type: 'route.assigned', data: { routeId: id, name: route.name } });
        return presentOne(r, ctx, id);
      });
    },

    async reject(ctx, id, b) {
      const revision = needRevision(b); const reason = str(b.reason, 'El motivo', { max: 300 });
      return store.tx(async (r) => {
        const route = await load(r, ctx, id);
        if (route.status !== STATUS.PENDING) throw conflict(`La ruta no está pendiente de aprobación (está ${LABELS[route.status].toLowerCase()}).`, 'ROUTE_STATE');
        if (route.revision !== revision) throw conflict(`La ruta está en la revisión ${route.revision}, no en la ${revision}.`, 'REVISION_MISMATCH');
        const open = await r.approvals.open(id); const t = now();
        if (open) await r.approvals.decide(open.id, { decision: 'REJECTED', by: ctx.userId, at: t, reason });
        await r.routes.update(ctx.companyId, id, { status: STATUS.DRAFT, last_decision: 'REJECTED', last_decision_reason: reason });
        await r.routeHistory.add({ routeId: id, from: STATUS.PENDING, to: STATUS.DRAFT, revision: route.revision, actorId: ctx.userId, note: reason ? `Rechazada: ${reason}` : 'Rechazada', at: t });
        await audit(r, ctx, 'route.rejected', { entity: 'route', entityId: id, centerId: route.center_id, detail: { revision: route.revision, reason } });
        emit(r, ctx, { ...route, status: STATUS.DRAFT }, 'rejected');
        return presentOne(r, ctx, id);
      });
    },

    async cancel(ctx, id, b = {}) {
      return store.tx(async (r) => {
        const route = await load(r, ctx, id);
        if (![STATUS.DRAFT, STATUS.PENDING, STATUS.PUBLISHED, STATUS.IN_PROGRESS].includes(route.status)) throw conflict(`La ruta ya está ${LABELS[route.status].toLowerCase()}.`, 'ROUTE_STATE');
        const t = now(); await r.approvals.invalidateFor(id, t, 'Ruta cancelada');
        await r.routes.update(ctx.companyId, id, { status: STATUS.CANCELLED, approved_revision: null });
        await r.routeHistory.add({ routeId: id, from: route.status, to: STATUS.CANCELLED, revision: route.revision, actorId: ctx.userId, note: str(b.reason, 'El motivo', { max: 300 }), at: t });
        await audit(r, ctx, 'route.cancelled', { entity: 'route', entityId: id, centerId: route.center_id, detail: { from: route.status } });
        emit(r, ctx, { ...route, status: STATUS.CANCELLED }, 'cancelled');
        if (route.operator_user_id) bus?.publish({ companyId: ctx.companyId, userId: route.operator_user_id, type: 'route.cancelled', data: { routeId: id, name: route.name } });
        return presentOne(r, ctx, id);
      });
    },

    async duplicate(ctx, id) {
      return store.tx(async (r) => {
        const route = await load(r, ctx, id); let name = `${route.name} (copia)`; let n = 2;
        while (await r.routes.nameTaken(ctx.companyId, name)) name = `${route.name} (copia ${n++})`;
        const copy = await r.routes.create({ id: uuid(), companyId: ctx.companyId, centerId: route.center_id, zoneId: route.zone_id, name, day: route.day, color: route.color, operatorId: route.operator_user_id, vehicleId: route.vehicle_id, createdBy: ctx.userId });
        await r.routes.setStops(copy.id, (await r.routes.stops(id)).map((s) => s.client_id));
        await r.routeHistory.add({ routeId: copy.id, to: STATUS.DRAFT, revision: 1, actorId: ctx.userId, note: `Duplicada de ${route.name}`, at: now() });
        await audit(r, ctx, 'route.duplicated', { entity: 'route', entityId: copy.id, centerId: route.center_id, detail: { from: id } });
        emit(r, ctx, copy, 'created');
        return presentOne(r, ctx, copy.id);
      });
    },

    async remove(ctx, id) {
      return store.tx(async (r) => {
        const route = await load(r, ctx, id);
        if (route.status !== STATUS.DRAFT && route.status !== STATUS.CANCELLED) throw conflict('Solo se eliminan rutas en borrador o canceladas. Cancela la ruta primero.', 'ROUTE_STATE');
        await r.routes.delete(ctx.companyId, id); await audit(r, ctx, 'route.deleted', { entity: 'route', entityId: id, centerId: route.center_id, detail: { name: route.name } });
        bus?.publish({ companyId: ctx.companyId, centerId: route.center_id, type: 'route.updated', data: { routeId: id, status: 'DELETED', what: 'deleted' } });
        return { id };
      });
    },

    /** Solicitudes pendientes (bandeja de aprobaciones). */
    async approvals(ctx) {
      return store.read(async (r) => {
        const pending = (await r.routes.list(ctx.companyId, scopeCenterIds(ctx))).filter((x) => x.status === STATUS.PENDING);
        return present(r, ctx, pending);
      });
    },

    // ---- uso por el repartidor (contrato móvil) ----
    async assignedTo(ctx) {
      return store.read(async (r) => {
        const rows = await r.routes.listAssigned(ctx.companyId, ctx.userId, [STATUS.PUBLISHED, STATUS.IN_PROGRESS]); const out = [];
        for (const row of rows) { const [d] = await present(r, ctx, [row]); out.push({ ...d, stops: (await r.routes.stopClients(row.id)).map((s) => ({ clientId: s.id, seq: s.seq, name: s.name, address: s.address, phone: s.phone, lat: s.lat, lng: s.lng })) }); }
        return out;
      });
    },
    async start(ctx, id) {
      return store.tx(async (r) => {
        const route = await r.routes.get(ctx.companyId, id);
        if (!route || route.operator_user_id !== ctx.userId) throw notFound('Ruta no encontrada.');
        if (route.status === STATUS.IN_PROGRESS) return presentOne(r, ctx, id);
        if (route.status !== STATUS.PUBLISHED) throw conflict(`La ruta no está publicada (está ${LABELS[route.status].toLowerCase()}).`, 'ROUTE_STATE');
        if (route.approved_revision !== route.revision) throw conflict('La versión actual de la ruta no está aprobada.', 'NOT_APPROVED');
        const op = await r.users.getById(ctx.userId); if (!op || op.status !== 'ACTIVE') throw conflict('Tu usuario no está activo.', 'OPERATOR_INACTIVE');
        const t = now();
        await r.routes.update(ctx.companyId, id, { status: STATUS.IN_PROGRESS, started_at: t });
        await r.routeHistory.add({ routeId: id, from: STATUS.PUBLISHED, to: STATUS.IN_PROGRESS, revision: route.revision, actorId: ctx.userId, at: t });
        await audit(r, ctx, 'route.started', { entity: 'route', entityId: id, centerId: route.center_id, detail: { revision: route.revision } });
        emit(r, ctx, { ...route, status: STATUS.IN_PROGRESS }, 'started');
        return presentOne(r, ctx, id);
      });
    },
  };
}
module.exports = { createRoutesService, STATUS, LABELS };
