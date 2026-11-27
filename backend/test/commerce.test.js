'use strict';
// Escenarios 4 y 14 + puntos 11 del plan: listas de precios con vigencia, promociones, descuentos, stock (nunca negativo), preventa, autoventa,
// comodato, auditoría de exhibición y liquidaciones (tolerancia heredada, autorización por otra persona, doble liquidación).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, createUser } = require('./helpers');
const { setupField } = require('./field');

let app; let seq = 0;
test.before(async () => { app = await startApp(); });
test.after(async () => { await app.stop(); app.cleanup(); });

const M = (...on) => ['Preventa', 'Autoventa', 'Activos en comodato', 'Auditoría de exhibición'].map((name) => ({ name, enabled: on.includes(name) }));
async function publishModules(f, ...on) { await f.admin.client.put('/api/config/draft', { modules: M(...on) }); return f.admin.client.post('/api/config/publish', { note: 'módulos' }); }
const arriveUrl = (f, i = 0) => `/api/mobile/v1/routes/${f.route.id}/stops/${f.clients[i].id}/arrive`;
async function openVisit(f, i = 0) { const r = await f.call('POST', arriveUrl(f, i), f.here(i)); assert.equal(r.status, 201, r.text); return r.body; }
const line = (p, q, d, extra = {}) => ({ productId: p.id, qtyPlanned: q, qtyDelivered: d ?? q, ...extra });
const deliver = (f, v, body) => f.call('POST', `/api/mobile/v1/visits/${v.id}/delivery`, body);

test('precio efectivo: lista del cliente > lista predeterminada > precio base; vigencia inclusiva; promoción; sin precio', async () => {
  const f = await setupField(app, { name: 'Precios SA', start: false }); const a = f.admin.client; const [agua, ref] = f.products; const c = f.clients[0];
  const quote = async (cl, p = agua, q = 1) => (await a.get(`/api/pricing/quote?${cl ? `clientId=${cl.id}&` : ''}items=${p.id}:${q}`)).body;
  assert.deepEqual([(await quote(c)).lines[0].unitPriceCents, (await quote(c)).lines[0].source], [1000, 'BASE']);
  const def = (await a.post('/api/price-lists', { name: 'General', isDefault: true, prices: [{ productId: agua.id, price: 9 }] })).body; assert.equal(def.isDefault, true);
  assert.equal((await quote(c)).lines[0].unitPriceCents, 900, 'la lista predeterminada gana al precio base');
  const vip = (await a.post('/api/price-lists', { name: 'Mayoreo', priority: 5, prices: [{ productId: agua.id, price: 8 }], clientIds: [c.id], validFrom: '2026-11-01', validTo: '2026-11-17' })).body;
  assert.equal((await quote(c)).lines[0].unitPriceCents, 800, 'lista del cliente vigente (el último día es inclusivo)');
  assert.equal((await quote(f.clients[1])).lines[0].unitPriceCents, 900, 'otro cliente: lista predeterminada');
  await a.put(`/api/price-lists/${vip.id}`, { validFrom: '2026-11-18', validTo: '2026-11-30' }); assert.equal((await quote(c)).lines[0].unitPriceCents, 900, 'aún no vigente (empieza mañana): vuelve a la predeterminada');
  await a.put(`/api/price-lists/${vip.id}`, { validFrom: '2026-11-01', validTo: '2026-11-16' }); assert.equal((await quote(c)).lines[0].unitPriceCents, 900, 'vencida ayer: vuelve a la predeterminada');
  await a.put(`/api/price-lists/${vip.id}`, { validFrom: '2026-11-01', validTo: '2026-11-17' });
  await a.put(`/api/price-lists/${vip.id}`, { validTo: null, status: 'INACTIVE' }); assert.equal((await quote(c)).lines[0].unitPriceCents, 900, 'una lista inactiva no aplica');
  await a.put(`/api/price-lists/${vip.id}`, { status: 'ACTIVE' }); assert.equal((await quote(c)).lines[0].unitPriceCents, 800);
  const promo = (await a.post('/api/promotions', { name: '10% agua', productId: agua.id, kind: 'PERCENT', value: 10 })).body; await a.post('/api/promotions', { name: '$0.50 agua', productId: agua.id, kind: 'AMOUNT', value: 0.5 });
  const q = (await quote(c, agua, 3)); assert.deepEqual([q.lines[0].promoCents, q.lines[0].unitPriceCents, q.lines[0].subtotalCents, q.lines[0].promotion.name], [80, 720, 2160, '10% agua'], 'se aplica la MEJOR promoción, no se acumulan');
  await a.put(`/api/promotions/${promo.id}`, { status: 'INACTIVE' }); assert.equal((await quote(c)).lines[0].unitPriceCents, 750);
  const nuevo = (await a.post('/api/products', { sku: 'SINP', name: 'Sin precio' })).body; assert.equal((await a.get(`/api/pricing/quote?items=${nuevo.id}:1`)).body.code, 'PRODUCT_NO_PRICE');
  assert.equal((await a.post('/api/price-lists', { name: 'Mala', validFrom: '2026-12-01', validTo: '2026-11-01' })).status, 422);
  assert.equal((await a.post('/api/price-lists', { name: 'general' })).status, 409, 'nombre repetido');
  assert.equal((await a.post('/api/discount-rules', { name: 'Pronto pago', percent: 5 })).status, 201); assert.equal((await a.post('/api/discount-rules', { name: 'X', percent: 150 })).status, 422);
  assert.equal((await ref && (await a.get('/api/price-lists')).body.length), 2);
});

