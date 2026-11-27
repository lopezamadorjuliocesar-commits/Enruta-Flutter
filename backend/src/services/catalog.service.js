'use strict';
// Clientes (alcance por EMPRESA + CENTRO) y productos (alcance por EMPRESA). Base mínima de la Fase 1.
const { uuid, iso } = require('../utils/ids');
const { conflict, notFound, unprocessable } = require('../utils/errors');
const { str, num } = require('../utils/validate');
const { scopeCenterIds, makeAudit } = require('./context');

const clientDto = (c) => ({ id: c.id, centerId: c.center_id, zoneId: c.zone_id, code: c.code, name: c.name, rfc: c.rfc, address: c.address, lat: c.lat, lng: c.lng, phone: c.phone, status: c.status, createdAt: c.created_at, updatedAt: c.updated_at });
const productDto = (p) => ({ id: p.id, sku: p.sku, name: p.name, category: p.category, unit: p.unit, description: p.description, price: p.price_cents === null || p.price_cents === undefined ? null : p.price_cents / 100, status: p.status, createdAt: p.created_at, updatedAt: p.updated_at });
const STATUS = ['ACTIVE', 'INACTIVE'];
const cents = (v) => { const n = num(v, 'El precio', { min: 0, max: 1e9 }); return n === null ? null : Math.round(n * 100); };

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
      const sku = str(b.sku, 'El SKU', { max: 60 }) || `P-${uuid().slice(0, 8).toUpperCase()}`; const name = str(b.name, 'El nombre', { required: true, max: 160 });
      const priceCents = cents(b.price);
      return store.tx(async (r) => {
        try {
          const p = await r.products.create({ id: uuid(), companyId: ctx.companyId, sku, name, category: str(b.category, 'La categoría', { max: 80 }), unit: str(b.unit, 'La unidad', { max: 20 }) || 'pieza', description: str(b.description, 'La descripción', { max: 300 }), priceCents });
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
      if (b.description !== undefined) patch.description = str(b.description, 'La descripción', { max: 300 });
      if (b.price !== undefined) patch.price_cents = cents(b.price);
      if (b.status !== undefined) { if (!STATUS.includes(b.status)) throw unprocessable('Estado no válido.', 'STATUS_INVALID'); patch.status = b.status; }
      return store.tx(async (r) => {
        if (!(await r.products.get(ctx.companyId, id))) throw notFound('Producto no encontrado.');
        try { await r.products.update(ctx.companyId, id, patch); } catch (e) { if (/UNIQUE/i.test(e.message)) throw conflict('Ya existe un producto con ese SKU.', 'DUPLICATE'); throw e; }
        await audit(r, ctx, 'product.updated', { entity: 'product', entityId: id, detail: { fields: Object.keys(patch) } });
        return productDto(await r.products.get(ctx.companyId, id));
      });
    },
  };
  clients.remove = async (ctx, id) => store.tx(async (r) => {
    const c = await r.clients.get(ctx.companyId, scopeCenterIds(ctx), id); if (!c) throw notFound('Cliente no encontrado.');
    try { await r.clients.delete(ctx.companyId, id); } catch (e) { if (/FOREIGN KEY/i.test(e.message)) throw conflict('El cliente está en una o más rutas. Quítalo de ellas antes de eliminarlo.', 'CLIENT_IN_ROUTE'); throw e; }
    await audit(r, ctx, 'client.deleted', { entity: 'client', entityId: id, detail: { name: c.name }, centerId: c.center_id }); return { id };
  });
  products.remove = async (ctx, id) => store.tx(async (r) => {
    const p = await r.products.get(ctx.companyId, id); if (!p) throw notFound('Producto no encontrado.');
    await r.products.delete(ctx.companyId, id); await audit(r, ctx, 'product.deleted', { entity: 'product', entityId: id, detail: { sku: p.sku } }); return { id };
  });

  /** Importación por lotes (el archivo se interpreta en el navegador; aquí se valida de nuevo y se aplica en una transacción). */
  const importer = {
    async clients(ctx, b) {
      const mode = b.mode === 'actualizar' ? 'actualizar' : 'omitir'; const records = Array.isArray(b.records) ? b.records.slice(0, 5000) : [];
      const centerId = b.centerId || ctx.centerId; if (!centerId) throw unprocessable('Selecciona un centro para importar.', 'CENTER_REQUIRED');
      if (!scopeCenterIds(ctx).includes(centerId)) throw notFound('Centro no encontrado.');
      return store.tx(async (r) => {
        const out = { created: 0, updated: 0, skipped: 0, invalid: [] };
        for (const [i, rec] of records.entries()) {
          try {
            const f = fields({ name: rec.name, code: rec.code, rfc: rec.rfc, address: rec.address ?? rec.detail, phone: rec.phone, lat: rec.lat, lng: rec.lng }, false);
            const existing = await r.clients.findForImport(ctx.companyId, centerId, f.code, f.name);
            if (existing) {
              if (mode !== 'actualizar' || !scopeCenterIds(ctx).includes(existing.center_id)) { out.skipped += 1; continue; }
              const upd = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null && v !== undefined)); await r.clients.update(ctx.companyId, existing.id, upd); out.updated += 1;
            } else { await r.clients.create({ id: uuid(), companyId: ctx.companyId, centerId, ...f, lat: f.lat ?? null, lng: f.lng ?? null }); out.created += 1; }
          } catch (e) { if (e.status) out.invalid.push({ row: i + 1, message: e.message }); else if (/UNIQUE/i.test(e.message)) out.invalid.push({ row: i + 1, message: 'Código duplicado.' }); else throw e; }
        }
        await audit(r, ctx, 'import.clients', { detail: { created: out.created, updated: out.updated, skipped: out.skipped, invalid: out.invalid.length }, centerId });
        return out;
      });
    },
    async products(ctx, b) {
      const mode = b.mode === 'actualizar' ? 'actualizar' : 'omitir'; const records = Array.isArray(b.records) ? b.records.slice(0, 5000) : [];
      return store.tx(async (r) => {
        const out = { created: 0, updated: 0, skipped: 0, invalid: [] };
        for (const [i, rec] of records.entries()) {
          try {
            const name = str(rec.name, 'El nombre', { required: true, max: 160 }); const sku = str(rec.sku ?? rec.code, 'El SKU', { max: 60 });
            const patch = { name, category: str(rec.category, 'La categoría', { max: 80 }), description: str(rec.description ?? rec.detail, 'La descripción', { max: 300 }), price_cents: cents(rec.price) };
            const existing = await r.products.findBySkuOrName(ctx.companyId, sku, name);
            if (existing) { if (mode !== 'actualizar') { out.skipped += 1; continue; } await r.products.update(ctx.companyId, existing.id, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null))); out.updated += 1; }
            else { await r.products.create({ id: uuid(), companyId: ctx.companyId, sku: sku || `P-${uuid().slice(0, 8).toUpperCase()}`, name, category: patch.category, description: patch.description, priceCents: patch.price_cents }); out.created += 1; }
          } catch (e) { if (e.status) out.invalid.push({ row: i + 1, message: e.message }); else if (/UNIQUE/i.test(e.message)) out.invalid.push({ row: i + 1, message: 'SKU duplicado.' }); else throw e; }
        }
        await audit(r, ctx, 'import.products', { detail: { created: out.created, updated: out.updated, skipped: out.skipped, invalid: out.invalid.length } });
        return out;
      });
    },
  };
  return { clients, products, importer };
}
module.exports = { createCatalogService };
