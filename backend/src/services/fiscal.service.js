'use strict';
// Carta Porte: el documento se persiste y el timbrado corre en la cola jobs_queue (sin Redis).
// Sin PAC real (PAC_MODE=local) el resultado es "Simulado": no hay UUID fiscal ni validez fiscal.
const { badRequest, notFound, conflict } = require('../utils/errors');
const { uuid, UUID_RE } = require('../utils/ids');
const { validateCartaPorteSubmission, validateProviderConfiguration, stampCartaPorte } = require('./carta-porte-fiscal');
const { PermanentError } = require('../queue/queue');
const { makeAudit } = require('./context');

const dto = (d) => d && ({ ...d, simulated: !!d.simulated });

function createFiscalService({ store, queue, clock }) {
  const audit = makeAudit(clock);

  async function submit(ctx, body) {
    const errors = validateCartaPorteSubmission(body); if (errors.length) throw badRequest(errors[0], 'CARTA_PORTE_INVALID');
    try { validateProviderConfiguration(); } catch (e) { throw new (require('../utils/errors').HttpError)(503, 'PAC_NOT_CONFIGURED', e.message); }
    const { folio, idCcp, data, xml } = body;
    const { doc, requeue } = await store.tx(async (r) => {
      const { inserted, doc: d } = await r.cartaPorte.insertIgnore({ id: uuid(), companyId: ctx.companyId, folio: folio.trim(), idCcp, data, xml });
      let requeue = inserted;
      if (!inserted && d.status === 'Error') { await r.cartaPorte.setStatus(ctx.companyId, d.id, { status: 'EnCola', attempts: d.attempts }); requeue = true; }
      if (inserted) await audit(r, ctx, 'cartaporte.submitted', { entity: 'cartaporte', entityId: d.id, detail: { folio: d.folio } });
      return { doc: await r.cartaPorte.getPublic(ctx.companyId, d.id), requeue };
    });
    if (requeue) await queue.enqueue({ type: 'CARTA_PORTE_STAMP', companyId: ctx.companyId, payload: { documentId: doc.id, companyId: ctx.companyId } });
    return { document: dto(doc), queued: requeue || doc.status === 'EnCola' || doc.status === 'Procesando' };
  }
  async function get(ctx, id) {
    if (!UUID_RE.test(id)) throw badRequest('Identificador de Carta Porte no válido.');
    const d = await store.read((r) => r.cartaPorte.getPublic(ctx.companyId, id)); if (!d) throw notFound('Carta Porte no encontrada.'); return dto(d);
  }
  async function list(ctx) { return store.read(async (r) => (await r.cartaPorte.list(ctx.companyId)).map(dto)); }
  async function stampedXml(ctx, id) {
    if (!UUID_RE.test(id)) throw badRequest('Identificador de Carta Porte no válido.');
    const d = await store.read((r) => r.cartaPorte.getFull(ctx.companyId, id)); if (!d) throw notFound('Carta Porte no encontrada.');
    if (d.status !== 'Timbrado' || !d.stamped_xml) throw conflict('El PAC todavía no ha devuelto un XML timbrado.', 'NOT_STAMPED');
    return { xml: d.stamped_xml };
  }

  /** Handler de la cola. Los reintentos y el backoff los gestiona la cola; aquí solo se refleja el estado del documento. */
  async function stampJob({ documentId, companyId }, job) {
    const doc = await store.read((r) => r.cartaPorte.getFull(companyId, documentId));
    if (!doc) throw new PermanentError('Documento de Carta Porte no encontrado.');
    await store.tx((r) => r.cartaPorte.setStatus(companyId, documentId, { status: 'Procesando', attempts: job.attempts }));
    try {
      const result = await stampCartaPorte({ folio: doc.folio, id_ccp: doc.id_ccp, document_data: JSON.parse(doc.document_data), xml_content: doc.xml_content });
      await store.tx((r) => r.cartaPorte.setStatus(companyId, documentId, { status: result.status, attempts: job.attempts, simulated: result.status === 'Simulado' ? 1 : 0, pacUuid: result.uuid || null, stampedXml: result.stampedXml || null, stampedAt: result.stampedAt || null }));
    } catch (e) {
      const final = e instanceof PermanentError || job.attempts >= job.max_attempts;
      await store.tx((r) => r.cartaPorte.setStatus(companyId, documentId, { status: final ? 'Error' : 'EnCola', attempts: job.attempts, error: e.message }));
      throw e;
    }
  }
  return { submit, get, list, stampedXml, stampJob };
}
module.exports = { createFiscalService };
