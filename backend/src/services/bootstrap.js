'use strict';
const { uuid, iso } = require('../utils/ids');
const { SYSTEM_ROLES, CATALOG } = require('./permissions');

/** Crea los roles de sistema de una empresa con sus permisos (DT-21). Devuelve { Administrador, Supervisor, ... }. */
async function createSystemRoles(r, companyId, createdAt = iso()) {
  await r.permissions.sync(CATALOG);
  const out = {};
  for (const def of SYSTEM_ROLES) {
    const role = await r.roles.create({ id: uuid(), companyId, name: def.name, description: def.description, isSystem: 1, maxDiscountBp: def.maxDiscountBp, createdAt });
    await r.roles.setPermissions(role.id, def.permissions);
    out[def.name] = role;
  }
  return out;
}
module.exports = { createSystemRoles };
