-- 005_routes: ciclo de rutas con revisiones y aprobaciones versionadas; precio/descripcion de producto (interino hasta las listas de precios).
ALTER TABLE products ADD COLUMN description TEXT;
ALTER TABLE products ADD COLUMN price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0);

CREATE TABLE routes (
  id                   TEXT PRIMARY KEY,
  company_id           TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  center_id            TEXT NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  zone_id              TEXT REFERENCES zones(id) ON DELETE SET NULL,
  name                 TEXT NOT NULL,
  day                  TEXT,
  color                TEXT,
  operator_user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  vehicle_id           TEXT REFERENCES vehicles(id) ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_APPROVAL','PUBLISHED','IN_PROGRESS','COMPLETED','CANCELLED')),
  -- Cada edicion relevante incrementa `revision`. La aprobacion es de UNA revision: approved_revision.
  revision             INTEGER NOT NULL DEFAULT 1,
  approved_revision    INTEGER,
  last_decision        TEXT CHECK (last_decision IS NULL OR last_decision IN ('REJECTED')),
  last_decision_reason TEXT,
  started_at           TEXT,
  finished_at          TEXT,
  created_by           TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE UNIQUE INDEX routes_company_name_uq ON routes (company_id, lower(name));
CREATE INDEX routes_scope_idx ON routes (company_id, center_id, status);
CREATE INDEX routes_operator_idx ON routes (operator_user_id, status);

CREATE TABLE route_stops (
  route_id  TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  seq       INTEGER NOT NULL,
  PRIMARY KEY (route_id, client_id)
);
CREATE INDEX route_stops_seq_idx ON route_stops (route_id, seq);

CREATE TABLE route_approvals (
  id           TEXT PRIMARY KEY,
  route_id     TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  revision     INTEGER NOT NULL,
  requested_by TEXT,
  requested_at TEXT NOT NULL,
  decided_by   TEXT,
  decided_at   TEXT,
  decision     TEXT NOT NULL DEFAULT 'PENDING' CHECK (decision IN ('PENDING','APPROVED','REJECTED','INVALIDATED')),
  reason       TEXT,
  self_approved INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX route_approvals_route_idx ON route_approvals (route_id, requested_at DESC);

CREATE TABLE route_status_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id    TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  revision    INTEGER NOT NULL,
  actor_id    TEXT,
  note        TEXT,
  at          TEXT NOT NULL
);
CREATE INDEX route_history_route_idx ON route_status_history (route_id, id);
