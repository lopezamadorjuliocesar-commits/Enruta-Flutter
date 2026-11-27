-- 006_settings: configuración versionada (Borrador / Publicada), formularios y parámetros por herencia; confirmación de recepción por dispositivo.
-- La configuración completa (módulos, formularios, parámetros por ámbito) viaja en `payload` y se publica como una versión inmutable.
CREATE TABLE config_versions (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  version      INTEGER,
  status       TEXT NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','SUPERSEDED')),
  payload      TEXT NOT NULL CHECK (json_valid(payload)),
  note         TEXT,
  published_by TEXT,
  published_at TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX config_one_draft_uq ON config_versions (company_id) WHERE status = 'DRAFT';
CREATE UNIQUE INDEX config_version_uq ON config_versions (company_id, version) WHERE version IS NOT NULL;

CREATE TABLE config_acks (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  acked_at   TEXT NOT NULL,
  PRIMARY KEY (device_id, version)
);
