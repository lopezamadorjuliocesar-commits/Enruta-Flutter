'use strict';
const { iso } = require('../../utils/ids');
const PUBLIC = 'id, folio, id_ccp, status, attempts, simulated, pac_uuid, pac_stamped_at, error_message, created_at, updated_at';

module.exports = function fiscalRepos(conn) {
  const get = (sql, ...p) => conn.prepare(sql).get(...p);
  const all = (sql, ...p) => conn.prepare(sql).all(...p);
  const run = (sql, ...p) => conn.prepare(sql).run(...p);
  return {
    cartaPorte: {
      async insertIgnore(d) {
        const t = iso();
        const r = run(`INSERT INTO carta_porte_documents (id,company_id,folio,id_ccp,document_data,xml_content,created_at,updated_at)
                       VALUES (@id,@companyId,@folio,@idCcp,@data,@xml,@t,@t) ON CONFLICT(company_id,id_ccp) DO NOTHING`, { ...d, data: JSON.stringify(d.data), t });
        return { inserted: r.changes === 1, doc: get(`SELECT ${PUBLIC} FROM carta_porte_documents WHERE company_id=? AND id_ccp=?`, d.companyId, d.idCcp) };
      },
      async getPublic(companyId, id) { return get(`SELECT ${PUBLIC} FROM carta_porte_documents WHERE company_id=? AND id=?`, companyId, id); },
      async getFull(companyId, id) { return get('SELECT * FROM carta_porte_documents WHERE company_id=? AND id=?', companyId, id); },
      async list(companyId, limit = 100) { return all(`SELECT ${PUBLIC} FROM carta_porte_documents WHERE company_id=? ORDER BY created_at DESC LIMIT ?`, companyId, limit); },
      async setStatus(companyId, id, s) {
        return run(`UPDATE carta_porte_documents SET status=@status, attempts=COALESCE(@attempts, attempts), simulated=COALESCE(@simulated, simulated), pac_uuid=@pacUuid,
                    stamped_xml=@stampedXml, pac_stamped_at=@stampedAt, error_message=@error, updated_at=@t WHERE company_id=@companyId AND id=@id`,
          { attempts: null, simulated: null, pacUuid: null, stampedXml: null, stampedAt: null, error: null, ...s, companyId, id, t: iso() }).changes;
      },
    },
  };
};
