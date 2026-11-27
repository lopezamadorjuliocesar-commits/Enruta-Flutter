'use strict';
const { iso, sha256, uuid } = require('../../utils/ids');

const GENESIS = '0'.repeat(64);
const canonical = (e) => JSON.stringify([e.company_id, e.center_id, e.actor_id, e.actor_name, e.action, e.entity, e.entity_id, e.detail, e.ip, e.created_at, e.prev_hash]);

module.exports = function systemRepos(conn) {
  const get = (sql, ...p) => conn.prepare(sql).get(...p);
  const all = (sql, ...p) => conn.prepare(sql).all(...p);
  const run = (sql, ...p) => conn.prepare(sql).run(...p);

  return {
    audit: {
      async append(e) {
        const row = {
          company_id: e.companyId, center_id: e.centerId ?? null, actor_id: e.actorId ?? null, actor_name: e.actorName ?? null,
          action: e.action, entity: e.entity ?? null, entity_id: e.entityId ?? null,
          detail: e.detail === undefined || e.detail === null ? null : JSON.stringify(e.detail), ip: e.ip ?? null, created_at: e.createdAt ?? iso(),
        };
        row.prev_hash = get('SELECT hash FROM audit_log WHERE company_id=? ORDER BY id DESC LIMIT 1', row.company_id)?.hash ?? GENESIS;
        row.hash = sha256(canonical(row));
        run(`INSERT INTO audit_log (company_id,center_id,actor_id,actor_name,action,entity,entity_id,detail,ip,created_at,prev_hash,hash)
             VALUES (@company_id,@center_id,@actor_id,@actor_name,@action,@entity,@entity_id,@detail,@ip,@created_at,@prev_hash,@hash)`, row);
      },
      async list(companyId, { from, to, actorId, action, entity, q, centerIds, limit = 100, offset = 0 } = {}) {
        const where = ['company_id=@companyId']; const p = { companyId, limit: Math.min(Math.max(Number(limit) || 100, 1), 500), offset: Math.max(Number(offset) || 0, 0) };
        if (from) { where.push('created_at>=@from'); p.from = from; }
        if (to) { where.push('created_at<=@to'); p.to = to; }
        if (actorId) { where.push('actor_id=@actorId'); p.actorId = actorId; }
        if (action) { where.push('action LIKE @action'); p.action = `${action}%`; }
        if (entity) { where.push('entity=@entity'); p.entity = entity; }
        if (q) { where.push('(action LIKE @q OR actor_name LIKE @q OR entity_id LIKE @q OR detail LIKE @q)'); p.q = `%${q}%`; }
        if (centerIds) { if (!centerIds.length) return []; where.push(`(center_id IS NULL OR center_id IN (${centerIds.map((c, i) => { p[`c${i}`] = c; return `@c${i}`; }).join(',')}))`); }
        return all(`SELECT * FROM audit_log WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT @limit OFFSET @offset`, p)
          .map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
      },
      /** Recalcula la cadena de hashes de la empresa. */
      async verifyChain(companyId) {
        let prev = GENESIS;
        for (const r of all('SELECT * FROM audit_log WHERE company_id=? ORDER BY id', companyId)) {
          if (r.prev_hash !== prev || sha256(canonical(r)) !== r.hash) return { ok: false, brokenAt: r.id };
          prev = r.hash;
        }
        return { ok: true };
      },
    },

    notifications: {
      async add(n) {
        const row = { id: uuid(), centerId: null, detail: null, createdAt: iso(), ...n };
        run('INSERT INTO notifications (id,company_id,center_id,category,title,detail,created_at) VALUES (@id,@companyId,@centerId,@category,@title,@detail,@createdAt)', row);
        return row.id;
      },
      async list(companyId, { category, centerIds, limit = 100 } = {}) {
        const where = ['company_id=@companyId']; const p = { companyId, limit: Math.min(Number(limit) || 100, 500) };
        if (category && category !== 'Todas') { where.push('category=@category'); p.category = category; }
        if (centerIds) { if (!centerIds.length) return []; where.push(`(center_id IS NULL OR center_id IN (${centerIds.map((c, i) => { p[`c${i}`] = c; return `@c${i}`; }).join(',')}))`); }
        return all(`SELECT * FROM notifications WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT @limit`, p);
      },
      async markRead(companyId, id, at) { return run('UPDATE notifications SET read_at=? WHERE company_id=? AND id=? AND read_at IS NULL', at, companyId, id).changes; },
    },

    mailbox: {
      async add(m) { run('INSERT INTO dev_mailbox (id,to_email,subject,html,text,created_at) VALUES (@id,@to,@subject,@html,@text,@createdAt)', { id: uuid(), createdAt: iso(), ...m }); },
      async list(limit = 50, to = null) {
        return to ? all('SELECT * FROM dev_mailbox WHERE to_email=? ORDER BY created_at DESC, rowid DESC LIMIT ?', to, limit) : all('SELECT * FROM dev_mailbox ORDER BY created_at DESC, rowid DESC LIMIT ?', limit);
      },
      async clear() { run('DELETE FROM dev_mailbox'); },
    },

    jobs: {
      async enqueue(j) {
        const row = { id: uuid(), companyId: null, dedupeKey: null, maxAttempts: 5, ...j };
        const res = run(`INSERT INTO jobs_queue (id,company_id,type,payload,max_attempts,run_at,dedupe_key,created_at,updated_at)
                         VALUES (@id,@companyId,@type,@payload,@maxAttempts,@runAt,@dedupeKey,@now,@now) ON CONFLICT DO NOTHING`, { ...row, payload: JSON.stringify(row.payload) });
        return res.changes ? get('SELECT * FROM jobs_queue WHERE id=?', row.id) : get('SELECT * FROM jobs_queue WHERE type=? AND dedupe_key=?', row.type, row.dedupeKey);
      },
      async claim({ now, lockedBy, lockedUntil, types }) {
        const typeFilter = types?.length ? `AND type IN (${types.map(() => '?').join(',')})` : '';
        return get(`UPDATE jobs_queue SET status='RUNNING', attempts=attempts+1, locked_by=?, locked_until=?, updated_at=?
                    WHERE id=(SELECT id FROM jobs_queue WHERE status='PENDING' AND run_at<=? ${typeFilter} ORDER BY run_at, created_at LIMIT 1) RETURNING *`,
          lockedBy, lockedUntil, now, now, ...(types || []));
      },
      async succeed(id, now, scrub = false) { run(`UPDATE jobs_queue SET status='SUCCEEDED', locked_by=NULL, locked_until=NULL, last_error=NULL, payload=CASE WHEN ? THEN '{}' ELSE payload END, updated_at=? WHERE id=?`, scrub ? 1 : 0, now, id); },
      async fail(id, { error, dead, runAt, now }) {
        run(`UPDATE jobs_queue SET status=?, run_at=COALESCE(?, run_at), locked_by=NULL, locked_until=NULL, last_error=?, updated_at=? WHERE id=?`, dead ? 'DEAD' : 'PENDING', dead ? null : runAt, String(error).slice(0, 1000), now, id);
      },
      /** Trabajos RUNNING con lease vencido (el proceso murió): vuelven a PENDING, o a DEAD si ya no quedan intentos. */
      async recoverExpired(now) {
        const dead = run(`UPDATE jobs_queue SET status='DEAD', locked_by=NULL, locked_until=NULL, last_error='Se agotaron los intentos tras un cierre inesperado del servidor.', updated_at=?
                          WHERE status='RUNNING' AND locked_until<? AND attempts>=max_attempts`, now, now).changes;
        const back = run(`UPDATE jobs_queue SET status='PENDING', locked_by=NULL, locked_until=NULL, updated_at=? WHERE status='RUNNING' AND locked_until<?`, now, now).changes;
        return { recovered: back, dead };
      },
      async get(id) { return get('SELECT * FROM jobs_queue WHERE id=?', id); },
      async list({ status, type, companyId, limit = 100 } = {}) {
        const where = []; const p = [];
        if (status) { where.push('status=?'); p.push(status); } if (type) { where.push('type=?'); p.push(type); } if (companyId) { where.push('company_id=?'); p.push(companyId); }
        return all(`SELECT * FROM jobs_queue ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`, ...p, limit);
      },
      async stats() {
        const out = { PENDING: 0, RUNNING: 0, SUCCEEDED: 0, DEAD: 0 };
        for (const r of all('SELECT status, COUNT(*) n FROM jobs_queue GROUP BY status')) out[r.status] = r.n;
        return out;
      },
    },
  };
};
