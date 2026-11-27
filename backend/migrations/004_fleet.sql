-- 004_fleet: conductores, vehículos, dispositivos y vinculación por QR (puerto del esquema PostgreSQL).
-- La Fase 2 amplía esto (revocación, confirmación en tiempo real, sesiones de dispositivo en uso).
CREATE TABLE drivers (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX drivers_company_email_uq ON drivers (company_id, lower(email)) WHERE email IS NOT NULL;

CREATE TABLE vehicles (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plate       TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX vehicles_company_plate_uq ON vehicles (company_id, upper(plate));

CREATE TABLE devices (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  alias          TEXT NOT NULL,
  imei_serial    TEXT NOT NULL,
  brand          TEXT,
  model          TEXT,
  os             TEXT,
  os_version     TEXT,
  phone          TEXT,
  driver_id      TEXT REFERENCES drivers(id) ON DELETE SET NULL,
  vehicle_id     TEXT REFERENCES vehicles(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'Activo' CHECK (status IN ('Activo','Inactivo','Reparación','Robado')),
  fcm_token      TEXT,
  reported_model TEXT,
  reported_os    TEXT,
  linked_at      TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX devices_company_imei_uq ON devices (company_id, upper(imei_serial));
CREATE UNIQUE INDEX devices_company_driver_uq ON devices (company_id, driver_id) WHERE driver_id IS NOT NULL;
CREATE UNIQUE INDEX devices_company_vehicle_uq ON devices (company_id, vehicle_id) WHERE vehicle_id IS NOT NULL;

-- Token de vinculación (opaco, solo su hash; un solo uso; 15 min). device_id NULL = QR genérico: el dispositivo se crea al escanear.
CREATE TABLE device_link_tokens (
  id                TEXT PRIMARY KEY,
  token_hash        TEXT NOT NULL,
  company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  device_id         TEXT REFERENCES devices(id) ON DELETE CASCADE,
  created_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  expires_at        TEXT NOT NULL,
  used_at           TEXT,
  created_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX device_link_tokens_hash_uq ON device_link_tokens (token_hash);

CREATE TABLE device_links (
  id         TEXT PRIMARY KEY,
  device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  driver_id  TEXT REFERENCES drivers(id) ON DELETE SET NULL,
  model      TEXT,
  os         TEXT,
  fcm_token  TEXT,
  linked_at  TEXT NOT NULL
);

-- Credencial del dispositivo vinculado (Bearer del contrato móvil). Solo se guarda el hash.
CREATE TABLE device_sessions (
  id         TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE UNIQUE INDEX device_sessions_hash_uq ON device_sessions (token_hash);
