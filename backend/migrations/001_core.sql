-- 001_core: empresas, centros, usuarios, RBAC, sesiones, auditoría, cola y bandeja local.
-- IDs: UUID v4 en TEXT. Fechas: ISO-8601 UTC en TEXT. Dinero (fases siguientes): centavos enteros.

CREATE TABLE companies (
  id                 TEXT PRIMARY KEY,
  rfc                TEXT NOT NULL,
  legal_name         TEXT NOT NULL,
  industry           TEXT,
  country            TEXT,
  timezone           TEXT NOT NULL DEFAULT 'America/Mexico_City',
  phone              TEXT,
  plan               TEXT NOT NULL DEFAULT 'Operación',
  fiscal_status      TEXT NOT NULL CHECK (fiscal_status IN ('PENDING','VERIFIED','SIMULATED')),
  fiscal_verified_at TEXT,
  status             TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX companies_rfc_uq ON companies (rfc);

CREATE TABLE centers (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  code       TEXT,
  status     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL,
  UNIQUE (company_id, name)
);

CREATE TABLE zones (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  center_id  TEXT NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (center_id, name)
);

CREATE TABLE permissions (
  code  TEXT PRIMARY KEY,
  grp   TEXT NOT NULL,
  label TEXT NOT NULL
);

CREATE TABLE roles (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  is_system       INTEGER NOT NULL DEFAULT 0,
  max_discount_bp INTEGER NOT NULL DEFAULT 0 CHECK (max_discount_bp BETWEEN 0 AND 10000),
  created_at      TEXT NOT NULL,
  UNIQUE (company_id, name)
);

CREATE TABLE role_permissions (
  role_id         TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email             TEXT NOT NULL,
  name              TEXT NOT NULL,
  phone             TEXT,
  password_hash     TEXT NOT NULL,
  role_id           TEXT NOT NULL REFERENCES roles(id),
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  failed_attempts   INTEGER NOT NULL DEFAULT 0,
  last_failed_at    TEXT,
  locked_until      TEXT,
  totp_secret_enc   TEXT,
  totp_enabled      INTEGER NOT NULL DEFAULT 0,
  default_center_id TEXT REFERENCES centers(id) ON DELETE SET NULL,
  avatar_path       TEXT,
  last_login_at     TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX users_email_uq ON users (email);
CREATE INDEX users_company_idx ON users (company_id, status);

CREATE TABLE user_centers (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  center_id TEXT NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, center_id)
);

CREATE TABLE sessions (
  id             TEXT PRIMARY KEY,
  token_hash     TEXT NOT NULL,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  center_id      TEXT REFERENCES centers(id) ON DELETE SET NULL,
  ua             TEXT,
  ip             TEXT,
  keep           INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  revoked_at     TEXT,
  revoked_reason TEXT
);
CREATE UNIQUE INDEX sessions_token_uq ON sessions (token_hash);
CREATE INDEX sessions_user_idx ON sessions (user_id, revoked_at);

CREATE TABLE password_reset_tokens (
  id         TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
CREATE UNIQUE INDEX password_reset_token_uq ON password_reset_tokens (token_hash);
CREATE INDEX password_reset_user_idx ON password_reset_tokens (user_id);

CREATE TABLE mfa_challenges (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  keep       INTEGER NOT NULL DEFAULT 0,
  ua         TEXT,
  ip         TEXT,
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Validación fiscal previa al alta de empresa. El token de validación es opaco (solo se guarda su hash).
CREATE TABLE company_validations (
  id               TEXT PRIMARY KEY,
  rfc              TEXT NOT NULL,
  legal_name       TEXT NOT NULL,
  name_hash        TEXT NOT NULL,
  cp               TEXT,
  status           TEXT NOT NULL CHECK (status IN ('VERIFIED','SIMULATED','REJECTED','MISMATCH','ERROR','TIMEOUT')),
  simulated        INTEGER NOT NULL DEFAULT 0,
  environment      TEXT NOT NULL,
  provider_message TEXT,
  token_hash       TEXT,
  token_expires_at TEXT,
  consumed_at      TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX company_validations_token_idx ON company_validations (token_hash);

-- Auditoría append-only con cadena de hashes por empresa (prev_hash → hash).
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  TEXT NOT NULL,
  center_id   TEXT,
  actor_id    TEXT,
  actor_name  TEXT,
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  detail      TEXT CHECK (detail IS NULL OR json_valid(detail)),
  ip          TEXT,
  created_at  TEXT NOT NULL,
  prev_hash   TEXT NOT NULL,
  hash        TEXT NOT NULL
);
CREATE INDEX audit_company_idx ON audit_log (company_id, id DESC);
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log es de solo agregar'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log es de solo agregar'); END;

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  center_id  TEXT,
  category   TEXT NOT NULL,
  title      TEXT NOT NULL,
  detail     TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX notifications_company_idx ON notifications (company_id, created_at DESC);

-- Bandeja de correo de DESARROLLO: los mensajes no salen del equipo (MAIL_MODE=local).
CREATE TABLE dev_mailbox (
  id         TEXT PRIMARY KEY,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  html       TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Cola persistente (sustituye a Redis/BullMQ). Ver DT-48.
CREATE TABLE jobs_queue (
  id           TEXT PRIMARY KEY,
  company_id   TEXT,
  type         TEXT NOT NULL,
  payload      TEXT NOT NULL CHECK (json_valid(payload)),
  status       TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','DEAD')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  run_at       TEXT NOT NULL,
  locked_by    TEXT,
  locked_until TEXT,
  last_error   TEXT,
  dedupe_key   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX jobs_dedupe_uq ON jobs_queue (type, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX jobs_claim_idx ON jobs_queue (status, run_at);
