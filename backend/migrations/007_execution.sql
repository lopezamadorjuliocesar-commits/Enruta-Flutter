-- 007_execution: visitas, entregas, cobros, saldo del cliente, evidencias en disco, incidencias e idempotencia.
CREATE TABLE visits (
  id                    TEXT PRIMARY KEY,
  company_id            TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  center_id             TEXT NOT NULL,
  route_id              TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  client_id             TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  seq                   INTEGER NOT NULL,
  status                TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','SKIPPED')),
  arrived_at            TEXT,
  lat                   REAL,
  lng                   REAL,
  distance_m            REAL,
  outside_radius_reason TEXT,
  skip_reason           TEXT,
  closed_at             TEXT,
  form_version          INTEGER,
  form_data             TEXT CHECK (form_data IS NULL OR json_valid(form_data)),
  created_by            TEXT,
  created_at            TEXT NOT NULL
);
CREATE UNIQUE INDEX visits_route_client_uq ON visits (route_id, client_id);

CREATE TABLE deliveries (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  visit_id        TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  status          TEXT NOT NULL CHECK (status IN ('DELIVERED','PARTIAL','FAILED')),
  incident_reason TEXT,
  notes           TEXT,
  form_version    INTEGER,
  form_data       TEXT CHECK (form_data IS NULL OR json_valid(form_data)),
  total_cents     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX deliveries_visit_uq ON deliveries (visit_id);

CREATE TABLE delivery_lines (
  delivery_id      TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  product_id       TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty_planned      INTEGER NOT NULL CHECK (qty_planned >= 0),
  qty_delivered    INTEGER NOT NULL CHECK (qty_delivered >= 0),
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  discount_bp      INTEGER NOT NULL DEFAULT 0 CHECK (discount_bp BETWEEN 0 AND 10000),
  reason           TEXT,
  PRIMARY KEY (delivery_id, product_id)
);

CREATE TABLE evidences (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  visit_id   TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('PHOTO','SIGNATURE')),
  path       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  sha256     TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX evidences_visit_idx ON evidences (visit_id);

CREATE TABLE payments (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  route_id     TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  visit_id     TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  method       TEXT NOT NULL CHECK (method IN ('CASH','TRANSFER','CARD')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reference    TEXT,
  form_data    TEXT CHECK (form_data IS NULL OR json_valid(form_data)),
  created_by   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX payments_route_idx ON payments (route_id);

-- Saldo del cliente: cargos (entregas) y abonos (cobros). Saldo pendiente = cargos − abonos.
CREATE TABLE client_ledger (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id    TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  kind         TEXT NOT NULL CHECK (kind IN ('CHARGE','PAYMENT')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  route_id     TEXT,
  visit_id     TEXT,
  ref_id       TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX ledger_client_idx ON client_ledger (client_id, created_at);

CREATE TABLE incidents (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  route_id   TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  visit_id   TEXT,
  reason     TEXT NOT NULL,
  detail     TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

-- Idempotencia de las acciones del repartidor: la misma clave + el mismo cuerpo devuelve la misma respuesta (doble clic, reintento de red).
CREATE TABLE idempotency_keys (
  company_id   TEXT NOT NULL,
  key          TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code  INTEGER,
  response     TEXT,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (company_id, key)
);
