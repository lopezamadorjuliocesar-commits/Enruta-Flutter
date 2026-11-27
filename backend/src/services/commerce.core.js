'use strict';
// Reglas comerciales compartidas por varios servicios (precio efectivo, stock y carga de ruta). Todas operan DENTRO de una transacción abierta (`r`).
const { HttpError, unprocessable, conflict } = require('../utils/errors');

const MODULE = { PREVENTA: 'Preventa', AUTOVENTA: 'Autoventa', COMODATO: 'Activos en comodato', EXHIBICION: 'Auditoría de exhibición' };
const moduleOn = (payload, name) => !!payload?.modules?.find((m) => m.name === name && m.enabled);
const requireModule = (payload, name) => { if (!moduleOn(payload, name)) throw new HttpError(409, 'MODULE_DISABLED', `El módulo «${name}» no está activo en la configuración publicada.`); };

/** Fecha local (AAAA-MM-DD) en la zona horaria de la empresa: las vigencias son por día, inclusivas. */
const dayOf = (ms, tz = 'America/Mexico_City') => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const inRange = (from, to, day) => (!from || from <= day) && (!to || day <= to);

/**
 * Precio efectivo (DT-46): lista asignada al cliente (vigente, mayor prioridad) → lista predeterminada vigente → precio base del producto.
 * Después se aplica la MEJOR promoción vigente; el descuento manual se aplica aparte, sobre este precio.
 */
async function unitPrice(r, { companyId, clientId, productId, nowMs, tz }) {
  const day = dayOf(nowMs, tz); const product = await r.products.get(companyId, productId);
  if (!product || product.status !== 'ACTIVE') throw unprocessable('Uno de los productos no existe o está inactivo.', 'PRODUCT_INVALID');
  const pick = async (lists) => { for (const l of lists.filter((x) => inRange(x.valid_from, x.valid_to, day)).sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))) { const c = await r.priceLists.priceOf(l.id, productId); if (c !== null) return { cents: c, source: `LIST:${l.name}`, listId: l.id }; } return null; };
  let base = clientId ? await pick(await r.priceLists.assignedTo(companyId, clientId)) : null;
  base ||= await pick(await r.priceLists.defaults(companyId));
  if (!base && product.price_cents !== null && product.price_cents !== undefined) base = { cents: product.price_cents, source: 'BASE', listId: null };
  if (!base) throw new HttpError(422, 'PRODUCT_NO_PRICE', `El producto ${product.name} no tiene precio.`);
  let best = null;
  for (const p of await r.promotions.activeFor(companyId, productId)) {
    if (!inRange(p.valid_from, p.valid_to, day)) continue;
    const off = p.kind === 'PERCENT' ? Math.round((base.cents * p.value) / 10000) : Math.min(p.value, base.cents);
    if (!best || off > best.off) best = { off, id: p.id, name: p.name };
  }
  const promo = best?.off ?? 0;
  return { product, listPriceCents: base.cents, promoCents: promo, unitCents: base.cents - promo, source: base.source, listId: base.listId, promotion: best ? { id: best.id, name: best.name } : null };
}

/** Mueve stock de un centro; nunca deja el saldo negativo (409). Devuelve la alerta de mínimo si se cruzó. */
async function applyStock(r, { companyId, centerId, productId, delta, reason, routeId = null, note = null, userId = null, at }) {
  const row = await r.stock.get(centerId, productId); const before = row?.qty ?? 0; const after = before + delta;
  if (after < 0) { const p = await r.products.get(companyId, productId); throw new HttpError(409, 'INSUFFICIENT_STOCK', `Stock insuficiente de ${p?.name ?? 'producto'}: hay ${before} y se piden ${-delta}.`, { available: before, productId }); }
  await r.stock.upsert(companyId, centerId, productId, after, row?.min_qty ?? 0);
  const id = await r.stock.move({ companyId, centerId, productId, delta, balanceAfter: after, reason, routeId, note, createdBy: userId, createdAt: at });
  const min = row?.min_qty ?? 0;
  return { before, after, movementId: id, alert: min > 0 && after <= min && before > min ? { centerId, productId, qty: after, minQty: min, movementId: id } : null };
}

/**
 * Consume la carga del camión. `prior` y `next` son Map(productId → cantidad entregada) del MISMO reparto (se reemplaza al guardar de nuevo).
 * Con control de carga (la ruta tiene carga registrada, o es autoventa) lo entregado no puede exceder lo disponible.
 */
async function consumeLoad(r, route, { prior, next, sale }) {
  const controlled = sale || (await r.loads.count(route.id)) > 0; if (!controlled) return;
  for (const productId of new Set([...prior.keys(), ...next.keys()])) {
    const delta = (next.get(productId) ?? 0) - (prior.get(productId) ?? 0); if (delta === 0) continue;
    const row = await r.loads.get(route.id, productId); const remaining = row ? row.qty_loaded - row.qty_sold - row.qty_returned : 0;
    if (delta > remaining) { const p = await r.products.get(route.company_id, productId); throw new HttpError(409, 'INSUFFICIENT_STOCK', `La carga del camión no alcanza para ${p?.name ?? 'el producto'}: quedan ${remaining} y se necesitan ${delta}.`, { available: remaining, productId }); }
    if (row) await r.loads.setSold(route.id, productId, row.qty_sold + delta);
  }
}

/** Al finalizar la ruta lo no vendido regresa al centro. Devuelve las alertas generadas (por si suben sobre el mínimo no hay; solo bajan). */
async function returnLoad(r, route, { userId, at }) {
  for (const l of await r.loads.list(route.id)) {
    const left = l.qty_loaded - l.qty_sold - l.qty_returned; if (left <= 0) continue;
    await applyStock(r, { companyId: route.company_id, centerId: route.center_id, productId: l.product_id, delta: left, reason: 'ROUTE_RETURN', routeId: route.id, userId, at });
    await r.loads.setReturned(route.id, l.product_id, l.qty_returned + left);
  }
}

module.exports = { MODULE, moduleOn, requireModule, dayOf, inRange, unitPrice, applyStock, consumeLoad, returnLoad, conflict };
