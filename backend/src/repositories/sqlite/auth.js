'use strict';
const { iso } = require('../../utils/ids');

module.exports = function authRepos(conn) {
  const get = (sql, ...p) => conn.prepare(sql).get(...p);
  const all = (sql, ...p) => conn.prepare(sql).all(...p);
  const run = (sql, ...p) => conn.prepare(sql).run(...p);

  return {
    sessions: {
      async create(s) {
        run(`INSERT INTO sessions (id,token_hash,user_id,company_id,center_id,ua,ip,keep,created_at,last_seen_at,expires_at)
             VALUES (@id,@tokenHash,@userId,@companyId,@centerId,@ua,@ip,@keep,@createdAt,@createdAt,@expiresAt)`, { ua: null, ip: null, keep: 0, centerId: null, ...s });
        return get('SELECT * FROM sessions WHERE id=?', s.id);
      },
      async findByHash(hash) { return get('SELECT * FROM sessions WHERE token_hash=?', hash); },
      async get(id) { return get('SELECT * FROM sessions WHERE id=?', id); },
      async touch(id, at) { run('UPDATE sessions SET last_seen_at=? WHERE id=?', at, id); },
      async setCenter(id, centerId) { run('UPDATE sessions SET center_id=? WHERE id=?', centerId, id); },
      async revoke(id, reason, at = iso()) { return run('UPDATE sessions SET revoked_at=?, revoked_reason=? WHERE id=? AND revoked_at IS NULL', at, reason, id).changes; },
      async revokeAllForUser(userId, reason, exceptId = null, at = iso()) {
        return run('UPDATE sessions SET revoked_at=?, revoked_reason=? WHERE user_id=? AND revoked_at IS NULL AND id<>?', at, reason, userId, exceptId ?? '').changes;
      },
      async listActiveForUser(userId, now) {
        return all('SELECT * FROM sessions WHERE user_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC', userId, now);
      },
    },

    passwordResets: {
      async create(r) { run('INSERT INTO password_reset_tokens (id,token_hash,user_id,created_at,expires_at) VALUES (@id,@tokenHash,@userId,@createdAt,@expiresAt)', r); },
      async findByHash(hash) { return get('SELECT * FROM password_reset_tokens WHERE token_hash=?', hash); },
      /** Marca como usado de forma atómica: devuelve 1 solo para la primera petición. */
      async consume(id, at) { return run('UPDATE password_reset_tokens SET used_at=? WHERE id=? AND used_at IS NULL', at, id).changes; },
      async invalidateForUser(userId, at) { return run('UPDATE password_reset_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL', at, userId).changes; },
      async lastForUser(userId) { return get('SELECT * FROM password_reset_tokens WHERE user_id=? ORDER BY created_at DESC LIMIT 1', userId); },
    },

    mfaChallenges: {
      async create(c) { run('INSERT INTO mfa_challenges (id,user_id,keep,ua,ip,created_at,expires_at) VALUES (@id,@userId,@keep,@ua,@ip,@createdAt,@expiresAt)', { ua: null, ip: null, keep: 0, ...c }); },
      async get(id) { return get('SELECT * FROM mfa_challenges WHERE id=?', id); },
      async addAttempt(id) { run('UPDATE mfa_challenges SET attempts=attempts+1 WHERE id=?', id); },
      async delete(id) { run('DELETE FROM mfa_challenges WHERE id=?', id); },
    },

    validations: {
      async create(v) {
        run(`INSERT INTO company_validations (id,rfc,legal_name,name_hash,cp,status,simulated,environment,provider_message,token_hash,token_expires_at,created_at)
             VALUES (@id,@rfc,@legalName,@nameHash,@cp,@status,@simulated,@environment,@providerMessage,@tokenHash,@tokenExpiresAt,@createdAt)`,
          { cp: null, providerMessage: null, tokenHash: null, tokenExpiresAt: null, createdAt: iso(), ...v });
      },
      async findByTokenHash(hash) { return get('SELECT * FROM company_validations WHERE token_hash=?', hash); },
      async consume(id, at) { return run('UPDATE company_validations SET consumed_at=? WHERE id=? AND consumed_at IS NULL', at, id).changes; },
    },
  };
};