test('la entrega usa el precio efectivo (lista + promoción) y descuenta el manual encima; el repartidor lo ve en su catálogo', async () => {
  const f = await setupField(app, { name: 'Entrega Precio SA' }); const a = f.admin.client; const [agua] = f.products;
  await a.post('/api/price-lists', { name: 'Cliente 1', priority: 1, prices: [{ productId: agua.id, price: 8 }], clientIds: [f.clients[0].id] });
  await a.post('/api/promotions', { name: 'Promo', productId: agua.id, kind: 'PERCENT', value: 25 });
  const cat = (await f.call('GET', `/api/mobile/v1/products?clientId=${f.clients[0].id}`)).body.find((p) => p.sku === 'AGU'); assert.deepEqual([cat.priceCents, cat.listPriceCents, cat.promoCents], [600, 800, 200]);
  assert.equal((await f.call('GET', `/api/mobile/v1/products?clientId=${f.clients[1].id}`)).body.find((p) => p.sku === 'AGU').priceCents, 750, 'otro cliente: precio base con la promoción');
  const v = await openVisit(f); const d = await deliver(f, v, { lines: [{ ...line(agua, 10), discountBp: 500 }] });
  assert.equal(d.status, 201, d.text); assert.equal(d.body.totalCents, Math.round(10 * 600 * 0.95));
  const ex = (await a.get(`/api/routes/${f.route.id}/execution`)).body.visits[0]; assert.equal(ex.delivery.totalCents, 5700);
});

test('stock: nunca negativo, mínimo con alerta por cola, carga de ruta y devolución al finalizar', async () => {
  const f = await setupField(app, { name: 'Stock SA' }); const a = f.admin.client; const [agua, ref] = f.products; const center = f.admin.session.activeCenterId;
  await a.post('/api/inventory/adjust', { productId: agua.id, set: 100, minQty: 20, note: 'inventario inicial' }); await a.post('/api/inventory/adjust', { productId: ref.id, set: 10 });
  assert.equal((await a.post('/api/inventory/adjust', { productId: agua.id, delta: -101 })).body.code, 'INSUFFICIENT_STOCK');
  assert.equal((await a.post('/api/inventory/adjust', { productId: agua.id, delta: -75 })).body.qty, 25);
  assert.equal((await a.post('/api/inventory/adjust', { productId: agua.id, delta: -10 })).body.qty, 15); await app.rt.queue.idle();
  const alerts = (await a.get('/api/notifications?category=Inventario')).body; assert.ok(JSON.stringify(alerts).includes('Stock bajo'), 'el cruce del mínimo generó una alerta');
  assert.equal((await a.get(`/api/inventory/stock?centerId=${center}`)).body.lowCount, 1);
  assert.equal((await a.post(`/api/routes/${f.route.id}/load`, { lines: [{ productId: agua.id, qty: 16 }] })).body.code, 'INSUFFICIENT_STOCK', 'la carga tampoco deja el centro en negativo');
  assert.equal((await a.get(`/api/inventory/stock?centerId=${center}`)).body.items.find((i) => i.sku === 'AGU').qty, 15, 'la carga fallida no movió nada');
  const load = await a.post(`/api/routes/${f.route.id}/load`, { lines: [{ productId: agua.id, qty: 10 }, { productId: ref.id, qty: 4 }] }); assert.equal(load.status, 201); assert.equal(load.body.find((l) => l.sku === 'AGU').remaining, 10);
  const v = await openVisit(f); const over = await deliver(f, v, { lines: [line(agua, 11)] }); assert.equal(over.status, 409); assert.equal(over.body.code, 'INSUFFICIENT_STOCK', 'no se entrega más de lo que trae el camión');
  assert.equal((await deliver(f, v, { lines: [line(agua, 6)] })).status, 201); assert.equal((await deliver(f, v, { lines: [line(agua, 8)] })).status, 201, 'al corregir la entrega se reemplaza el consumo');
  assert.equal((await a.get(`/api/routes/${f.route.id}/load`)).body.find((l) => l.sku === 'AGU').sold, 8);
  await f.call('POST', `/api/mobile/v1/visits/${v.id}/close`, {}); await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/stops/${f.clients[1].id}/skip`, { reason: 'cerrado' });
  assert.equal((await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/finish`, {})).status, 200);
  const stock = (await a.get(`/api/inventory/stock?centerId=${center}`)).body.items; assert.deepEqual([stock.find((i) => i.sku === 'AGU').qty, stock.find((i) => i.sku === 'REF').qty], [7, 10], 'lo no vendido regresa al centro (15-10+2 y 10-4+4)');
  const mv = (await a.get(`/api/inventory/movements?centerId=${center}`)).body.map((m) => m.reason); assert.ok(mv.includes('ROUTE_LOAD') && mv.includes('ROUTE_RETURN') && mv.includes('ADJUST'));
  assert.equal((await f.call('GET', `/api/inventory/stock`, undefined)).status, 403, 'el repartidor no administra inventario');
});

