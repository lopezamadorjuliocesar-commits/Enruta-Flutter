'use strict';
const { iso } = require('../../utils/ids');

function inList(col, ids, p, prefix) { return `${col} IN (${ids.map((id, i) => { p[`${prefix}${i}`] = id; return `@${prefix}${i}`; }).join(',')})`; }

module.exports = function catalogRepos(conn) {
  const get = (sql, ...p) => conn.prepare(sql).get(...p);
  const all = (sql, ...p) => conn.prepare(sql).all(...p);
  const run = (sql, ...p) => conn.prepare(sql).run(...p);
  const patch = (table, where, data, allowed) => {
    const keys = Object.keys(data).filter((k) => allowed.includes(k) && data[k] !== undefined);
    if (!keys.length) return 0;
    const params = { _company_id: where.company_id, _id: where.id }; for (const k of keys) params[k] = data[k];
    return conn.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k}=@${k}`).join(',')}, updated_at=@_now WHERE company_id=@_company_id AND id=@_id`).run({ ...params, _now: iso() }).changes;
  };

  return {
    clients: {
      /** `centerIds` es el alcance ya resuelto por el servicio (centro activo o centros accesibles). */
      async list(companyId, centerIds, { search, status } = {}) {
        if (!centerIds.length) return [];
        const p = { companyId }; const where = ['company_id=@companyId', inList('center_id', centerIds, p, 'c')];
        if (status) { where.push('status=@status'); p.status = status; }
        if (search) { where.push('(name LIKE @q OR code LIKE @q)'); p.q = `%${search}%`; }
        return all(`SELECT * FROM clients WHERE ${where.join(' AND ')} ORDER BY name COLLATE NOCASE`, p);
      },
      async get(companyId, centerIds, id) {
        if (!centerIds.length) return undefined;
        const p = { companyId, id }; return get(`SELECT * FROM clients WHERE company_id=@companyId AND id=@id AND ${inList('center_id', centerIds, p, 'c')}`, p);
      },
      async create(c) {
        const t = iso();
        run(`INSERT INTO clients (id,company_id,center_id,zone_id,code,name,rfc,address,lat,lng,phone,status,created_at,updated_at)
             VALUES (@id,@companyId,@centerId,@zoneId,@code,@name,@rfc,@address,@lat,@lng,@phone,@status,@t,@t)`,
          { zoneId: null, code: null, rfc: null, address: null, lat: null, lng: null, phone: null, status: 'ACTIVE', ...c, t });
        return get('SELECT * FROM clients WHERE id=?', c.id);
      },
      async delete(companyId, id) { return run('DELETE FROM clients WHERE company_id=? AND id=?', companyId, id).changes; },
      async findForImport(companyId, centerId, code, name) { return (code && get('SELECT * FROM clients WHERE company_id=? AND upper(code)=upper(?)', companyId, code)) || get('SELECT * FROM clients WHERE company_id=? AND center_id=? AND lower(name)=lower(?)', companyId, centerId, name); },
      async update(companyId, id, data) { return patch('clients', { company_id: companyId, id }, data, ['center_id', 'zone_id', 'code', 'name', 'rfc', 'address', 'lat', 'lng', 'phone', 'status']); },
    },
    products: {
      async list(companyId, { search, status } = {}) {
        const p = { companyId }; const where = ['company_id=@companyId'];
        if (status) { where.push('status=@status'); p.status = status; }
        if (search) { where.push('(name LIKE @q OR sku LIKE @q)'); p.q = `%${search}%`; }
        return all(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY name COLLATE NOCASE`, p);
      },
      async get(companyId, id) { return get('SELECT * FROM products WHERE company_id=? AND id=?', companyId, id); },
      async create(c) {
        const t = iso();
        run('INSERT INTO products (id,company_id,sku,name,category,unit,description,price_cents,status,created_at,updated_at) VALUES (@id,@companyId,@sku,@name,@category,@unit,@description,@priceCents,@status,@t,@t)', { category: null, unit: 'pieza', description: null, priceCents: null, status: 'ACTIVE', ...c, t });
        return get('SELECT * FROM products WHERE id=?', c.id);
      },
      async update(companyId, id, data) { return patch('products', { company_id: companyId, id }, data, ['sku', 'name', 'category', 'unit', 'description', 'price_cents', 'status']); },
      async delete(companyId, id) { return run('DELETE FROM products WHERE company_id=? AND id=?', companyId, id).changes; },
      async findBySkuOrName(companyId, sku, name) { return (sku && get('SELECT * FROM products WHERE company_id=? AND upper(sku)=upper(?)', companyId, sku)) || get('SELECT * FROM products WHERE company_id=? AND lower(name)=lower(?)', companyId, name); },
    },
  };
};
