'use strict';
// Configuración versionada (DT-43): un BORRADOR editable y versiones PUBLICADAS inmutables. Los dispositivos confirman su recepción.
// Cobertura de `payload`: módulos, formularios (entrega/cobro/visita) y parámetros por ámbito con herencia.
const { uuid, iso } = require('../utils/ids');
const { conflict, notFound, unprocessable, badRequest } = require('../utils/errors');
const { str } = require('../utils/validate');
const { makeAudit } = require('./context');
const params = require('./params');
const forms = require('./forms');

const MODULES = ['Preventa', 'Autoventa', 'Activos en comodato', 'Auditoría de exhibición'];
const emptyPayload = () => ({ modules: MODULES.map((name) => ({ name, enabled: false })), forms: { entrega: [], cobro: [], visita: [] }, parameters: {} });
const canonical = (p) => JSON.stringify([p.modules, p.forms, Object.keys(p.parameters || {}).sort().map((k) => [k, Object.keys(p.parameters[k]).sort().map((x) => [x, p.parameters[k][x]])])]);
const parse = (row) => (row ? JSON.parse(row.payload) : null);

function createConfigService({ store, clock, bus }) {
  const audit = makeAudit(clock);
  const now = () => iso(new Date(clock()));

  async function ensureDraft(r, companyId) {
    let d = await r.config.draft(companyId);
    if (!d) { const pub = await r.config.published(companyId); d = await r.config.createDraft({ id: uuid(), companyId, payload: JSON.stringify(pub ? parse(pub) : emptyPayload()) }); }
    return d;
  }

  async function validatedParameters(r, ctx, parameters) {
    const out = {};
    for (const [key, values] of Object.entries(parameters || {})) {
      const [type, id] = key.split(':');
      if (!params.SCOPES.includes(type) || (type === 'EMPRESA') !== (id === undefined)) throw unprocessable(`Ámbito no válido: ${key}`, 'PARAM_SCOPE_INVALID');
      if (type !== 'EMPRESA' && !(await r.config.scopeExists(ctx.companyId, type, id))) throw unprocessable(`El ámbito ${key} no existe en tu empresa.`, 'PARAM_SCOPE_INVALID');
      const clean = params.parseScopeValues(values); if (Object.keys(clean).length) out[key] = clean;
    }
    return out;
  }

  async function view(r, ctx) {
    const draft = await ensureDraft(r, ctx.companyId); const pub = await r.config.published(ctx.companyId); const dp = parse(draft); const pp = pub ? parse(pub) : null;
    return { draft: dp, published: pp ? { version: pub.version, publishedAt: pub.published_at, note: pub.note, payload: pp } : null, hasChanges: canonical(dp) !== canonical(pp ?? emptyPayload()), draftUpdatedAt: draft.updated_at };
  }

  async function versionRows(r, companyId) {
    const eligible = await r.config.eligibleDevices(companyId); const out = [];
    for (const v of await r.config.versions(companyId)) {
      const acked = new Set(await r.config.ackedDevices(companyId, v.version));
      out.push({ version: v.version, status: v.status, note: v.note, publishedAt: v.published_at, publishedBy: v.published_by, ack: { received: eligible.filter((d) => acked.has(d.id)).length, total: eligible.length, pending: eligible.filter((d) => !acked.has(d.id)).map((d) => d.alias) } });
    }
    return out;
  }

  return {
    MODULES,
    async get(ctx) { return store.tx(async (r) => ({ ...(await view(r, ctx)), versions: await versionRows(r, ctx.companyId) })); },

    async saveDraft(ctx, b) {
      return store.tx(async (r) => {
        const d = await ensureDraft(r, ctx.companyId); const p = parse(d);
        if (b.modules !== undefined) {
          if (!Array.isArray(b.modules)) throw badRequest('modules debe ser una lista.');
          const enabled = new Map(b.modules.map((m) => [String(m.name), !!m.enabled])); for (const n of enabled.keys()) if (!MODULES.includes(n)) throw unprocessable(`Módulo desconocido: ${n}`, 'MODULE_UNKNOWN');
          p.modules = MODULES.map((name) => ({ name, enabled: enabled.has(name) ? enabled.get(name) : !!p.modules.find((m) => m.name === name)?.enabled }));
        }
        if (b.forms !== undefined) {
          if (typeof b.forms !== 'object' || Array.isArray(b.forms)) throw badRequest('forms debe ser un objeto.');
          for (const [kind, fields] of Object.entries(b.forms)) { if (!forms.KINDS.includes(kind)) throw unprocessable(`Formulario desconocido: ${kind}`, 'FORM_UNKNOWN'); p.forms[kind] = forms.parseFields(kind, fields); }
        }
        if (b.parameters !== undefined) p.parameters = await validatedParameters(r, ctx, b.parameters);
        await r.config.saveDraft(ctx.companyId, JSON.stringify(p));
        await audit(r, ctx, 'config.draft_saved', { entity: 'config', detail: { sections: ['modules', 'forms', 'parameters'].filter((k) => b[k] !== undefined) } });
        return { ...(await view(r, ctx)) };
      });
    },

    async publish(ctx, b = {}) {
      const note = str(b.note, 'La nota', { max: 240 });
      const out = await store.tx(async (r) => {
        const v = await view(r, ctx);
        if (!v.hasChanges) throw conflict('No hay cambios pendientes por publicar.', 'NO_CHANGES');
        const t = now(); const version = (await r.config.maxVersion(ctx.companyId)) + 1;
        await r.config.supersedePublished(ctx.companyId);
        await r.config.insertPublished({ id: uuid(), companyId: ctx.companyId, version, payload: JSON.stringify(v.draft), note, by: ctx.userId, at: t });
        await audit(r, ctx, 'config.published', { entity: 'config', entityId: String(version), detail: { version, note } });
        await r.notifications.add({ companyId: ctx.companyId, category: 'Sistema', title: 'Configuración publicada', detail: `La versión ${version} se enviará a los dispositivos.`, createdAt: t });
        return { version };
      });
      bus?.publish({ companyId: ctx.companyId, type: 'config.published', data: { version: out.version } });
      return { ...out, ...(await this.get(ctx)) };
    },

    async versions(ctx) { return store.read((r) => versionRows(r, ctx.companyId)); },
    async versionPayload(ctx, version) { return store.read(async (r) => { const v = await r.config.version(ctx.companyId, Number(version)); if (!v) throw notFound('Versión no encontrada.'); return { version: v.version, status: v.status, note: v.note, publishedAt: v.published_at, payload: parse(v) }; }); },

    /** Valores efectivos con su origen. `source=draft` previsualiza el borrador; por defecto, lo publicado (lo que hacen cumplir los servicios). */
    async effective(ctx, q = {}) {
      return store.read(async (r) => {
        const draft = q.source === 'draft'; const row = draft ? await ensureDraftRead(r, ctx.companyId) : await r.config.published(ctx.companyId);
        const scope = { centerId: q.centerId || undefined, zoneId: q.zoneId || undefined, routeId: q.routeId || undefined, userId: q.userId || undefined };
        if (scope.routeId) { const route = await r.routes.get(ctx.companyId, scope.routeId); if (route) { scope.centerId ||= route.center_id; scope.zoneId ||= route.zone_id || undefined; scope.userId ||= route.operator_user_id || undefined; } }
        let parameters = row ? parse(row).parameters : {};
        // `inheritedFor=ZONA` devuelve lo que se heredaría SIN los valores de ese ámbito ni de los más específicos (para los marcadores de la pantalla).
        const upTo = params.PRECEDENCE.indexOf(String(q.inheritedFor || '').toUpperCase());
        if (upTo >= 0) { const cut = new Set(params.PRECEDENCE.slice(0, upTo + 1)); parameters = Object.fromEntries(Object.entries(parameters).filter(([k]) => !cut.has(k.split(':')[0]))); }
        return { source: draft ? 'draft' : 'published', version: draft ? null : row?.version ?? null, scope, ...params.resolve(parameters, scope) };
      });
    },

    // ----- contrato móvil -----
    async forDevice(ctx, scope = {}) {
      return store.read(async (r) => { const pub = await r.config.published(ctx.companyId); const p = pub ? parse(pub) : emptyPayload(); return { version: pub?.version ?? 0, modules: p.modules, forms: p.forms, parameters: params.resolve(p.parameters, { userId: ctx.userId, centerId: scope.centerId ?? ctx.centerId ?? undefined, ...scope }) }; });
    },
    async ack(ctx, deviceId, version) {
      const n = Number(version); if (!Number.isInteger(n) || n < 1) throw badRequest('Indica la versión (version).', 'VERSION_REQUIRED');
      const out = await store.tx(async (r) => { if (!(await r.config.version(ctx.companyId, n))) throw notFound('Versión no encontrada.'); await r.config.ack(ctx.companyId, deviceId, n, now()); return { version: n }; });
      bus?.publish({ companyId: ctx.companyId, type: 'config.acked', data: { version: n, deviceId } });
      return out;
    },

    // ----- utilidades para otros servicios (dentro de una transacción/lectura abierta) -----
    async publishedPayload(r, companyId) { const pub = await r.config.published(companyId); return pub ? { version: pub.version, payload: parse(pub) } : { version: 0, payload: emptyPayload() }; },
    async payloadOfVersion(r, companyId, version) { const v = await r.config.version(companyId, version); return v ? parse(v) : null; },
  };
  async function ensureDraftRead(r, companyId) { return (await r.config.draft(companyId)) || (await r.config.published(companyId)); }
}
module.exports = { createConfigService, MODULES, emptyPayload };
