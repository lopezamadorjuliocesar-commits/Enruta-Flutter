-- 008_tracking: posiciones GPS (reales o simuladas) y estado del simulador de recorrido.
CREATE TABLE positions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  center_id   TEXT NOT NULL,
  route_id    TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  user_id     TEXT,
  lat         REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng         REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_m  REAL,
  speed_mps   REAL,
  heading     REAL,
  source      TEXT NOT NULL CHECK (source IN ('REAL','SIMULATED')),
  recorded_at TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE UNIQUE INDEX positions_dedupe_uq ON positions (route_id, source, recorded_at);
CREATE INDEX positions_route_idx ON positions (route_id, recorded_at DESC);

CREATE TABLE simulations (
  route_id   TEXT PRIMARY KEY REFERENCES routes(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('RUNNING','STOPPED','DONE')),
  speed_kmh  REAL NOT NULL,
  progress_m REAL NOT NULL DEFAULT 0,
  started_by TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
