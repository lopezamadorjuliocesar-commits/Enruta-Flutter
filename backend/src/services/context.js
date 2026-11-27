'use strict';
// Utilidades compartidas por los servicios: contexto de tenant, alcance por centro y auditoría.
const { iso } = require('../utils/ids');

/** Centros visibles para la petición: el centro activo, o todos los accesibles si no hay centro activo. */
const scopeCenterIds = (ctx) => (ctx.centerId ? [ctx.centerId] : ctx.accessibleCenterIds);

function makeAudit(clock) {
  /** r = repos de la transacción en curso; actor = ctx o { companyId, userId, name, ip }. */
  return (r, actor, action, { entity, entityId, detail, centerId } = {}) => r.audit.append({
    companyId: actor.companyId, centerId: centerId ?? actor.centerId ?? null, actorId: actor.userId ?? null, actorName: actor.name ?? null,
    action, entity, entityId, detail, ip: actor.ip ?? null, createdAt: iso(clock()),
  });
}

module.exports = { scopeCenterIds, makeAudit };
