'use strict';
// Clientes (alcance por EMPRESA + CENTRO) y productos (alcance por EMPRESA). Base mínima de la Fase 1.
const { uuid, iso } = require('../utils/ids');
const { conflict, notFound, unprocessable } = require('../utils/errors');
const { str, num } = require('../utils/validate');
const { scopeCenterIds, makeAudit } = require('./context');

const clientDto = (c) => ({ id: c.id, centerId: c.center_id, zoneId: c.zone_id, code: c.code, name: c.name, rfc: c.rfc, address: c.address, lat: c.lat, lng: c.lng, phone: c.phone, status: c.status, createdAt: c.created_at, updatedAt: c.updated_at });
const productDto = (p) => ({ id: p.id, sku: p.sku, name: p.name, category: p.category, unit: p.unit, status: p.status, createdAt: p.created_at, updatedAt: p.updated_at });
const STATUS = ['ACTIVE', 'INACTIVE'];

function createCatalogService({ store, clock }) {
  const audit = makeAudit(clock);
  const t = () => iso(new Date(clock()));

  async function checkZone(r, ctx, zoneId, centerId) {
    if (!zoneId) return null;
    const z = await r.zones.get(ctx.companyId, zoneId);
    if (!z || z.center_id !== centerId) throw unprocessable('La zona no pertenece al centro del cliente.', 'ZONE_INVALID');
    return zoneId;
  }
  function fields(b, partial) {
    const out = {};
    const set = (k, v) => { if (!partial || b[k] !== undefined) out[k] = v(); };
    set('name', () => str(b.name, 'El nombre', { required: true, max: 160 }));
    set('code', () => str(b.code, 'El código', { max: 40 }));
    set('rfc', () => str(b.rfc, 'El RFC', { max: 13 })?.toUpperCase() ?? null);
    set('address', () => str(b.address, 'La dirección', { max: 240 }));
    set('phone', () => str(b.phone, 'El teléfono', { max: 30 }));
    set('lat', () => num(b.lat, 'La latitud', { min: -90, max: 90 }));
    set('lng', () => num(b.lng, 'La longitud', { min: -180, max: 180 }));
    if ((out.lat === null || out.lat === undefined) !== (out.lng === null || out.lng === undefined) && (!partial || b.lat !== undefined || b.lng !== undefined)) throw unprocessable('Captura latitud y longitud juntas.', 'COORDINATES_INCOMPLETE');
    if (b.status !== undefined) { if (!STATUS.includes(b.status)) throw unprocessable('Estado no válido.', 'STATUS_INVALID'); out.status = b.status; }
    return out;
  }
  const dupe = (e, what) => { if (/UNIQUE/i.test(e.message || '')) throw conflict(`Ya existe ${what} con ese código.`, 'DUPLICATE'); throw e; };

  const clients = {
    async list(ctx, q = {}) { return store.read(async (r) => (await r.clients.list(ctx.companyId, scopeCenterIds(ctx), { search: q.search, status: q.status })).map(clientDto)); },
    async get(ctx, id) { return store.read(async (r) => { const c = await r.clients.get(ctx.companyId, scopeCenterIds(ctx), id); if (!c) throw notFound('Cliente no encontrado.'); return clientDto(c); }); },
    async create(ctx, b) {
      const f = fields(b, false); const centerId = b.centerId || ctx.centerId;
      if (!centerId) throw unprocessable('Selecciona un centro para el cliente.', 'CENTER_REQUIRED');
      if (!scopeCenterIds(ctx).includes(centerId)) throw notFound('Centro no encontrado.');
      return store.tx(async (r) => {
        const zoneId = await checkZone(r, ctx, b.zoneId, centerId);
        try {
          const c = await r.clients.create({ id: uuid(), companyId: ctx.companyId, centerId, zoneId, ...f, lat: f.lat ?? null, lng: f.lng ?? null });
          await audit(r, ctx, 'client.created', { entity: 'client', entityId: c.id, detail: { name: c.name }, centerId });
          return clientDto(c);
        } catch (e) { return dupe(e, 'un cliente'); }
      });
    },
    async update(ctx, id, b) {
      const f = fields(b, true);
      return store.tx(async (r) => {
        const c = await r.clients.get(ctx.companyId, scopeCenterIds(ctx), id); if (!c) throw notFound('Cliente no encontrado.');
        let centerId = c.center_id;
        if (b.centerId && b.centerId !== c.center_id) { if (!scopeCenterIds(ctx).includes(b.centerId)) throw notFound('Centro no encontrado.'); centerId = b.centerId; }
        const zone = b.zoneId === undefined ? (centerId === c.center_id ? undefined : null) : await checkZone(r, ctx, b.zoneId, centerId);
        try { await r.clients.update(ctx.companyId, id, { ...f, center_id: centerId, zone_id: zone }); } catch (e) { dupe(e, 'un cliente'); }
        await audit(r, ctx, 'client.updated', { entity: 'client', entityId: id, detail: { fields: Object.keys(f) }, centerId });
        return clientDto(await r.clients.get(ctx.companyId, scopeCenterIds(ctx), id));
      });
    },
  };

  const products = {
    async list(ctx, q = {}) { return store.read(async (r) => (await r.products.list(ctx.companyId, { search: q.search, status: q.status })).map(productDto)); },
    async create(ctx, b) {
      const sku = str(b.sku, 'El SKU', { required: true, max: 60 }); const name = str(b.name, 'El nombre', { required: true, max: 160 });
      return store.tx(async (r) => {
        try {
          const p = await r.products.create({ id: uuid(), companyId: ctx.companyId, sku, name, category: str(b.category, 'La categoría', { max: 80 }), unit: str(b.unit, 'La unidad', { max: 20 }) || 'pieza' });
          await audit(r, ctx, 'product.created', { entity: 'product', entityId: p.id, detail: { sku } });
          return productDto(p);
        } catch (e) { if (/UNIQUE/i.test(e.message)) throw conflict('Ya existe un producto con ese SKU.', 'DUPLICATE'); throw e; }
      });
    },
    async update(ctx, id, b) {
      const patch = {};
      if (b.sku !== undefined) patch.sku = str(b.sku, 'El SKU', { required: true, max: 60 });
      if (b.name !== undefined) patch.name = str(b.name, 'El nombre', { required: true, max: 160 });
      if (b.category !== undefined) patch.category = str(b.category, 'La categoría', { max: 80 });
      if (b.unit !== undefined) patch.unit = str(b.unit, 'La unidad', { required: true, max: 20 });
      if (b.status !== undefined) { if (!STATUS.includes(b.status)) throw unprocessable('Estado no válido.', 'STATUS_INVALID'); patch.status = b.status; }
      return store.tx(async (r) => {
        if (!(await r.products.get(ctx.companyId, id))) throw notFound('Producto no encontrado.');
        try { await r.products.update(ctx.companyId, id, patch); } catch (e) { if (/UNIQUE/i.test(e.message)) throw conflict('Ya existe un producto con ese SKU.', 'DUPLICATE'); throw e; }
        await audit(r, ctx, 'product.updated', { entity: 'product', entityId: id, detail: { fields: Object.keys(patch) } });
        return productDto(await r.products.get(ctx.companyId, id));
      });
    },
  };
  return { clients, products };
}
module.exports = { createCatalogService };
