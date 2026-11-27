-- 002_catalog: clientes (alcance por centro) y productos (alcance por empresa).
-- Base mínima para demostrar el aislamiento por empresa/centro; el resto del catálogo llega en la Fase 2.
CREATE TABLE clients (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  center_id  TEXT NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  zone_id    TEXT REFERENCES zones(id) ON DELETE SET NULL,
  code       TEXT,
  name       TEXT NOT NULL,
  rfc        TEXT,
  address    TEXT,
  lat        REAL CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lng        REAL CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  phone      TEXT,
  status     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX clients_company_code_uq ON clients (company_id, code) WHERE code IS NOT NULL;
CREATE INDEX clients_scope_idx ON clients (company_id, center_id, status);

CREATE TABLE products (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sku        TEXT NOT NULL,
  name       TEXT NOT NULL,
  category   TEXT,
  unit       TEXT NOT NULL DEFAULT 'pieza',
  status     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX products_company_sku_uq ON products (company_id, sku);