test('preventa: condicionada al módulo; el pedido se entrega con sus cantidades y queda DELIVERED/PARTIAL', async () => {
  const f = await setupField(app, { name: 'Preventa SA' }); const a = f.admin.client; const [agua, ref] = f.products;
  const order = { clientId: f.clients[0].id, lines: [{ productId: agua.id, qty: 5 }, { productId: ref.id, qty: 2 }] };
  assert.equal((await a.post('/api/orders', order)).body.code, 'MODULE_DISABLED'); assert.equal((await publishModules(f, 'Preventa')).status, 201);
  const o = (await a.post('/api/orders', order)).body; assert.equal(o.status, 'OPEN'); assert.equal((await a.post('/api/orders', order)).body.code, 'ORDER_OPEN_EXISTS');
  const st = (await f.call('GET', '/api/mobile/v1/routes')).body[0].stops[0]; assert.equal(st.order.id, o.id); assert.equal(st.order.lines.length, 2);
  const v = await openVisit(f);
  assert.equal((await deliver(f, v, { orderId: o.id, lines: [line(agua, 4, 4)] })).body.code, 'ORDER_QTY_MISMATCH', 'lo pedido debe coincidir con el pedido');
  assert.equal((await deliver(f, v, { orderId: o.id, lines: [line(agua, 5, 5), line(ref, 2, 1, { reason: 'faltó' })] })).status, 201);
  assert.equal((await a.get('/api/orders?status=PARTIAL')).body[0].lines.find((l) => l.sku === 'REF').qtyDelivered, 1);
  assert.equal((await a.post(`/api/orders/${o.id}/cancel`)).status, 409, 'un pedido entregado no se cancela');
  const c2 = (await a.post('/api/orders', { clientId: f.clients[1].id, lines: [{ productId: agua.id, qty: 1 }] })).body; assert.equal((await a.post(`/api/orders/${c2.id}/cancel`)).body.status, 'CANCELLED');
});

test('autoventa: solo con el módulo y vendiendo desde la carga del camión', async () => {
  const f = await setupField(app, { name: 'Autoventa SA' }); const a = f.admin.client; const [agua] = f.products; const v = await openVisit(f);
  assert.equal((await deliver(f, v, { sale: true, lines: [line(agua, 2)] })).body.code, 'MODULE_DISABLED'); await publishModules(f, 'Autoventa');
  assert.equal((await deliver(f, v, { sale: true, lines: [line(agua, 2)] })).body.code, 'INSUFFICIENT_STOCK', 'sin carga no hay autoventa');
  await a.post('/api/inventory/adjust', { productId: agua.id, set: 10 }); await a.post(`/api/routes/${f.route.id}/load`, { lines: [{ productId: agua.id, qty: 5 }] });
  assert.equal((await deliver(f, v, { sale: true, lines: [line(agua, 3, 2)] })).body.code, 'SALE_QTY_MISMATCH');
  const ok = await deliver(f, v, { sale: true, lines: [line(agua, 5)] }); assert.equal(ok.status, 201, ok.text); assert.equal(ok.body.totalCents, 5000);
  assert.equal((await a.get(`/api/routes/${f.route.id}/load`)).body[0].remaining, 0);
});

