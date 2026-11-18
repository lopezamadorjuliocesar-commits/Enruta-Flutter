-- 003_fiscal: CFDI con complemento Carta Porte (puerto del esquema PostgreSQL a SQLite).
-- `simulated=1` significa que NO hubo timbrado real: no existe UUID fiscal ni validez fiscal.
CREATE TABLE carta_porte_documents (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  folio          TEXT NOT NULL,
  id_ccp         TEXT NOT NULL,
  document_data  TEXT NOT NULL CHECK (json_valid(document_data)),
  xml_content    TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'EnCola' CHECK (status IN ('EnCola','Procesando','Timbrado','Simulado','Error')),
  attempts       INTEGER NOT NULL DEFAULT 0,
  simulated      INTEGER NOT NULL DEFAULT 0,
  pac_uuid       TEXT,
  stamped_xml    TEXT,
  pac_stamped_at TEXT,
  error_message  TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (company_id, id_ccp)
);
CREATE INDEX carta_porte_company_idx ON carta_porte_documents (company_id, created_at DESC);
