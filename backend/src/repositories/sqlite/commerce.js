'use strict';
// Precios, inventario, preventa, comodato, exhibición y liquidaciones (migraciones 009–011).
const { iso } = require('../../utils/ids');
const inList = (col, ids, p, prefix) => `${col} IN (${ids.map((id, i) => { p[`${prefix}${i}`] = id; return `@${prefix}${i}`; }).join(',')})`;

module.exports = function commerceRepos(conn) {
  const get = (sql, ...p) => conn.prepare(sql).get(...p);
  const all = (sql, ...p) => conn.prepare(sql).all(...p);
  const run = (sql, ...p) => conn.prepare(sql).run(...p);
  /** CRUD genérico por empresa: `cols` son las columnas editables. */
  const crud = (table, cols, order = 'name COLLATE NOCASE') => ({
    async list(companyId) { return all(`SELECT * FROM ${table} WHERE company_id=? ORDER BY ${order}`, companyId); },
    async get(companyId, id) { return get(`SELECT * FROM ${table} WHERE company_id=? AND id=?`, companyId, id); },
    async create(row) {
      const t = iso(); const r = { ...Object.fromEntries(cols.map((c) => [c, null])), ...row, t };
      run(`INSERT INTO ${table} (id,company_id,${cols.join(',')},created_at,updated_at) VALUES (@id,@company_id,${cols.map((c) => `@${c}`).join(',')},@t,@t)`, r);
      return get(`SELECT * FROM ${table} WHERE id=?`, row.id);
    },
    async update(companyId, id, data) {
      const keys = Object.keys(data).filter((k) => cols.includes(k)); if (!keys.length) return 0;
      return run(`UPDATE ${table} SET ${keys.map((k) => `${k}=@${k}`).join(',')}, updated_at=@_t WHERE company_id=@_c AND id=@_id`, { ...data, _t: iso(), _c: companyId, _id: id }).changes;
    },
    async delete(companyId, id) { return run(`DELETE FROM ${table} WHERE company_id=? AND id=?`, companyId, id).changes; },
  });

  const priceLists = crud('price_lists', ['name', 'description', 'is_default', 'priority', 'valid_from', 'valid_to', 'status'], 'is_default DESC, name COLLATE NOCASE');
  const clearDefault = (companyId, exceptId) => run('UPDATE price_lists SET is_default=0 WHERE company_id=? AND id<>?', companyId, exceptId);

  return {
    priceLists: {
      ...priceLists, clearDefault,
      async items(listId) { return all('SELECT i.product_id, i.price_cents, p.name AS product_name, p.sku FROM price_list_items i JOIN products p ON p.id=i.product_id WHERE i.list_id=? ORDER BY p.name COLLATE NOCASE', listId); },
      async setItems(listId, items) { run('DELETE FROM price_list_items WHERE list_id=?', listId); const ins = conn.prepare('INSERT INTO price_list_items (list_id,product_id,price_cents) VALUES (?,?,?)'); for (const i of items) ins.run(listId, i.productId, i.priceCents); },
      async clients(listId) { return all('SELECT c.id, c.name, c.code FROM price_list_clients x JOIN clients c ON c.id=x.client_id WHERE x.list_id=? ORDER BY c.name COLLATE NOCASE', listId); },
      async setClients(listId, ids) { run('DELETE FROM price_list_clients WHERE list_id=?', listId); const ins = conn.prepare('INSERT INTO price_list_clients (list_id,client_id) VALUES (?,?)'); for (const id of ids) ins.run(listId, id); },
      async counts(companyId) { return all('SELECT l.id, (SELECT COUNT(*) FROM price_list_items WHERE list_id=l.id) items, (SELECT COUNT(*) FROM price_list_clients WHERE list_id=l.id) clients FROM price_lists l WHERE l.company_id=?', companyId); },
      /** Listas ACTIVAS asignadas al cliente (para resolver precio). */
      async assignedTo(companyId, clientId) { return all("SELECT l.* FROM price_lists l JOIN price_list_clients x ON x.list_id=l.id WHERE l.company_id=? AND x.client_id=? AND l.status='ACTIVE'", companyId, clientId); },
      async defaults(companyId) { return all("SELECT * FROM price_lists WHERE company_id=? AND is_default=1 AND status='ACTIVE'", companyId); },
      async priceOf(listId, productId) { return get('SELECT price_cents FROM price_list_items WHERE list_id=? AND product_id=?', listId, productId)?.price_cents ?? null; },
    },
    promotions: { ...crud('promotions', ['name', 'product_id', 'kind', 'value', 'valid_from', 'valid_to', 'status']),
      async activeFor(companyId, productId) { return all("SELECT * FROM promotions WHERE company_id=? AND status='ACTIVE' AND (product_id IS NULL OR product_id=?)", companyId, productId); } },
    discountRules: crud('discount_rules', ['name', 'percent_bp', 'description', 'status']),

    stock: {
      async get(centerId, productId) { return get('SELECT * FROM center_stock WHERE center_id=? AND product_id=?', centerId, productId); },
      async list(companyId, centerIds) {
        if (!centerIds.length) return []; const p = { companyId };
        return all(`SELECT s.*, pr.name AS product_name, pr.sku, pr.unit FROM center_stock s JOIN products pr ON pr.id=s.product_id WHERE s.company_id=@companyId AND ${inList('s.center_id', centerIds, p, 'c')} ORDER BY pr.name COLLATE NOCASE`, p);
      },
      async upsert(companyId, centerId, productId, qty, minQty) {
        run(`INSERT INTO center_stock (center_id,product_id,company_id,qty,min_qty,updated_at) VALUES (?,?,?,?,?,?)
             ON CONFLICT(center_id,product_id) DO UPDATE SET qty=excluded.qty, min_qty=COALESCE(?, center_stock.min_qty), updated_at=excluded.updated_at`, centerId, productId, companyId, qty, minQty ?? 0, iso(), minQty ?? null);
      },
      async setMin(companyId, centerId, productId, minQty) {
        run(`INSERT INTO center_stock (center_id,product_id,company_id,qty,min_qty,updated_at) VALUES (?,?,?,0,?,?)
             ON CONFLICT(center_id,product_id) DO UPDATE SET min_qty=excluded.min_qty, updated_at=excluded.updated_at`, centerId, productId, companyId, minQty, iso());
      },
      async move(m) { return run('INSERT INTO stock_movements (company_id,center_id,product_id,delta,balance_after,reason,route_id,note,created_by,created_at) VALUES (@companyId,@centerId,@productId,@delta,@balanceAfter,@reason,@routeId,@note,@createdBy,@createdAt)', { routeId: null, note: null, createdBy: null, createdAt: iso(), ...m }).lastInsertRowid; },
      async movements(companyId, centerIds, productId, limit = 100) {
        if (!centerIds.length) return []; const p = { companyId, limit }; let w = '';
        if (productId) { w = ' AND m.product_id=@productId'; p.productId = productId; }
        return all(`SELECT m.*, pr.name AS product_name FROM stock_movements m JOIN products pr ON pr.id=m.product_id WHERE m.company_id=@companyId AND ${inList('m.center_id', centerIds, p, 'c')}${w} ORDER BY m.id DESC LIMIT @limit`, p);
      },
    },
    loads: {
      async list(routeId) { return all('SELECT l.*, p.name AS product_name, p.sku FROM route_loads l JOIN products p ON p.id=l.product_id WHERE l.route_id=? ORDER BY p.name COLLATE NOCASE', routeId); },
      async get(routeId, productId) { return get('SELECT * FROM route_loads WHERE route_id=? AND product_id=?', routeId, productId); },
      async count(routeId) { return get('SELECT COUNT(*) n FROM route_loads WHERE route_id=?', routeId).n; },
      async add(routeId, productId, qty) { run('INSERT INTO route_loads (route_id,product_id,qty_loaded) VALUES (?,?,?) ON CONFLICT(route_id,product_id) DO UPDATE SET qty_loaded=qty_loaded+excluded.qty_loaded', routeId, productId, qty); },
      async setSold(routeId, productId, sold) { run('UPDATE route_loads SET qty_sold=? WHERE route_id=? AND product_id=?', sold, routeId, productId); },
      async setReturned(routeId, productId, returned) { run('UPDATE route_loads SET qty_returned=? WHERE route_id=? AND product_id=?', returned, routeId, productId); },
    },
    orders: {
      async list(companyId, centerIds, { status, clientId } = {}) {
        if (!centerIds.length) return []; const p = { companyId }; const w = ['o.company_id=@companyId', inList('o.center_id', centerIds, p, 'c')];
        if (status) { w.push('o.status=@status'); p.status = status; } if (clientId) { w.push('o.client_id=@clientId'); p.clientId = clientId; }
        return all(`SELECT o.*, c.name AS client_name FROM orders o JOIN clients c ON c.id=o.client_id WHERE ${w.join(' AND ')} ORDER BY o.created_at DESC`, p);
      },
      async get(companyId, id) { return get('SELECT o.*, c.name AS client_name FROM orders o JOIN clients c ON c.id=o.client_id WHERE o.company_id=? AND o.id=?', companyId, id); },
      async create(o, lines) {
        const t = iso(); run('INSERT INTO orders (id,company_id,center_id,client_id,status,notes,created_by,created_at,updated_at) VALUES (@id,@companyId,@centerId,@clientId,\'OPEN\',@notes,@createdBy,@t,@t)', { notes: null, createdBy: null, ...o, t });
        const ins = conn.prepare('INSERT INTO order_lines (order_id,product_id,qty) VALUES (?,?,?)'); for (const l of lines) ins.run(o.id, l.productId, l.qty);
        return get('SELECT * FROM orders WHERE id=?', o.id);
      },
      async lines(orderId) { return all('SELECT l.*, p.name AS product_name, p.sku, p.unit FROM order_lines l JOIN products p ON p.id=l.product_id WHERE l.order_id=? ORDER BY p.name COLLATE NOCASE', orderId); },
      async setStatus(id, status) { run('UPDATE orders SET status=?, updated_at=? WHERE id=?', status, iso(), id); },
      async openForClient(companyId, clientId) { return get("SELECT * FROM orders WHERE company_id=? AND client_id=? AND status='OPEN' ORDER BY created_at LIMIT 1", companyId, clientId); },
      async setDeliveredVisit(id, visitId) { run('UPDATE orders SET delivered_visit_id=? WHERE id=?', visitId, id); },
      async setDelivered(orderId, productId, qty) { run('UPDATE order_lines SET qty_delivered=? WHERE order_id=? AND product_id=?', qty, orderId, productId); },
    },
    assets: {
      ...crud('assets', ['center_id', 'code', 'kind', 'description', 'status', 'client_id'], 'code COLLATE NOCASE'),
      async listScoped(companyId, centerIds, { clientId, status } = {}) {
        if (!centerIds.length) return []; const p = { companyId }; const w = ['a.company_id=@companyId', inList('a.center_id', centerIds, p, 'c')];
        if (clientId) { w.push('a.client_id=@clientId'); p.clientId = clientId; } if (status) { w.push('a.status=@status'); p.status = status; }
        return all(`SELECT a.*, c.name AS client_name FROM assets a LEFT JOIN clients c ON c.id=a.client_id WHERE ${w.join(' AND ')} ORDER BY a.code COLLATE NOCASE`, p);
      },
      async ofClient(companyId, clientId) { return all("SELECT * FROM assets WHERE company_id=? AND client_id=? AND status='LOANED' ORDER BY code", companyId, clientId); },
      async addEvent(e) { run('INSERT INTO asset_events (company_id,asset_id,kind,client_id,visit_id,note,created_by,created_at) VALUES (@companyId,@assetId,@kind,@clientId,@visitId,@note,@createdBy,@createdAt)', { clientId: null, visitId: null, note: null, createdBy: null, createdAt: iso(), ...e }); },
      async events(assetId) { return all('SELECT * FROM asset_events WHERE asset_id=? ORDER BY id DESC LIMIT 50', assetId); },
    },
    displayAudits: {
      async byVisit(visitId) { return get('SELECT * FROM display_audits WHERE visit_id=?', visitId); },
      async lines(auditId) { return all('SELECT l.*, p.name AS product_name FROM display_audit_lines l JOIN products p ON p.id=l.product_id WHERE l.audit_id=? ORDER BY p.name COLLATE NOCASE', auditId); },
      async replace(a, lines) {
        const ex = get('SELECT id FROM display_audits WHERE visit_id=?', a.visitId); if (ex) run('DELETE FROM display_audits WHERE id=?', ex.id);
        run('INSERT INTO display_audits (id,company_id,visit_id,client_id,notes,created_by,created_at) VALUES (@id,@companyId,@visitId,@clientId,@notes,@createdBy,@createdAt)', { notes: null, createdBy: null, createdAt: iso(), ...a });
        const ins = conn.prepare('INSERT INTO display_audit_lines (audit_id,product_id,fronts,expected_fronts) VALUES (?,?,?,?)'); for (const l of lines) ins.run(a.id, l.productId, l.fronts, l.expectedFronts ?? null);
      },
      async listScoped(companyId, centerIds, limit = 100) {
        if (!centerIds.length) return []; const p = { companyId, limit };
        return all(`SELECT d.*, c.name AS client_name, v.route_id FROM display_audits d JOIN visits v ON v.id=d.visit_id JOIN clients c ON c.id=d.client_id WHERE d.company_id=@companyId AND ${inList('v.center_id', centerIds, p, 'c')} ORDER BY d.created_at DESC LIMIT @limit`, p);
      },
    },
    settlements: {
      async get(companyId, id) { return get('SELECT s.*, r.name AS route_name, r.operator_user_id FROM settlements s JOIN routes r ON r.id=s.route_id WHERE s.company_id=? AND s.id=?', companyId, id); },
      async byRoute(routeId) { return get('SELECT * FROM settlements WHERE route_id=?', routeId); },
      async list(companyId, centerIds) {
        if (!centerIds.length) return []; const p = { companyId };
        return all(`SELECT s.*, r.name AS route_name, u.name AS operator_name FROM settlements s JOIN routes r ON r.id=s.route_id LEFT JOIN users u ON u.id=r.operator_user_id WHERE s.company_id=@companyId AND ${inList('s.center_id', centerIds, p, 'c')} ORDER BY s.created_at DESC`, p);
      },
      async create(s) { run('INSERT INTO settlements (id,company_id,center_id,route_id,status,expected_cents,other_cents,created_by,created_at) VALUES (@id,@companyId,@centerId,@routeId,\'OPEN\',@expectedCents,@otherCents,@createdBy,@createdAt)', { createdBy: null, createdAt: iso(), otherCents: 0, ...s }); return get('SELECT * FROM settlements WHERE id=?', s.id); },
      async update(id, patch) { const keys = Object.keys(patch); run(`UPDATE settlements SET ${keys.map((k) => `${k}=@${k}`).join(',')} WHERE id=@_id`, { ...patch, _id: id }); },
      async deposits(settlementId) { return all('SELECT d.*, u.name AS created_by_name FROM settlement_deposits d LEFT JOIN users u ON u.id=d.created_by WHERE d.settlement_id=? ORDER BY d.created_at, d.rowid', settlementId); },
      async addDeposit(d) { run('INSERT INTO settlement_deposits (id,settlement_id,amount_cents,reference,deposited_at,created_by,created_at) VALUES (@id,@settlementId,@amountCents,@reference,@depositedAt,@createdBy,@createdAt)', { reference: null, createdBy: null, createdAt: iso(), ...d }); },
      async sumDeposits(settlementId) { return get('SELECT COALESCE(SUM(amount_cents),0) c FROM settlement_deposits WHERE settlement_id=?', settlementId).c; },
    },
  };
};
