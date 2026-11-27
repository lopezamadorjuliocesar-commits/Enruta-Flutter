-- 009_pricing: listas de precios con vigencia, promociones y descuentos con nombre (DT-46).
CREATE TABLE price_lists (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  priority    INTEGER NOT NULL DEFAULT 0,
  valid_from  TEXT,
  valid_to    TEXT,
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX price_lists_name_uq ON price_lists (company_id, name COLLATE NOCASE);
CREATE TABLE price_list_items (
  list_id     TEXT NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  PRIMARY KEY (list_id, product_id)
);
CREATE TABLE price_list_clients (
  list_id   TEXT NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  PRIMARY KEY (list_id, client_id)
);
CREATE INDEX price_list_clients_client_idx ON price_list_clients (client_id);

CREATE TABLE promotions (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  product_id TEXT REFERENCES products(id) ON DELETE CASCADE,        -- NULL = todos los productos
  kind       TEXT NOT NULL CHECK (kind IN ('PERCENT','AMOUNT')),
  value      INTEGER NOT NULL CHECK (value > 0),                    -- PERCENT: puntos base (1000 = 10 %) · AMOUNT: centavos por unidad
  valid_from TEXT,
  valid_to   TEXT,
  status     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX promotions_company_idx ON promotions (company_id, status);

CREATE TABLE discount_rules (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  percent_bp  INTEGER NOT NULL CHECK (percent_bp BETWEEN 1 AND 10000),
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX discount_rules_name_uq ON discount_rules (company_id, name COLLATE NOCASE);

ALTER TABLE delivery_lines ADD COLUMN list_price_cents INTEGER;
ALTER TABLE delivery_lines ADD COLUMN promo_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE delivery_lines ADD COLUMN price_source TEXT;
