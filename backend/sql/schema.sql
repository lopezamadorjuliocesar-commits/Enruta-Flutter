CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS drivers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company    TEXT NOT NULL,
  name       TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS drivers_company_email_uq ON drivers (company, lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS vehicles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company     TEXT NOT NULL,
  plate       TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_company_plate_uq ON vehicles (company, upper(plate));

CREATE TABLE IF NOT EXISTS devices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company             TEXT NOT NULL,
  alias               TEXT NOT NULL,
  imei_serial         TEXT NOT NULL,
  brand               TEXT,
  model               TEXT,
  os                  TEXT,
  os_version          TEXT,
  phone               TEXT,
  driver_id           UUID REFERENCES drivers(id) ON DELETE SET NULL,
  vehicle_id          UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'Activo' CHECK (status IN ('Activo','Inactivo','Reparación','Robado')),
  fcm_token           TEXT,
  reported_model      TEXT,
  reported_os         TEXT,
  linked_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS devices_company_imei_uq ON devices (company, upper(imei_serial));
CREATE UNIQUE INDEX IF NOT EXISTS devices_company_driver_uq ON devices (company, driver_id) WHERE driver_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS devices_company_vehicle_uq ON devices (company, vehicle_id) WHERE vehicle_id IS NOT NULL;

-- Tokens de vinculación QR (un solo uso, 15 min)
CREATE TABLE IF NOT EXISTS device_link_tokens (
  jti        UUID PRIMARY KEY,
  device_id  UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_link_tokens_device_idx ON device_link_tokens (device_id);

-- Historial de asociaciones hardware <-> conductor
CREATE TABLE IF NOT EXISTS device_links (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id  UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  driver_id  UUID REFERENCES drivers(id) ON DELETE SET NULL,
  model      TEXT,
  os         TEXT,
  fcm_token  TEXT,
  linked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Validación fiscal de empresas (RFC) =====
CREATE TABLE IF NOT EXISTS company_validations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfc              TEXT NOT NULL,
  razon_social     TEXT NOT NULL,
  cp               TEXT,
  request_hash     TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('VERIFIED','REJECTED','MISMATCH','SIMULATED')),
  provider_valid   BOOLEAN,
  provider_message TEXT,
  simulated        BOOLEAN NOT NULL DEFAULT false,
  environment      TEXT NOT NULL,
  quota_remaining  INTEGER,
  provider_http    INTEGER,
  consumed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_validations_hash_idx ON company_validations (request_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS companies (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfc                TEXT NOT NULL,
  razon_social       TEXT NOT NULL,
  giro               TEXT,
  country            TEXT,
  timezone           TEXT,
  admin_name         TEXT,
  admin_email        TEXT NOT NULL,
  phone              TEXT,
  fiscal_status      TEXT NOT NULL DEFAULT 'PENDING' CHECK (fiscal_status IN ('PENDING','VERIFIED','SIMULATED')),
  fiscal_verified_at TIMESTAMPTZ,
  validation_id      UUID REFERENCES company_validations(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS companies_rfc_uq ON companies (upper(rfc));
CREATE UNIQUE INDEX IF NOT EXISTS companies_admin_email_uq ON companies (lower(admin_email));
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_fiscal_status_check;
ALTER TABLE companies ADD CONSTRAINT companies_fiscal_status_check CHECK (fiscal_status IN ('PENDING','VERIFIED','SIMULATED'));

-- QR de vinculación sin configuración previa: el dispositivo se crea cuando la app móvil escanea el código
ALTER TABLE device_link_tokens ALTER COLUMN device_id DROP NOT NULL;
ALTER TABLE device_link_tokens ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE device_link_tokens ADD COLUMN IF NOT EXISTS created_device_id UUID REFERENCES devices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS device_link_tokens_company_idx ON device_link_tokens (company);

-- CFDI con complemento Carta Porte y sus reintentos asíncronos mediante Redis/BullMQ.
CREATE TABLE IF NOT EXISTS carta_porte_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company         TEXT NOT NULL,
  folio           TEXT NOT NULL,
  id_ccp          TEXT NOT NULL,
  document_data   JSONB NOT NULL,
  xml_content     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'EnCola'
                  CHECK (status IN ('EnCola', 'Procesando', 'Timbrado', 'Simulado', 'Error')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  pac_uuid        TEXT,
  stamped_xml     TEXT,
  pac_stamped_at  TIMESTAMPTZ,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company, id_ccp)
);
CREATE INDEX IF NOT EXISTS carta_porte_documents_company_idx
  ON carta_porte_documents (company, created_at DESC);
