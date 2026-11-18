'use strict';
// Listas de precios con vigencia, promociones y descuentos con nombre (DT-46). Los precios efectivos los calcula `commerce.core.unitPrice`.
const { uuid } = require('../utils/ids');
const { conflict, notFound, unprocessable } = require('../utils/errors');
const { str, num } = require('../utils/validate');
const { makeAudit } = require('./context');
const core = require('./commerce.core');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v, label) => { if (v === undefined || v === null || v === '') return null; const s = String(v); if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s))) throw unprocessable(`${label} debe ser una fecha AAAA-MM-DD.`, 'DATE_INVALID'); return s; };
const range = (from, to) => { if (from && to && from > to) throw unprocessable('La vigencia final no puede ser anterior a la inicial.', 'RANGE_INVALID'); };
const cents = (v, label) => { const n = num(v, label, { min: 0, max: 100_000_000, required: true }); return Math.round(n * 100); };
const status = (v, cur = 'ACTIVE') => (v === undefined ? cur : ['ACTIVE', 'INACTIVE'].includes(v) ? v : (() => { throw unprocessable('Estado no válido.', 'STATUS_INVALID'); })());

function createPricingService({ store, clock }) {
  const audit = makeAudit(clock);
  const listDto = (l, c = {}) => ({ id: l.id, name: l.name, description: l.description, isDefault: !!l.is_default, priority: l.priority, validFrom: l.valid_from, validTo: l.valid_to, status: l.status, items: c.items ?? 0, clients: c.clients ?? 0 });
  const promoDto = (p, names) => ({ id: p.id, name: p.name, productId: p.product_id, productName: p.product_id ? names.get(p.product_id) ?? null : null, kind: p.kind, value: p.kind === 'PERCENT' ? p.value / 100 : p.value / 100, valueLabel: p.kind === 'PERCENT' ? `${p.value / 100} %` : `$${(p.value / 100).toFixed(2)} por unidad`, validFrom: p.valid_from, validTo: p.valid_to, status: p.status });
  const ruleDto = (d) => ({ id: d.id, name: d.name, percent: d.percent_bp / 100, percentBp: d.percent_bp, description: d.description, status: d.status });

  async function validItems(r, ctx, items) {
    if (!Array.isArray(items)) throw unprocessable('Los precios deben ser una lista.', 'ITEMS_INVALID'); const seen = new Set(); const out = [];
    for (const it of items) {
      const p = await r.products.get(ctx.companyId, String(it.productId ?? '')); if (!p) throw unprocessable('Uno de los productos no existe.', 'PRODUCT_INVALID');
      if (seen.has(p.id)) throw unprocessable(`El producto ${p.name} está repetido en la lista.`, 'LINE_DUPLICATE'); seen.add(p.id); out.push({ productId: p.id, priceCents: cents(it.price, `El precio de ${p.name}`) });
    }
    return out;
  }
  async function validClients(r, ctx, ids) {
    if (!Array.isArray(ids)) throw unprocessable('Los clientes deben ser una lista.', 'CLIENTS_INVALID'); const out = [...new Set(ids.map(String))];
    for (const id of out) if (!(await r.clients.get(ctx.companyId, ctx.accessibleCenterIds, id))) throw unprocessable('Uno de los clientes no existe en tus centros.', 'CLIENT_INVALID'); return out;
  }
  async function detail(r, ctx, id) {
    const l = await r.priceLists.get(ctx.companyId, id); if (!l) throw notFound('Lista de precios no encontrada.');
    const items = await r.priceLists.items(id); const clients = await r.priceLists.clients(id);
    return { ...listDto(l, { items: items.length, clients: clients.length }), prices: items.map((i) => ({ productId: i.product_id, productName: i.product_name, sku: i.sku, price: i.price_cents / 100 })), clientList: clients };
  }

  return {
    // ---- listas ----
    async lists(ctx) { return store.read(async (r) => { const counts = new Map((await r.priceLists.counts(ctx.companyId)).map((c) => [c.id, c])); return (await r.priceLists.list(ctx.companyId)).map((l) => listDto(l, counts.get(l.id))); }); },
    async list(ctx, id) { return store.read((r) => detail(r, ctx, id)); },
    async saveList(ctx, id, b = {}) {
      return store.tx(async (r) => {
        const cur = id ? await r.priceLists.get(ctx.companyId, id) : null; if (id && !cur) throw notFound('Lista de precios no encontrada.');
        const name = b.name !== undefined || !cur ? str(b.name, 'El nombre', { required: true, max: 80 }) : cur.name;
        const from = b.validFrom !== undefined ? date(b.validFrom, 'La vigencia inicial') : cur?.valid_from ?? null; const to = b.validTo !== undefined ? date(b.validTo, 'La vigencia final') : cur?.valid_to ?? null; range(from, to);
        const priority = b.priority !== undefined ? num(b.priority, 'La prioridad', { min: 0, max: 1000 }) ?? 0 : cur?.priority ?? 0;
        if (!Number.isInteger(priority)) throw unprocessable('La prioridad debe ser un entero.', 'PRIORITY_INVALID');
        const row = { name, description: b.description !== undefined ? str(b.description, 'La descripción', { max: 200 }) : cur?.description ?? null, is_default: b.isDefault !== undefined ? (b.isDefault ? 1 : 0) : cur?.is_default ?? 0, priority, valid_from: from, valid_to: to, status: status(b.status, cur?.status) };
        const dup = (await r.priceLists.list(ctx.companyId)).find((x) => x.name.toLowerCase() === name.toLowerCase() && x.id !== id); if (dup) throw conflict('Ya existe una lista con ese nombre.', 'LIST_NAME_TAKEN');
        const lid = id ?? uuid();
        if (cur) await r.priceLists.update(ctx.companyId, lid, row); else await r.priceLists.create({ id: lid, company_id: ctx.companyId, ...row });
        if (row.is_default) await r.priceLists.clearDefault(ctx.companyId, lid);
        if (b.prices !== undefined) await r.priceLists.setItems(lid, await validItems(r, ctx, b.prices));
        if (b.clientIds !== undefined) await r.priceLists.setClients(lid, await validClients(r, ctx, b.clientIds));
        await audit(r, ctx, cur ? 'price_list.updated' : 'price_list.created', { entity: 'price_list', entityId: lid, detail: { name, default: !!row.is_default, validFrom: from, validTo: to, status: row.status } });
        return detail(r, ctx, lid);
      });
    },
    async deleteList(ctx, id) { return store.tx(async (r) => { const l = await r.priceLists.get(ctx.companyId, id); if (!l) throw notFound('Lista de precios no encontrada.'); await r.priceLists.delete(ctx.companyId, id); await audit(r, ctx, 'price_list.deleted', { entity: 'price_list', entityId: id, detail: { name: l.name } }); return { ok: true }; }); },

    // ---- promociones ----
    async promotions(ctx) { return store.read(async (r) => { const names = new Map((await r.products.list(ctx.companyId)).map((p) => [p.id, p.name])); return (await r.promotions.list(ctx.companyId)).map((p) => promoDto(p, names)); }); },
    async savePromotion(ctx, id, b = {}) {
      return store.tx(async (r) => {
        const cur = id ? await r.promotions.get(ctx.companyId, id) : null; if (id && !cur) throw notFound('Promoción no encontrada.');
        const kind = b.kind ?? cur?.kind; if (!['PERCENT', 'AMOUNT'].includes(kind)) throw unprocessable('El tipo de promoción debe ser porcentaje o monto.', 'KIND_INVALID');
        let value = cur?.value; if (b.value !== undefined || !cur) { const n = num(b.value, 'El valor', { min: 0.01, max: kind === 'PERCENT' ? 100 : 1_000_000, required: true }); value = Math.round(n * 100); }
        const productId = b.productId !== undefined ? (b.productId ? String(b.productId) : null) : cur?.product_id ?? null; if (productId && !(await r.products.get(ctx.companyId, productId))) throw unprocessable('El producto no existe.', 'PRODUCT_INVALID');
        const from = b.validFrom !== undefined ? date(b.validFrom, 'La vigencia inicial') : cur?.valid_from ?? null; const to = b.validTo !== undefined ? date(b.validTo, 'La vigencia final') : cur?.valid_to ?? null; range(from, to);
        const row = { name: b.name !== undefined || !cur ? str(b.name, 'El nombre', { required: true, max: 80 }) : cur.name, product_id: productId, kind, value, valid_from: from, valid_to: to, status: status(b.status, cur?.status) };
        const pid = id ?? uuid(); if (cur) await r.promotions.update(ctx.companyId, pid, row); else await r.promotions.create({ id: pid, company_id: ctx.companyId, ...row });
        await audit(r, ctx, cur ? 'promotion.updated' : 'promotion.created', { entity: 'promotion', entityId: pid, detail: { name: row.name, kind, value, status: row.status } });
        const names = new Map((await r.products.list(ctx.companyId)).map((p) => [p.id, p.name])); return promoDto(await r.promotions.get(ctx.companyId, pid), names);
      });
    },
    async deletePromotion(ctx, id) { return store.tx(async (r) => { const p = await r.promotions.get(ctx.companyId, id); if (!p) throw notFound('Promoción no encontrada.'); await r.promotions.delete(ctx.companyId, id); await audit(r, ctx, 'promotion.deleted', { entity: 'promotion', entityId: id, detail: { name: p.name } }); return { ok: true }; }); },

    // ---- descuentos con nombre (el tope por rol/permiso se aplica al entregar) ----
    async discounts(ctx) { return store.read(async (r) => (await r.discountRules.list(ctx.companyId)).map(ruleDto)); },
    async saveDiscount(ctx, id, b = {}) {
      return store.tx(async (r) => {
        const cur = id ? await r.discountRules.get(ctx.companyId, id) : null; if (id && !cur) throw notFound('Descuento no encontrado.');
        const pct = b.percent !== undefined || !cur ? num(b.percent, 'El porcentaje', { min: 0.01, max: 100, required: true }) : cur.percent_bp / 100;
        const row = { name: b.name !== undefined || !cur ? str(b.name, 'El nombre', { required: true, max: 80 }) : cur.name, percent_bp: Math.round(pct * 100), description: b.description !== undefined ? str(b.description, 'La descripción', { max: 200 }) : cur?.description ?? null, status: status(b.status, cur?.status) };
        const dup = (await r.discountRules.list(ctx.companyId)).find((x) => x.name.toLowerCase() === row.name.toLowerCase() && x.id !== id); if (dup) throw conflict('Ya existe un descuento con ese nombre.', 'DISCOUNT_NAME_TAKEN');
        const did = id ?? uuid(); if (cur) await r.discountRules.update(ctx.companyId, did, row); else await r.discountRules.create({ id: did, company_id: ctx.companyId, ...row });
        await audit(r, ctx, cur ? 'discount_rule.updated' : 'discount_rule.created', { entity: 'discount_rule', entityId: did, detail: { name: row.name, percentBp: row.percent_bp, status: row.status } });
        return ruleDto(await r.discountRules.get(ctx.companyId, did));
      });
    },
    async deleteDiscount(ctx, id) { return store.tx(async (r) => { const d = await r.discountRules.get(ctx.companyId, id); if (!d) throw notFound('Descuento no encontrado.'); await r.discountRules.delete(ctx.companyId, id); await audit(r, ctx, 'discount_rule.deleted', { entity: 'discount_rule', entityId: id, detail: { name: d.name } }); return { ok: true }; }); },

    /** Cotización: precio efectivo por producto para un cliente (lista → promoción) y el descuento manual máximo del rol. */
    async quote(ctx, { clientId, items }) {
      const lines = String(items ?? '').split(',').filter(Boolean).map((x) => { const [productId, qty] = x.split(':'); return { productId, qty: Number(qty ?? 1) }; });
      if (!lines.length || lines.length > 100 || lines.some((l) => !Number.isInteger(l.qty) || l.qty <= 0)) throw unprocessable('Indica items=productoId:cantidad,… (cantidades enteras > 0).', 'ITEMS_INVALID');
      return store.read(async (r) => {
        if (clientId && !(await r.clients.get(ctx.companyId, ctx.accessibleCenterIds, clientId))) throw notFound('Cliente no encontrado.');
        const out = []; let total = 0;
        for (const l of lines) { const p = await core.unitPrice(r, { companyId: ctx.companyId, clientId: clientId || null, productId: l.productId, nowMs: clock(), tz: ctx.company?.timezone }); const sub = p.unitCents * l.qty; total += sub;
          out.push({ productId: l.productId, product: p.product.name, qty: l.qty, listPriceCents: p.listPriceCents, promoCents: p.promoCents, unitPriceCents: p.unitCents, subtotalCents: sub, source: p.source, promotion: p.promotion }); }
        return { lines: out, totalCents: total, maxDiscountBp: ctx.maxDiscountBp };
      });
    },
  };
}
module.exports = { createPricingService };
