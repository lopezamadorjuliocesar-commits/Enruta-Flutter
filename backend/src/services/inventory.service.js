'use strict';
// Inventario por centro, carga de ruta, preventa (pedidos), comodato (activos) y auditorías de exhibición (DT-46b).
const { uuid, iso } = require('../utils/ids');
const { HttpError, conflict, notFound, unprocessable } = require('../utils/errors');
const { str, num } = require('../utils/validate');
const { makeAudit, scopeCenterIds } = require('./context');
const core = require('./commerce.core');

const int = (v, label, { min = 0, max = 1_000_000 } = {}) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw unprocessable(`${label} debe ser un entero entre ${min} y ${max}.`, 'QTY_INVALID'); return n; };

function createInventoryService({ store, clock, queue, config }) {
  const audit = makeAudit(clock); const now = () => iso(new Date(clock()));
  const alerts = (list) => Promise.all(list.filter(Boolean).map((a) => queue.enqueue({ type: 'STOCK_ALERT', companyId: a.companyId, payload: a, dedupeKey: `m${a.movementId}` })));
  const moduleGuard = async (r, ctx, name) => core.requireModule((await config.publishedPayload(r, ctx.companyId)).payload, name);
  async function centerOf(ctx, requested) {
    const id = requested || ctx.centerId; if (!id) throw unprocessable('Selecciona un centro para ver su inventario.', 'CENTER_REQUIRED');
    if (!ctx.accessibleCenterIds.includes(id)) throw notFound('Centro no encontrado.'); return id;
  }
  const orderDto = async (r, o) => ({ id: o.id, clientId: o.client_id, clientName: o.client_name, status: o.status, notes: o.notes, createdAt: o.created_at, lines: (await r.orders.lines(o.id)).map((l) => ({ productId: l.product_id, product: l.product_name, sku: l.sku, unit: l.unit, qty: l.qty, qtyDelivered: l.qty_delivered })) });
  const assetDto = (a) => ({ id: a.id, code: a.code, kind: a.kind, description: a.description, status: a.status, centerId: a.center_id, clientId: a.client_id, clientName: a.client_name ?? null });

  return {
    // ---------------- stock ----------------
    async stock(ctx, q = {}) {
      const centerId = await centerOf(ctx, q.centerId);
      return store.read(async (r) => {
        const rows = new Map((await r.stock.list(ctx.companyId, [centerId])).map((s) => [s.product_id, s]));
        const items = (await r.products.list(ctx.companyId, { status: 'ACTIVE' })).map((p) => { const s = rows.get(p.id); const qty = s?.qty ?? 0; const min = s?.min_qty ?? 0; return { productId: p.id, sku: p.sku, name: p.name, unit: p.unit, qty, minQty: min, low: min > 0 && qty <= min }; });
        return { centerId, items, lowCount: items.filter((i) => i.low).length };
      });
    },
    async adjust(ctx, b = {}) {
      const centerId = await centerOf(ctx, b.centerId); const note = str(b.note, 'La nota', { max: 200 });
      if (b.delta === undefined && b.set === undefined && b.minQty === undefined) throw unprocessable('Indica delta, set o minQty.', 'ADJUST_EMPTY');
      const out = await store.tx(async (r) => {
        const p = await r.products.get(ctx.companyId, String(b.productId ?? '')); if (!p) throw unprocessable('El producto no existe.', 'PRODUCT_INVALID');
        let alert = null; let after = (await r.stock.get(centerId, p.id))?.qty ?? 0;
        if (b.minQty !== undefined) await r.stock.setMin(ctx.companyId, centerId, p.id, int(b.minQty, 'El stock mínimo'));
        if (b.delta !== undefined || b.set !== undefined) {
          const delta = b.set !== undefined ? int(b.set, 'La cantidad') - after : int(b.delta, 'El ajuste', { min: -1_000_000 });
          if (delta !== 0) { const res = await core.applyStock(r, { companyId: ctx.companyId, centerId, productId: p.id, delta, reason: 'ADJUST', note, userId: ctx.userId, at: now() }); after = res.after; alert = res.alert && { ...res.alert, companyId: ctx.companyId }; }
        }
        await audit(r, ctx, 'stock.adjusted', { entity: 'product', entityId: p.id, centerId, detail: { delta: b.delta, set: b.set, minQty: b.minQty, after, note } });
        return { alert, row: { productId: p.id, qty: after, minQty: (await r.stock.get(centerId, p.id))?.min_qty ?? 0 } };
      });
      await alerts([out.alert]); return out.row;
    },
    async movements(ctx, q = {}) {
      const centerId = await centerOf(ctx, q.centerId);
      return store.read(async (r) => (await r.stock.movements(ctx.companyId, [centerId], q.productId, 100)).map((m) => ({ id: m.id, product: m.product_name, productId: m.product_id, delta: m.delta, balanceAfter: m.balance_after, reason: m.reason, routeId: m.route_id, note: m.note, at: m.created_at })));
    },

    // ---------------- carga de ruta ----------------
    async loadRoute(ctx, routeId, b = {}) {
      const raw = Array.isArray(b.lines) ? b.lines : []; if (!raw.length || raw.length > 100) throw unprocessable('Indica al menos un producto a cargar.', 'LOAD_EMPTY');
      const out = await store.tx(async (r) => {
        const route = await r.routes.get(ctx.companyId, routeId, scopeCenterIds(ctx)); if (!route) throw notFound('Ruta no encontrada.');
        if (!['PUBLISHED', 'IN_PROGRESS'].includes(route.status)) throw conflict('Solo se carga una ruta publicada o en ejecución.', 'ROUTE_STATE');
        const seen = new Set(); const found = [];
        for (const l of raw) {
          const p = await r.products.get(ctx.companyId, String(l.productId ?? '')); if (!p || p.status !== 'ACTIVE') throw unprocessable('Uno de los productos no existe o está inactivo.', 'PRODUCT_INVALID');
          if (seen.has(p.id)) throw unprocessable(`El producto ${p.name} está repetido.`, 'LINE_DUPLICATE'); seen.add(p.id);
          const qty = int(l.qty, `La cantidad de ${p.name}`, { min: 1 });
          const res = await core.applyStock(r, { companyId: ctx.companyId, centerId: route.center_id, productId: p.id, delta: -qty, reason: 'ROUTE_LOAD', routeId, userId: ctx.userId, at: now() });
          await r.loads.add(routeId, p.id, qty); found.push(res.alert && { ...res.alert, companyId: ctx.companyId });
        }
        await audit(r, ctx, 'route.loaded', { entity: 'route', entityId: routeId, centerId: route.center_id, detail: { lines: raw.length } });
        return { alerts: found, loads: await this._loadView(r, routeId) };
      });
      await alerts(out.alerts); return out.loads;
    },
    async _loadView(r, routeId) { return (await r.loads.list(routeId)).map((l) => ({ productId: l.product_id, product: l.product_name, sku: l.sku, loaded: l.qty_loaded, sold: l.qty_sold, returned: l.qty_returned, remaining: l.qty_loaded - l.qty_sold - l.qty_returned })); },
    async routeLoad(ctx, routeId) { return store.read(async (r) => { const route = await r.routes.get(ctx.companyId, routeId, scopeCenterIds(ctx)); if (!route) throw notFound('Ruta no encontrada.'); return this._loadView(r, routeId); }); },
    /** Handler de la cola: aviso persistente de stock bajo. */
    async stockAlertJob({ companyId, centerId, productId, qty, minQty }) {
      await store.tx(async (r) => { const p = await r.products.get(companyId, productId); if (!p) return; await r.notifications.add({ companyId, centerId, category: 'Inventario', title: 'Stock bajo', detail: `${p.name}: quedan ${qty} (mínimo ${minQty}).`, createdAt: now() }); });
    },

    // ---------------- preventa ----------------
    async createOrder(ctx, b = {}) {
      const raw = Array.isArray(b.lines) ? b.lines : []; if (!raw.length || raw.length > 100) throw unprocessable('El pedido necesita al menos un producto.', 'ORDER_EMPTY');
      return store.tx(async (r) => {
        await moduleGuard(r, ctx, core.MODULE.PREVENTA);
        const client = await r.clients.get(ctx.companyId, ctx.accessibleCenterIds, String(b.clientId ?? '')); if (!client || client.status !== 'ACTIVE') throw unprocessable('El cliente no existe o está inactivo.', 'CLIENT_INVALID');
        if (await r.orders.openForClient(ctx.companyId, client.id)) throw conflict('El cliente ya tiene un pedido abierto: cancélalo o espera su entrega.', 'ORDER_OPEN_EXISTS');
        const seen = new Set(); const lines = [];
        for (const l of raw) { const p = await r.products.get(ctx.companyId, String(l.productId ?? '')); if (!p || p.status !== 'ACTIVE') throw unprocessable('Uno de los productos no existe o está inactivo.', 'PRODUCT_INVALID'); if (seen.has(p.id)) throw unprocessable(`El producto ${p.name} está repetido.`, 'LINE_DUPLICATE'); seen.add(p.id); lines.push({ productId: p.id, qty: int(l.qty, `La cantidad de ${p.name}`, { min: 1 }) }); }
        const id = uuid(); await r.orders.create({ id, companyId: ctx.companyId, centerId: client.center_id, clientId: client.id, notes: str(b.notes, 'Las notas', { max: 300 }), createdBy: ctx.userId }, lines);
        await audit(r, ctx, 'order.created', { entity: 'order', entityId: id, centerId: client.center_id, detail: { clientId: client.id, lines: lines.length } });
        return orderDto(r, await r.orders.get(ctx.companyId, id));
      });
    },
    async orders(ctx, q = {}) { return store.read(async (r) => { const out = []; for (const o of await r.orders.list(ctx.companyId, scopeCenterIds(ctx), { status: q.status, clientId: q.clientId })) out.push(await orderDto(r, o)); return out; }); },
    async cancelOrder(ctx, id) {
      return store.tx(async (r) => {
        const o = await r.orders.get(ctx.companyId, id); if (!o || !scopeCenterIds(ctx).includes(o.center_id)) throw notFound('Pedido no encontrado.');
        if (o.status !== 'OPEN') throw conflict('Solo se cancela un pedido abierto.', 'ORDER_STATE');
        await r.orders.setStatus(id, 'CANCELLED'); await audit(r, ctx, 'order.cancelled', { entity: 'order', entityId: id, centerId: o.center_id }); return orderDto(r, await r.orders.get(ctx.companyId, id));
      });
    },

    // ---------------- comodato ----------------
    async assets(ctx, q = {}) { return store.read(async (r) => (await r.assets.listScoped(ctx.companyId, scopeCenterIds(ctx), { clientId: q.clientId, status: q.status })).map(assetDto)); },
    async createAsset(ctx, b = {}) {
      return store.tx(async (r) => {
        await moduleGuard(r, ctx, core.MODULE.COMODATO); const centerId = await centerOf(ctx, b.centerId);
        const code = str(b.code, 'El código', { required: true, max: 40 }); const kind = str(b.kind, 'El tipo de activo', { required: true, max: 60 });
        if ((await r.assets.list(ctx.companyId)).some((a) => a.code.toLowerCase() === code.toLowerCase())) throw conflict('Ya existe un activo con ese código.', 'ASSET_CODE_TAKEN');
        const id = uuid(); await r.assets.create({ id, company_id: ctx.companyId, center_id: centerId, code, kind, description: str(b.description, 'La descripción', { max: 200 }), status: 'IN_STOCK', client_id: null });
        await r.assets.addEvent({ companyId: ctx.companyId, assetId: id, kind: 'RETURN', note: 'Alta en almacén', createdBy: ctx.userId, createdAt: now() });
        await audit(r, ctx, 'asset.created', { entity: 'asset', entityId: id, centerId, detail: { code, kind } }); return assetDto(await r.assets.get(ctx.companyId, id));
      });
    },
    async assetAction(ctx, id, action, b = {}) {
      return store.tx(async (r) => {
        await moduleGuard(r, ctx, core.MODULE.COMODATO);
        const a = await r.assets.get(ctx.companyId, id); if (!a || !scopeCenterIds(ctx).includes(a.center_id)) throw notFound('Activo no encontrado.');
        const t = now(); const note = str(b.note, 'La nota', { max: 200 });
        if (action === 'loan') {
          if (a.status !== 'IN_STOCK') throw conflict('El activo no está disponible en el almacén.', 'ASSET_STATE');
          const c = await r.clients.get(ctx.companyId, ctx.accessibleCenterIds, String(b.clientId ?? '')); if (!c || c.center_id !== a.center_id) throw unprocessable('Elige un cliente del mismo centro del activo.', 'CLIENT_INVALID');
          await r.assets.update(ctx.companyId, id, { status: 'LOANED', client_id: c.id }); await r.assets.addEvent({ companyId: ctx.companyId, assetId: id, kind: 'LOAN', clientId: c.id, note, createdBy: ctx.userId, createdAt: t });
        } else if (action === 'return') {
          if (a.status !== 'LOANED') throw conflict('El activo no está en comodato.', 'ASSET_STATE');
          await r.assets.update(ctx.companyId, id, { status: 'IN_STOCK', client_id: null }); await r.assets.addEvent({ companyId: ctx.companyId, assetId: id, kind: 'RETURN', clientId: a.client_id, note, createdBy: ctx.userId, createdAt: t });
        } else if (action === 'retire') {
          if (a.status === 'LOANED') throw conflict('Recoge el activo antes de darlo de baja.', 'ASSET_STATE');
          await r.assets.update(ctx.companyId, id, { status: 'RETIRED', client_id: null }); await r.assets.addEvent({ companyId: ctx.companyId, assetId: id, kind: 'RETIRE', note, createdBy: ctx.userId, createdAt: t });
        } else throw unprocessable('Acción no válida.', 'ASSET_ACTION');
        await audit(r, ctx, `asset.${action}`, { entity: 'asset', entityId: id, centerId: a.center_id, detail: { code: a.code } }); return assetDto(await r.assets.get(ctx.companyId, id));
      });
    },
    async assetEvents(ctx, id) { return store.read(async (r) => { const a = await r.assets.get(ctx.companyId, id); if (!a || !scopeCenterIds(ctx).includes(a.center_id)) throw notFound('Activo no encontrado.'); return (await r.assets.events(id)).map((e) => ({ kind: e.kind, clientId: e.client_id, visitId: e.visit_id, note: e.note, at: e.created_at })); }); },

    // ---------------- exhibición ----------------
    async displayAudits(ctx) {
      return store.read(async (r) => { const out = []; for (const d of await r.displayAudits.listScoped(ctx.companyId, scopeCenterIds(ctx))) out.push({ id: d.id, client: d.client_name, routeId: d.route_id, notes: d.notes, at: d.created_at, lines: (await r.displayAudits.lines(d.id)).map((l) => ({ product: l.product_name, fronts: l.fronts, expectedFronts: l.expected_fronts })) }); return out; });
    },
  };
}
module.exports = { createInventoryService };