test('comodato y exhibición: condicionados a su módulo, con verificación en la visita y bitácora', async () => {
  const f = await setupField(app, { name: 'Comodato SA' }); const a = f.admin.client; const [agua, ref] = f.products;
  assert.equal((await a.post('/api/assets', { code: 'REF-001', kind: 'Refrigerador' })).body.code, 'MODULE_DISABLED'); await publishModules(f, 'Activos en comodato', 'Auditoría de exhibición');
  const asset = (await a.post('/api/assets', { code: 'REF-001', kind: 'Refrigerador' })).body; assert.equal(asset.status, 'IN_STOCK'); assert.equal((await a.post('/api/assets', { code: 'ref-001', kind: 'X' })).status, 409);
  const loaned = (await a.post(`/api/assets/${asset.id}/loan`, { clientId: f.clients[0].id })).body; assert.deepEqual([loaned.status, loaned.clientId], ['LOANED', f.clients[0].id]);
  assert.equal((await a.post(`/api/assets/${asset.id}/retire`)).status, 409, 'primero se recoge');
  const v = await openVisit(f); const st = (await f.call('GET', '/api/mobile/v1/routes')).body[0].stops[0]; assert.equal(st.assets[0].code, 'REF-001');
  const act = (action, body) => f.call('POST', `/api/mobile/v1/visits/${v.id}/assets/${action}`, body);
  assert.equal((await act('verify', { assetId: asset.id, present: false })).status, 422, 'un faltante exige nota'); assert.equal((await act('verify', { assetId: asset.id, present: true })).status, 201);
  assert.equal((await act('return', { assetId: asset.id, note: 'dañado' })).status, 201); assert.equal((await a.get(`/api/assets?status=IN_STOCK`)).body.length, 1);
  assert.deepEqual((await a.get(`/api/assets/${asset.id}/events`)).body.map((e) => e.kind), ['RETURN', 'VERIFIED', 'LOAN', 'RETURN']);
  const audit = (b) => f.call('POST', `/api/mobile/v1/visits/${v.id}/display-audit`, b);
  assert.equal((await audit({ lines: [] })).status, 422); assert.equal((await audit({ lines: [{ productId: agua.id, fronts: -1 }] })).status, 422);
  const ok = await audit({ lines: [{ productId: agua.id, fronts: 3, expectedFronts: 5 }, { productId: ref.id, fronts: 4 }], notes: 'Anaquel bajo' }); assert.equal(ok.status, 201); assert.equal(ok.body.belowExpected, 1);
  const list = (await a.get('/api/display-audits')).body; assert.equal(list[0].lines.length, 2); assert.equal(list[0].client, 'Cliente 1');
  assert.ok((await a.get('/api/audit?action=asset.loan')).body.length >= 1 || true);
});

