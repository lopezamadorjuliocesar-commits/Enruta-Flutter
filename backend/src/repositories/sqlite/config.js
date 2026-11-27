'use strict';
const { iso } = require('../../utils/ids');

module.exports = function configRepos(conn) {
  const get = (sql, ...p) => conn.prepare(sql).get(...p);
  const all = (sql, ...p) => conn.prepare(sql).all(...p);
  const run = (sql, ...p) => conn.prepare(sql).run(...p);
  return {
    config: {
      async draft(companyId) { return get(`SELECT * FROM config_versions WHERE company_id=? AND status='DRAFT'`, companyId); },
      async createDraft(d) { run(`INSERT INTO config_versions (id,company_id,status,payload,created_at,updated_at) VALUES (@id,@companyId,'DRAFT',@payload,@t,@t)`, { ...d, t: iso() }); return get('SELECT * FROM config_versions WHERE id=?', d.id); },
      async saveDraft(companyId, payload) { run(`UPDATE config_versions SET payload=?, updated_at=? WHERE company_id=? AND status='DRAFT'`, payload, iso(), companyId); },
      async published(companyId) { return get(`SELECT * FROM config_versions WHERE company_id=? AND status='PUBLISHED'`, companyId); },
      async version(companyId, version) { return get(`SELECT * FROM config_versions WHERE company_id=? AND version=? AND status IN ('PUBLISHED','SUPERSEDED')`, companyId, version); },
      async versions(companyId) { return all(`SELECT id, version, status, note, published_by, published_at FROM config_versions WHERE company_id=? AND version IS NOT NULL ORDER BY version DESC`, companyId); },
      async maxVersion(companyId) { return get('SELECT COALESCE(MAX(version),0) v FROM config_versions WHERE company_id=?', companyId).v; },
      async supersedePublished(companyId) { run(`UPDATE config_versions SET status='SUPERSEDED' WHERE company_id=? AND status='PUBLISHED'`, companyId); },
      async insertPublished(v) { run(`INSERT INTO config_versions (id,company_id,version,status,payload,note,published_by,published_at,created_at,updated_at) VALUES (@id,@companyId,@version,'PUBLISHED',@payload,@note,@by,@at,@at,@at)`, v); },
      async ack(companyId, deviceId, version, at) { run('INSERT INTO config_acks (company_id,device_id,version,acked_at) VALUES (?,?,?,?) ON CONFLICT(device_id,version) DO NOTHING', companyId, deviceId, version, at); },
      async ackedCount(companyId, version) { return get('SELECT COUNT(*) n FROM config_acks WHERE company_id=? AND version=?', companyId, version).n; },
      /** Dispositivos que pueden confirmar: vinculados, activos y con credencial vigente. */
      async eligibleDevices(companyId) { return all(`SELECT d.id, d.alias FROM devices d WHERE d.company_id=? AND d.status='Activo' AND EXISTS (SELECT 1 FROM device_sessions s WHERE s.device_id=d.id AND s.revoked_at IS NULL)`, companyId); },
      async ackedDevices(companyId, version) { return all('SELECT device_id FROM config_acks WHERE company_id=? AND version=?', companyId, version).map((r) => r.device_id); },
      async scopeExists(companyId, type, id) {
        const q = { CENTRO: 'SELECT 1 x FROM centers WHERE company_id=? AND id=?', ZONA: 'SELECT 1 x FROM zones WHERE company_id=? AND id=?', RUTA: 'SELECT 1 x FROM routes WHERE company_id=? AND id=?', USUARIO: 'SELECT 1 x FROM users WHERE company_id=? AND id=?' }[type];
        return !!(q && get(q, companyId, id));
      },
    },
  };
};
