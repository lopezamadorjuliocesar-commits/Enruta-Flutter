-- 010_inventory: stock por centro, carga por ruta (nunca negativo), preventa, comodato y auditoría de exhibición (DT-46b).
CREATE TABLE center_stock (
  center_id  TEXT NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  qty        INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  min_qty    INTEGER NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (center_id, product_id)
);
CREATE TABLE stock_movements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    TEXT NOT NULL,
  center_id     TEXT NOT NULL,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta         INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reason        TEXT NOT NULL CHECK (reason IN ('ADJUST','ROUTE_LOAD','ROUTE_RETURN')),
  route_id      TEXT,
  note          TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX stock_movements_idx ON stock_movements (company_id, center_id, product_id, id DESC);
CREATE TABLE route_loads (
  route_id     TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  product_id   TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty_loaded   INTEGER NOT NULL DEFAULT 0 CHECK (qty_loaded >= 0),
  qty_sold     INTEGER NOT NULL DEFAULT 0 CHECK (qty_sold >= 0),
  qty_returned INTEGER NOT NULL DEFAULT 0 CHECK (qty_returned >= 0),
  PRIMARY KEY (route_id, product_id),
  CHECK (qty_sold + qty_returned <= qty_loaded)
);

-- Preventa: pedido anticipado; no mueve stock hasta su entrega.
CREATE TABLE orders (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  center_id   TEXT NOT NULL,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  status      TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DELIVERED','PARTIAL','CANCELLED')),
  notes       TEXT,
  delivered_visit_id TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX orders_client_idx ON orders (company_id, client_id, status);
CREATE TABLE order_lines (
  order_id   TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty        INTEGER NOT NULL CHECK (qty > 0),
  qty_delivered INTEGER NOT NULL DEFAULT 0 CHECK (qty_delivered >= 0),
  PRIMARY KEY (order_id, product_id)
);

-- Comodato: activos prestados a clientes (refrigeradores, exhibidores).
CREATE TABLE assets (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  center_id  TEXT NOT NULL,
  code       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  description TEXT,
  status     TEXT NOT NULL DEFAULT 'IN_STOCK' CHECK (status IN ('IN_STOCK','LOANED','RETIRED')),
  client_id  TEXT REFERENCES clients(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((status = 'LOANED') = (client_id IS NOT NULL))
);
CREATE UNIQUE INDEX assets_code_uq ON assets (company_id, code COLLATE NOCASE);
CREATE TABLE asset_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id TEXT NOT NULL,
  asset_id   TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('LOAN','RETURN','VERIFIED','MISSING','RETIRE')),
  client_id  TEXT,
  visit_id   TEXT,
  note       TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

-- Auditoría de exhibición: frentes de producto observados en la visita.
CREATE TABLE display_audits (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  visit_id   TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE UNIQUE,
  client_id  TEXT NOT NULL,
  notes      TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE display_audit_lines (
  audit_id        TEXT NOT NULL REFERENCES display_audits(id) ON DELETE CASCADE,
  product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  fronts          INTEGER NOT NULL CHECK (fronts >= 0),
  expected_fronts INTEGER CHECK (expected_fronts IS NULL OR expected_fronts >= 0),
  PRIMARY KEY (audit_id, product_id)
);