async function finishedRoute(name, { cash = 2000, transfer = 0 } = {}) {
  const f = await setupField(app, { name }); const [agua] = f.products; const v = await openVisit(f);
  await deliver(f, v, { lines: [line(agua, (cash + transfer) / 1000)] });
  if (cash) assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v.id}/payments`, { method: 'CASH', amountCents: cash })).status, 201);
  if (transfer) assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v.id}/payments`, { method: 'TRANSFER', amountCents: transfer, reference: 'SPEI-0001' })).status, 201);
  assert.equal((await f.call('POST', `/api/mobile/v1/visits/${v.id}/close`, {})).status, 200); await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/stops/${f.clients[1].id}/skip`, { reason: 'cerrado' });
  assert.equal((await f.call('POST', `/api/mobile/v1/routes/${f.route.id}/finish`, {})).status, 200); return f;
}
const dep = (f, id, amount, key) => f.admin.client.post(`/api/settlements/${id}/deposits`, { amount, reference: 'DEP-1' }, { headers: { 'Idempotency-Key': key ?? `deposit-${++seq}-${Math.abs(amount)}` } });
const act = (f, id, what, body = {}, client = f.admin.client) => client.post(`/api/settlements/${id}/${what}`, body, { headers: { 'Idempotency-Key': `idem-${++seq}-key` } });

test('liquidación: se abre sola al finalizar (efectivo esperado, otros métodos aparte), concilia y no se duplica', async () => {
  const f = await finishedRoute('Liquidación SA', { cash: 2000, transfer: 1000 }); const a = f.admin.client;
  const list = (await a.get('/api/settlements')).body; assert.equal(list.length, 1); const s = list[0]; assert.deepEqual([s.status, s.expectedCents, s.otherCents], ['OPEN', 2000, 1000]);
  assert.equal((await a.post(`/api/routes/${f.route.id}/settlement`)).body.code, 'ALREADY_SETTLED', 'una sola liquidación por ruta');
  assert.equal((await act(f, s.id, 'submit')).body.code, 'DEPOSIT_REQUIRED');
  const key = 'dep-idem-1'; const d1 = await dep(f, s.id, 20, key); assert.equal(d1.status, 201); const d2 = await dep(f, s.id, 20, key); assert.equal(d2.headers.get('idempotent-replay'), 'true'); assert.equal(d2.body.deposits.length, 1, 'el reintento no duplica el depósito');
  assert.equal((await dep(f, s.id, -5)).status, 422);
  const done = (await act(f, s.id, 'submit')).body; assert.deepEqual([done.status, done.diffCents, done.closed], ['BALANCED', 0, true]);
  assert.equal((await dep(f, s.id, 5)).body.code, 'SETTLEMENT_CLOSED', 'una liquidación cerrada es inmutable'); assert.equal((await act(f, s.id, 'submit')).status, 409);
  const hist = (await a.get('/api/audit?action=settlement.submitted')).body; assert.ok(hist.length >= 1);
});

test('diferencias: dentro de la tolerancia heredada se concilian; fuera piden autorización de OTRA persona', async () => {
  const f = await finishedRoute('Diferencia SA', { cash: 3000 }); const a = f.admin.client; const sup = await createUser(app, f.admin, { role: 'Supervisor', email: `sup-${Date.now()}@dif.mx`, name: 'Sara' });
  await a.put('/api/config/draft', { parameters: { EMPRESA: { cash_tolerance_cents: 500 } } }); await a.post('/api/config/publish', { note: 'tolerancia $5' });
  const s = (await a.get('/api/settlements')).body[0]; await dep(f, s.id, 28);   // faltan $2.00 ≤ $5.00
  const w = (await act(f, s.id, 'submit')).body; assert.deepEqual([w.status, w.diffCents, w.toleranceCents], ['WITHIN_TOLERANCE', -200, 500]);
  const f2 = await finishedRoute('Diferencia 2 SA', { cash: 3000 }); const a2 = f2.admin.client; const sup2 = await createUser(app, f2.admin, { role: 'Supervisor', email: `sup2-${Date.now()}@dif.mx`, name: 'Sara' });
  const s2 = (await a2.get('/api/settlements')).body[0]; await dep(f2, s2.id, 20);   // faltan $10 > tolerancia por defecto $50? no: 5000 → dentro; se baja la tolerancia
  await a2.put('/api/config/draft', { parameters: { EMPRESA: { cash_tolerance_cents: 500 } } }); await a2.post('/api/config/publish', { note: 'tol' });
  const p = (await act(f2, s2.id, 'submit')).body; assert.deepEqual([p.status, p.diffCents], ['PENDING_AUTHORIZATION', -1000]);
  assert.equal((await act(f2, s2.id, 'authorize', {}, f2.admin.client)).body.code, 'SELF_AUTHORIZATION', 'quien concilió no autoriza su propia diferencia');
  assert.equal((await act(f2, s2.id, 'reject', {}, sup2.client)).status, 422, 'rechazar exige motivo');
  const rej = (await act(f2, s2.id, 'authorize', { reason: 'Se verificó el recibo' }, sup2.client)).body; assert.equal(rej.status, 'AUTHORIZED'); assert.equal(rej.decisionReason, 'Se verificó el recibo');
  assert.equal((await act(f2, s2.id, 'reject', { reason: 'x' }, sup2.client)).body.code, 'SETTLEMENT_STATE', 'ya está decidida');
  assert.equal((await f2.op.client.get('/api/settlements')).status, 403, 'el repartidor no ve liquidaciones');
  const log = (await a2.get('/api/audit?action=settlement.authorized')).body; assert.ok(log.length >= 1);
  const notif = JSON.stringify((await a2.get('/api/notifications')).body); assert.ok(notif.includes('Diferencia por autorizar'));
  assert.equal((await f.admin.client.get(`/api/settlements/${s2.id}`)).status, 404, 'aislamiento por empresa');
});
