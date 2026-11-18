'use strict';
// Usuarios, roles/permisos, centros y zonas de la empresa del contexto (DT-16, DT-20…22).
const { uuid, iso } = require('../utils/ids');
const { badRequest, conflict, notFound, unprocessable, forbidden } = require('../utils/errors');
const { normalizeEmail, validEmail, validPassword, PASSWORD_MESSAGE, str, num } = require('../utils/validate');
const { CATALOG } = require('./permissions');
const { makeAudit } = require('./context');

const CODES = new Set(CATALOG.map((p) => p.code));
const userDto = (u, centerIds, now = Date.now()) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, roleId: u.role_id, role: u.role_name, status: u.status, centerIds, defaultCenterId: u.default_center_id,
  totpEnabled: !!u.totp_enabled, lastLoginAt: u.last_login_at, createdAt: u.created_at, locked: !!(u.locked_until && Date.parse(u.locked_until) > now) });
const roleDto = (r, permissions) => ({ id: r.id, name: r.name, description: r.description, isSystem: !!r.is_system, maxDiscountBp: r.max_discount_bp, userCount: r.user_count ?? undefined, permissions });

function createAdminService({ store, clock, auth }) {
  const audit = makeAudit(clock);
  const nowIso = () => iso(new Date(clock()));

  async function requireCenters(r, ctx, ids) {
    const centers = await r.centers.list(ctx.companyId); const valid = new Set(centers.map((c) => c.id));
    for (const id of ids) if (!valid.has(id)) throw unprocessable('Uno de los centros no existe.', 'CENTER_INVALID');
  }
  /** Garantiza que siga existiendo al menos un usuario ACTIVO con el permiso (evita dejar la empresa sin administradores). */
  async function ensureAdminsRemain(r, ctx) {
    for (const code of ['users.manage', 'roles.manage']) {
      if ((await r.users.countActiveWithPermission(ctx.companyId, code)) < 1) throw conflict('Debe quedar al menos un usuario activo con permiso para administrar usuarios y roles.', 'LAST_ADMIN');
    }
  }

  const users = {
    async list(ctx) {
      return store.read(async (r) => {
        const out = [];
        for (const u of await r.users.list(ctx.companyId)) out.push(userDto(u, await r.users.centerIds(u.id), clock()));
        return out;
      });
    },
    async create(ctx, b) {
      const email = normalizeEmail(b.email); if (!validEmail(email)) throw unprocessable('Escribe un correo válido.', 'EMAIL_INVALID');
      const name = str(b.name, 'El nombre', { required: true, max: 120 }); const phone = str(b.phone, 'El teléfono', { max: 30 });
      if (!validPassword(b.password)) throw unprocessable(PASSWORD_MESSAGE, 'PASSWORD_WEAK');
      const hash = await auth.hashPassword(b.password);
      return store.tx(async (r) => {
        const role = await r.roles.get(ctx.companyId, b.roleId); if (!role) throw unprocessable('Selecciona un rol válido.', 'ROLE_INVALID');
        const centerIds = Array.isArray(b.centerIds) ? b.centerIds : []; await requireCenters(r, ctx, centerIds);
        if (b.defaultCenterId && !centerIds.includes(b.defaultCenterId)) throw unprocessable('El centro predeterminado debe estar entre los centros del usuario.', 'CENTER_INVALID');
        if (await r.users.findByEmail(email)) throw conflict('Ya existe un usuario con ese correo.', 'EMAIL_ALREADY_REGISTERED');
        const u = await r.users.create({ id: uuid(), companyId: ctx.companyId, email, name, phone, passwordHash: hash, roleId: role.id, defaultCenterId: b.defaultCenterId || centerIds[0] || null, createdAt: nowIso() });
        await r.users.setCenters(u.id, centerIds);
        await audit(r, ctx, 'user.created', { entity: 'user', entityId: u.id, detail: { email, role: role.name } });
        return userDto({ ...u, role_name: role.name }, centerIds, clock());
      });
    },
    async update(ctx, id, b) {
      const name = b.name === undefined ? undefined : str(b.name, 'El nombre', { required: true, max: 120 }); const phone = b.phone === undefined ? undefined : str(b.phone, 'El teléfono', { max: 30 });
      let email; if (b.email !== undefined) { email = normalizeEmail(b.email); if (!validEmail(email)) throw unprocessable('Escribe un correo válido.', 'EMAIL_INVALID'); }
      const hash = b.password ? (validPassword(b.password) ? await auth.hashPassword(b.password) : (() => { throw unprocessable(PASSWORD_MESSAGE, 'PASSWORD_WEAK'); })()) : null;
      return store.tx(async (r) => {
        const u = await r.users.get(ctx.companyId, id); if (!u) throw notFound('Usuario no encontrado.');
        let roleId; if (b.roleId !== undefined && b.roleId !== u.role_id) { if (!(await r.roles.get(ctx.companyId, b.roleId))) throw unprocessable('Selecciona un rol válido.', 'ROLE_INVALID'); roleId = b.roleId; }
        if (email && email !== u.email && (await r.users.findByEmail(email))) throw conflict('Ya existe un usuario con ese correo.', 'EMAIL_ALREADY_REGISTERED');
        let centerIds; if (b.centerIds !== undefined) { centerIds = Array.isArray(b.centerIds) ? b.centerIds : []; await requireCenters(r, ctx, centerIds); }
        const currentCenters = centerIds ?? await r.users.centerIds(id);
        if (b.defaultCenterId && !currentCenters.includes(b.defaultCenterId)) throw unprocessable('El centro predeterminado debe estar entre los centros del usuario.', 'CENTER_INVALID');
        await r.users.update(ctx.companyId, id, { name, phone, email, role_id: roleId, default_center_id: b.defaultCenterId });
        if (centerIds) await r.users.setCenters(id, centerIds);
        if (hash) { await r.users.setPassword(id, hash); await r.sessions.revokeAllForUser(id, 'PASSWORD_CHANGED_BY_ADMIN', null, nowIso()); }
        if (roleId) { await ensureAdminsRemain(r, ctx); await r.sessions.revokeAllForUser(id, 'ROLE_CHANGED', id === ctx.userId ? ctx.sessionId : null, nowIso()); }
        await audit(r, ctx, 'user.updated', { entity: 'user', entityId: id, detail: { roleChanged: !!roleId, centersChanged: !!centerIds, passwordChanged: !!hash } });
        const fresh = (await r.users.list(ctx.companyId)).find((x) => x.id === id);
        return userDto(fresh, await r.users.centerIds(id), clock());
      });
    },
    /** Inactivar revoca TODAS las sesiones del usuario al instante (DT-11). */
    async setStatus(ctx, id, status) {
      if (!['ACTIVE', 'INACTIVE'].includes(status)) throw unprocessable('Estado no válido.', 'STATUS_INVALID');
      return store.tx(async (r) => {
        const u = await r.users.get(ctx.companyId, id); if (!u) throw notFound('Usuario no encontrado.');
        if (status === 'INACTIVE' && id === ctx.userId) throw conflict('No puedes desactivar tu propio usuario.', 'SELF_DEACTIVATE');
        await r.users.update(ctx.companyId, id, { status });
        let revoked = 0;
        if (status === 'INACTIVE') { revoked = await r.sessions.revokeAllForUser(id, 'USER_INACTIVE', null, nowIso()); await ensureAdminsRemain(r, ctx); }
        await audit(r, ctx, status === 'INACTIVE' ? 'user.deactivated' : 'user.activated', { entity: 'user', entityId: id, detail: { sessionsRevoked: revoked } });
        return { id, status, sessionsRevoked: revoked };
      });
    },
  };

  const roles = {
    async catalog() { return CATALOG; },
    async list(ctx) {
      return store.read(async (r) => { const out = []; for (const role of await r.roles.list(ctx.companyId)) out.push(roleDto(role, await r.roles.permissionsOf(role.id))); return out; });
    },
    async create(ctx, b) {
      const name = str(b.name, 'El nombre del rol', { required: true, max: 60 }); const bp = num(b.maxDiscountBp ?? 0, 'El tope de descuento', { min: 0, max: 10000 });
      const perms = this.validCodes(b.permissions ?? []);
      return store.tx(async (r) => {
        if (await r.roles.getByName(ctx.companyId, name)) throw conflict('Ya existe un rol con ese nombre.', 'ROLE_EXISTS');
        const role = await r.roles.create({ id: uuid(), companyId: ctx.companyId, name, description: str(b.description, 'La descripción', { max: 200 }), maxDiscountBp: bp, createdAt: nowIso() });
        await r.roles.setPermissions(role.id, perms);
        await audit(r, ctx, 'role.created', { entity: 'role', entityId: role.id, detail: { name, permissions: perms.length } });
        return roleDto(role, perms.sort());
      });
    },
    validCodes(codes) {
      if (!Array.isArray(codes)) throw unprocessable('Los permisos deben ser una lista.', 'PERMISSIONS_INVALID');
      for (const c of codes) if (!CODES.has(c)) throw unprocessable(`Permiso desconocido: ${c}`, 'PERMISSIONS_INVALID');
      return [...new Set(codes)];
    },
    async update(ctx, id, b) {
      const name = b.name === undefined ? undefined : str(b.name, 'El nombre del rol', { required: true, max: 60 });
      const bp = b.maxDiscountBp === undefined ? undefined : num(b.maxDiscountBp, 'El tope de descuento', { min: 0, max: 10000, required: true });
      return store.tx(async (r) => {
        const role = await r.roles.get(ctx.companyId, id); if (!role) throw notFound('Rol no encontrado.');
        if (name && name !== role.name) { if (role.is_system) throw conflict('Los roles de sistema no se pueden renombrar.', 'ROLE_SYSTEM'); if (await r.roles.getByName(ctx.companyId, name)) throw conflict('Ya existe un rol con ese nombre.', 'ROLE_EXISTS'); }
        await r.roles.update(ctx.companyId, id, { name, description: b.description === undefined ? undefined : str(b.description, 'La descripción', { max: 200 }), max_discount_bp: bp });
        await audit(r, ctx, 'role.updated', { entity: 'role', entityId: id, detail: { name, maxDiscountBp: bp } });
        return roleDto(await r.roles.get(ctx.companyId, id), await r.roles.permissionsOf(id));
      });
    },
    /** Los cambios aplican de inmediato: los permisos se leen en cada petición. */
    async setPermissions(ctx, id, codes) {
      const perms = this.validCodes(codes);
      return store.tx(async (r) => {
        const role = await r.roles.get(ctx.companyId, id); if (!role) throw notFound('Rol no encontrado.');
        const before = await r.roles.permissionsOf(id);
        await r.roles.setPermissions(id, perms); await ensureAdminsRemain(r, ctx);
        await audit(r, ctx, 'role.permissions_changed', { entity: 'role', entityId: id, detail: { name: role.name, added: perms.filter((p) => !before.includes(p)), removed: before.filter((p) => !perms.includes(p)) } });
        return roleDto(role, perms.sort());
      });
    },
    async remove(ctx, id) {
      return store.tx(async (r) => {
        const role = await r.roles.get(ctx.companyId, id); if (!role) throw notFound('Rol no encontrado.');
        if (role.is_system) throw conflict('Los roles de sistema no se pueden eliminar.', 'ROLE_SYSTEM');
        if ((await r.roles.list(ctx.companyId)).find((x) => x.id === id).user_count > 0) throw conflict('Hay usuarios con este rol: reasígnalos primero.', 'ROLE_IN_USE');
        await r.roles.delete(ctx.companyId, id); await audit(r, ctx, 'role.deleted', { entity: 'role', entityId: id, detail: { name: role.name } });
        return { id };
      });
    },
  };

  const org = {
    async centers(ctx) { return store.read(async (r) => (await r.centers.list(ctx.companyId)).filter((c) => ctx.accessibleCenterIds.includes(c.id) || ctx.can('centers.manage')).map((c) => ({ id: c.id, name: c.name, code: c.code, status: c.status }))); },
    async createCenter(ctx, b) {
      const name = str(b.name, 'El nombre del centro', { required: true, max: 80 }); const code = str(b.code, 'El código', { max: 20 });
      return store.tx(async (r) => {
        if ((await r.centers.list(ctx.companyId)).some((c) => c.name.toLowerCase() === name.toLowerCase())) throw conflict('Ya existe un centro con ese nombre.', 'CENTER_EXISTS');
        const c = await r.centers.create({ id: uuid(), companyId: ctx.companyId, name, code, createdAt: nowIso() });
        if (!ctx.can('centers.all')) await r.users.setCenters(ctx.userId, [...(await r.users.centerIds(ctx.userId)), c.id]);
        await audit(r, ctx, 'center.created', { entity: 'center', entityId: c.id, detail: { name }, centerId: c.id });
        return { id: c.id, name: c.name, code: c.code, status: c.status };
      });
    },
    async updateCenter(ctx, id, b) {
      return store.tx(async (r) => {
        const c = await r.centers.get(ctx.companyId, id); if (!c) throw notFound('Centro no encontrado.');
        const name = b.name === undefined ? undefined : str(b.name, 'El nombre del centro', { required: true, max: 80 });
        if (b.status !== undefined && !['ACTIVE', 'INACTIVE'].includes(b.status)) throw unprocessable('Estado no válido.', 'STATUS_INVALID');
        await r.centers.update(ctx.companyId, id, { name, code: b.code === undefined ? undefined : str(b.code, 'El código', { max: 20 }), status: b.status });
        await audit(r, ctx, 'center.updated', { entity: 'center', entityId: id, detail: { name, status: b.status }, centerId: id });
        const f = await r.centers.get(ctx.companyId, id); return { id: f.id, name: f.name, code: f.code, status: f.status };
      });
    },
    async zones(ctx) { return store.read(async (r) => (await r.zones.list(ctx.companyId, ctx.centerId ? [ctx.centerId] : ctx.accessibleCenterIds)).map((z) => ({ id: z.id, centerId: z.center_id, name: z.name }))); },
    async createZone(ctx, b) {
      const name = str(b.name, 'El nombre de la zona', { required: true, max: 80 }); const centerId = b.centerId || ctx.centerId;
      if (!centerId) throw unprocessable('Selecciona un centro.', 'CENTER_REQUIRED');
      if (!ctx.accessibleCenterIds.includes(centerId)) throw notFound('Centro no encontrado.');
      return store.tx(async (r) => {
        if ((await r.zones.list(ctx.companyId, [centerId])).some((z) => z.name.toLowerCase() === name.toLowerCase())) throw conflict('Ya existe una zona con ese nombre.', 'ZONE_EXISTS');
        const z = await r.zones.create({ id: uuid(), companyId: ctx.companyId, centerId, name, createdAt: nowIso() });
        await audit(r, ctx, 'zone.created', { entity: 'zone', entityId: z.id, detail: { name }, centerId });
        return { id: z.id, centerId, name };
      });
    },
  };

  const audits = {
    async list(ctx, q) {
      const rows = await store.read((r) => r.audit.list(ctx.companyId, { from: q.from, to: q.to, actorId: q.actorId, action: q.action, limit: q.limit, offset: q.offset, centerIds: ctx.can('centers.all') ? undefined : ctx.accessibleCenterIds }));
      return rows.map((e) => ({ id: e.id, at: e.created_at, actorId: e.actor_id, actor: e.actor_name, action: e.action, entity: e.entity, entityId: e.entity_id, centerId: e.center_id, detail: e.detail, ip: e.ip }));
    },
    async verify(ctx) { return store.read((r) => r.audit.verifyChain(ctx.companyId)); },
    /** Eventos de seguridad del propio usuario (sin requerir audit.read). */
    async mine(ctx) {
      const rows = await store.read((r) => r.audit.list(ctx.companyId, { actorId: ctx.userId, limit: 200 }));
      return rows.filter((e) => /^(auth|profile)\./.test(e.action)).slice(0, 8).map((e) => ({ id: e.id, at: e.created_at, actorId: e.actor_id, actor: e.actor_name, action: e.action, entity: e.entity, entityId: e.entity_id, centerId: e.center_id, detail: e.detail }));
    },
  };

  const notifications = {
    async list(ctx, q) { return store.read(async (r) => (await r.notifications.list(ctx.companyId, { category: q.category, centerIds: ctx.can('centers.all') ? undefined : ctx.accessibleCenterIds })).map((n) => ({ id: n.id, category: n.category, title: n.title, detail: n.detail, read: !!n.read_at, at: n.created_at }))); },
    async markRead(ctx, id) { const n = await store.tx((r) => r.notifications.markRead(ctx.companyId, id, nowIso())); return { updated: n }; },
  };

  return { users, roles, org, audits, notifications };
}

module.exports = { createAdminService };
