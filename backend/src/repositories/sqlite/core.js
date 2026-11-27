'use strict';
// Repositorios de empresas, centros, zonas, roles y usuarios. Métodos async (DT-04): mismo contrato que tendrá la versión PostgreSQL.
const { iso } = require('../../utils/ids');

function patchSql(table, idCols, patch, allowed) {
  const keys = Object.keys(patch).filter((k) => allowed.includes(k) && patch[k] !== undefined);
  if (!keys.length) return null;
  return { sql: `UPDATE ${table} SET ${keys.map((k) => `${k}=@${k}`).join(',')} WHERE ${idCols.map((c) => `${c}=@_${c}`).join(' AND ')}`, keys };
}

module.exports = function coreRepos(conn) {
  const get = (sql, ...p) => conn.prepare(sql).get(...p);
  const all = (sql, ...p) => conn.prepare(sql).all(...p);
  const run = (sql, ...p) => conn.prepare(sql).run(...p);
  const update = (table, where, patch, allowed) => {
    const built = patchSql(table, Object.keys(where), patch, allowed);
    if (!built) return 0;
    const params = { ...where && Object.fromEntries(Object.entries(where).map(([k, v]) => [`_${k}`, v])) };
    for (const k of built.keys) params[k] = patch[k];
    return conn.prepare(built.sql).run(params).changes;
  };

  return {
    companies: {
      async create(c) {
        run(`INSERT INTO companies (id,rfc,legal_name,industry,country,timezone,phone,plan,fiscal_status,fiscal_verified_at,status,created_at)
             VALUES (@id,@rfc,@legalName,@industry,@country,@timezone,@phone,@plan,@fiscalStatus,@fiscalVerifiedAt,'ACTIVE',@createdAt)`,
          { industry: null, country: null, phone: null, plan: 'Operación', fiscalVerifiedAt: null, createdAt: iso(), ...c, timezone: c.timezone || 'America/Mexico_City' });
        return get('SELECT * FROM companies WHERE id=?', c.id);
      },
      async get(id) { return get('SELECT * FROM companies WHERE id=?', id); },
      async findByRfc(rfc) { return get('SELECT * FROM companies WHERE rfc=?', rfc); },
      async update(id, patch) { return update('companies', { id }, patch, ['plan', 'industry', 'country', 'timezone', 'phone', 'status']); },
    },

    centers: {
      async list(companyId) { return all('SELECT * FROM centers WHERE company_id=? ORDER BY name', companyId); },
      async get(companyId, id) { return get('SELECT * FROM centers WHERE company_id=? AND id=?', companyId, id); },
      async create(c) {
        run('INSERT INTO centers (id,company_id,name,code,status,created_at) VALUES (@id,@companyId,@name,@code,@status,@createdAt)', { code: null, status: 'ACTIVE', createdAt: iso(), ...c });
        return get('SELECT * FROM centers WHERE id=?', c.id);
      },
      async update(companyId, id, patch) { return update('centers', { company_id: companyId, id }, patch, ['name', 'code', 'status']); },
    },

    zones: {
      async list(companyId, centerIds) {
        if (centerIds && !centerIds.length) return [];
        const base = 'SELECT * FROM zones WHERE company_id=?';
        return centerIds ? all(`${base} AND center_id IN (${centerIds.map(() => '?').join(',')}) ORDER BY name`, companyId, ...centerIds) : all(`${base} ORDER BY name`, companyId);
      },
      async get(companyId, id) { return get('SELECT * FROM zones WHERE company_id=? AND id=?', companyId, id); },
      async create(z) { run('INSERT INTO zones (id,company_id,center_id,name,created_at) VALUES (@id,@companyId,@centerId,@name,@createdAt)', { createdAt: iso(), ...z }); return get('SELECT * FROM zones WHERE id=?', z.id); },
    },

    permissions: {
      async sync(catalog) {
        const ins = conn.prepare('INSERT INTO permissions (code,grp,label) VALUES (?,?,?) ON CONFLICT(code) DO UPDATE SET grp=excluded.grp, label=excluded.label');
        for (const p of catalog) ins.run(p.code, p.group, p.label);
      },
      async all() { return all('SELECT code, grp AS "group", label FROM permissions ORDER BY rowid'); },
    },

    roles: {
      async list(companyId) {
        return all(`SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id=r.id) AS user_count FROM roles r WHERE r.company_id=? ORDER BY r.is_system DESC, r.name`, companyId);
      },
      async get(companyId, id) { return get('SELECT * FROM roles WHERE company_id=? AND id=?', companyId, id); },
      async getByName(companyId, name) { return get('SELECT * FROM roles WHERE company_id=? AND name=?', companyId, name); },
      async create(r) {
        run('INSERT INTO roles (id,company_id,name,description,is_system,max_discount_bp,created_at) VALUES (@id,@companyId,@name,@description,@isSystem,@maxDiscountBp,@createdAt)',
          { description: null, isSystem: 0, maxDiscountBp: 0, createdAt: iso(), ...r });
        return get('SELECT * FROM roles WHERE id=?', r.id);
      },
      async update(companyId, id, patch) { return update('roles', { company_id: companyId, id }, patch, ['name', 'description', 'max_discount_bp']); },
      async delete(companyId, id) { return run('DELETE FROM roles WHERE company_id=? AND id=?', companyId, id).changes; },
      async setPermissions(roleId, codes) {
        run('DELETE FROM role_permissions WHERE role_id=?', roleId);
        const ins = conn.prepare('INSERT INTO role_permissions (role_id,permission_code) VALUES (?,?)');
        for (const c of new Set(codes)) ins.run(roleId, c);
      },
      async permissionsOf(roleId) { return all('SELECT permission_code AS code FROM role_permissions WHERE role_id=? ORDER BY permission_code', roleId).map((r) => r.code); },
    },

    users: {
      async findByEmail(email) { return get('SELECT * FROM users WHERE email=?', email); },
      async getById(id) { return get('SELECT * FROM users WHERE id=?', id); },
      async get(companyId, id) { return get('SELECT * FROM users WHERE company_id=? AND id=?', companyId, id); },
      async list(companyId) {
        return all(`SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.company_id=? ORDER BY u.name COLLATE NOCASE`, companyId);
      },
      async create(u) {
        const t = iso();
        run(`INSERT INTO users (id,company_id,email,name,phone,password_hash,role_id,status,default_center_id,created_at,updated_at)
             VALUES (@id,@companyId,@email,@name,@phone,@passwordHash,@roleId,@status,@defaultCenterId,@createdAt,@createdAt)`,
          { phone: null, status: 'ACTIVE', defaultCenterId: null, createdAt: t, ...u });
        return get('SELECT * FROM users WHERE id=?', u.id);
      },
      async update(companyId, id, patch) { return update('users', { company_id: companyId, id }, { ...patch, updated_at: iso() }, ['name', 'phone', 'email', 'role_id', 'status', 'default_center_id', 'avatar_path', 'updated_at']); },
      async setPassword(id, hash) { run('UPDATE users SET password_hash=?, failed_attempts=0, last_failed_at=NULL, locked_until=NULL, updated_at=? WHERE id=?', hash, iso(), id); },
      async recordFailure(id, { failed, lastFailedAt, lockedUntil }) { run('UPDATE users SET failed_attempts=?, last_failed_at=?, locked_until=? WHERE id=?', failed, lastFailedAt, lockedUntil, id); },
      async recordLogin(id, at) { run('UPDATE users SET failed_attempts=0, last_failed_at=NULL, locked_until=NULL, last_login_at=? WHERE id=?', at, id); },
      async setTotp(id, enc, enabled) { run('UPDATE users SET totp_secret_enc=?, totp_enabled=?, updated_at=? WHERE id=?', enc, enabled ? 1 : 0, iso(), id); },
      async centerIds(userId) { return all('SELECT center_id FROM user_centers WHERE user_id=? ORDER BY center_id', userId).map((r) => r.center_id); },
      async setCenters(userId, ids) {
        run('DELETE FROM user_centers WHERE user_id=?', userId);
        const ins = conn.prepare('INSERT INTO user_centers (user_id,center_id) VALUES (?,?)');
        for (const id of new Set(ids)) ins.run(userId, id);
      },
      async permissionsOf(userId) {
        return all('SELECT rp.permission_code AS code FROM users u JOIN role_permissions rp ON rp.role_id=u.role_id WHERE u.id=?', userId).map((r) => r.code);
      },
      /** Usuarios ACTIVOS de la empresa cuyo rol tiene el permiso (protección contra quedarse sin administradores). */
      async countActiveWithPermission(companyId, code, excludeUserId = null) {
        return get(`SELECT COUNT(*) AS n FROM users u JOIN role_permissions rp ON rp.role_id=u.role_id
                    WHERE u.company_id=? AND u.status='ACTIVE' AND rp.permission_code=? AND u.id<>?`, companyId, code, excludeUserId ?? '').n;
      },
      async countActiveWithRolePermission(companyId, roleId, code) {
        return get(`SELECT COUNT(*) AS n FROM users u WHERE u.company_id=? AND u.status='ACTIVE' AND u.role_id=?`, companyId, roleId).n;
      },
    },
  };
};
