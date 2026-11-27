-- 011_settlements: liquidación por ruta (DT-47). UNIQUE(route_id) impide la doble liquidación; una cerrada es inmutable.
CREATE TABLE settlements (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  center_id        TEXT NOT NULL,
  route_id         TEXT NOT NULL UNIQUE REFERENCES routes(id) ON DELETE RESTRICT,
  status           TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','BALANCED','WITHIN_TOLERANCE','PENDING_AUTHORIZATION','AUTHORIZED','REJECTED')),
  expected_cents   INTEGER NOT NULL CHECK (expected_cents >= 0),
  other_cents      INTEGER NOT NULL DEFAULT 0,          -- transferencias y tarjetas (informativo)
  deposited_cents  INTEGER NOT NULL DEFAULT 0,
  diff_cents       INTEGER NOT NULL DEFAULT 0,
  tolerance_cents  INTEGER,
  created_by       TEXT,
  submitted_by     TEXT,
  decided_by       TEXT,
  decision_reason  TEXT,
  created_at       TEXT NOT NULL,
  submitted_at     TEXT,
  decided_at       TEXT
);
CREATE INDEX settlements_scope_idx ON settlements (company_id, center_id, status);
CREATE TABLE settlement_deposits (
  id            TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  reference     TEXT,
  deposited_at  TEXT NOT NULL,
  created_by    TEXT,
  created_at    TEXT NOT NULL
);
