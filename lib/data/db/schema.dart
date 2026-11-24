/// Esquema SQLite versionado.
///
/// v1: versión original de la app, solo `sync_queue` (cola en memoria persistida).
/// v2: modelo operativo completo. La migración 1→2 conserva las operaciones de
///     `sync_queue` copiándolas a `outbox` antes de eliminar la tabla antigua.
/// v3: `file_blobs` para guardar fotos y firmas dentro de SQLite cuando la
///     plataforma no tiene sistema de archivos (web).
const schemaVersion = 3;

const schemaV3 = [
  '''CREATE TABLE file_blobs(
    rel_path TEXT PRIMARY KEY,
    bytes BLOB NOT NULL,
    created_at INTEGER NOT NULL
  )''',
];

/// DDL de la versión 1 (se usa en pruebas de migración y para documentarla).
const schemaV1 = [
  '''CREATE TABLE sync_queue(
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
  )''',
];

const schemaV2 = [
  '''CREATE TABLE app_settings(
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )''',
  '''CREATE TABLE folio_counters(
    prefix TEXT PRIMARY KEY,
    next INTEGER NOT NULL
  )''',
  '''CREATE TABLE companies(
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    initials TEXT NOT NULL,
    cash_tolerance_cents INTEGER NOT NULL DEFAULT 0 CHECK(cash_tolerance_cents >= 0),
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )''',
  '''CREATE TABLE customers(
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    contact_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    credit_limit_cents INTEGER NOT NULL DEFAULT 0 CHECK(credit_limit_cents >= 0),
    payment_terms_days INTEGER NOT NULL DEFAULT 0,
    visit_days TEXT NOT NULL DEFAULT '',
    schedule TEXT NOT NULL DEFAULT '',
    is_demo INTEGER NOT NULL DEFAULT 0,
    UNIQUE(company_id, code)
  )''',
  '''CREATE TABLE addresses(
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    line TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT '',
    lat REAL,
    lng REAL,
    is_default INTEGER NOT NULL DEFAULT 0
  )''',
  'CREATE INDEX idx_addresses_customer ON addresses(customer_id)',
  '''CREATE TABLE users(
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    username TEXT NOT NULL COLLATE NOCASE,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE,
    role TEXT NOT NULL CHECK(role IN ('driver','client','supervisor')),
    customer_id TEXT REFERENCES customers(id),
    pin_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('unverified','pending','approved','rejected')),
    is_demo INTEGER NOT NULL DEFAULT 0,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER,
    review_note TEXT,
    reviewed_at INTEGER,
    created_at INTEGER NOT NULL,
    UNIQUE(company_id, username),
    UNIQUE(company_id, phone),
    UNIQUE(company_id, email),
    CHECK(role <> 'client' OR customer_id IS NOT NULL)
  )''',
  '''CREATE TABLE invitations(
    code TEXT PRIMARY KEY COLLATE NOCASE,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    customer_id TEXT REFERENCES customers(id),
    max_uses INTEGER NOT NULL DEFAULT 1,
    uses INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER
  )''',
  '''CREATE TABLE verification_codes(
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK(purpose IN ('register','recover')),
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    verified_at INTEGER,
    consumed_at INTEGER,
    created_at INTEGER NOT NULL
  )''',
  'CREATE INDEX idx_codes_user ON verification_codes(user_id, purpose)',
  '''CREATE TABLE local_messages(
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    recipient TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )''',
  '''CREATE TABLE products(
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    presentation TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    ean TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    promo TEXT,
    UNIQUE(company_id, sku),
    UNIQUE(company_id, ean)
  )''',
  '''CREATE TABLE vehicles(
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    unit_code TEXT NOT NULL,
    plate TEXT NOT NULL,
    odometer_km INTEGER NOT NULL DEFAULT 0,
    UNIQUE(company_id, unit_code)
  )''',
  '''CREATE TABLE workdays(
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    driver_id TEXT NOT NULL REFERENCES users(id),
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    route_code TEXT NOT NULL,
    service_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('planned','loaded','inRoute','closed')),
    start_km INTEGER,
    end_km INTEGER,
    load_confirmed_at INTEGER,
    departed_at INTEGER,
    closed_at INTEGER,
    departure_folio TEXT,
    created_at INTEGER NOT NULL
  )''',
  'CREATE INDEX idx_workdays_driver ON workdays(driver_id, status)',
  // Solo una jornada abierta por conductor.
  "CREATE UNIQUE INDEX uq_workday_open ON workdays(driver_id) WHERE status <> 'closed'",
  '''CREATE TABLE orders(
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    folio TEXT NOT NULL UNIQUE,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    address_id TEXT NOT NULL REFERENCES addresses(id),
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    total_cents INTEGER NOT NULL CHECK(total_cents >= 0),
    created_by TEXT,
    created_at INTEGER NOT NULL,
    workday_id TEXT REFERENCES workdays(id),
    stop_id TEXT,
    idempotency_key TEXT NOT NULL UNIQUE
  )''',
  'CREATE INDEX idx_orders_customer ON orders(customer_id, status)',
  'CREATE INDEX idx_orders_status ON orders(status)',
  '''CREATE TABLE order_items(
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    qty INTEGER NOT NULL CHECK(qty > 0),
    unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
    UNIQUE(order_id, product_id)
  )''',
  '''CREATE TABLE order_events(
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )''',
  'CREATE INDEX idx_order_events ON order_events(order_id, created_at)',
  '''CREATE TABLE cart_items(
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    qty INTEGER NOT NULL CHECK(qty > 0 AND qty <= 999),
    PRIMARY KEY(user_id, product_id)
  )''',
  '''CREATE TABLE stops(
    id TEXT PRIMARY KEY,
    workday_id TEXT NOT NULL REFERENCES workdays(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    address_id TEXT NOT NULL REFERENCES addresses(id),
    order_id TEXT REFERENCES orders(id),
    seq INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','delivered','partial','failed','skipped')),
    arrived_at INTEGER,
    arrival_fix TEXT,
    completed_at INTEGER,
    UNIQUE(workday_id, seq)
  )''',
  'CREATE INDEX idx_stops_workday ON stops(workday_id, status)',
  '''CREATE TABLE load_lines(
    id TEXT PRIMARY KEY,
    workday_id TEXT NOT NULL REFERENCES workdays(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    expected_qty INTEGER NOT NULL CHECK(expected_qty >= 0),
    counted_qty INTEGER CHECK(counted_qty IS NULL OR counted_qty >= 0),
    reason TEXT,
    UNIQUE(workday_id, product_id)
  )''',
  '''CREATE TABLE inventory_movements(
    id TEXT PRIMARY KEY,
    workday_id TEXT NOT NULL REFERENCES workdays(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    type TEXT NOT NULL CHECK(type IN ('load','delivery','returnSellable','returnDamaged')),
    qty INTEGER NOT NULL CHECK(qty > 0),
    ref_type TEXT NOT NULL,
    ref_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(type, ref_id, product_id)
  )''',
  'CREATE INDEX idx_movements_workday ON inventory_movements(workday_id, product_id)',
  '''CREATE TABLE delivery_drafts(
    stop_id TEXT PRIMARY KEY REFERENCES stops(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )''',
  '''CREATE TABLE deliveries(
    id TEXT PRIMARY KEY,
    folio TEXT NOT NULL UNIQUE,
    stop_id TEXT NOT NULL UNIQUE REFERENCES stops(id),
    order_id TEXT REFERENCES orders(id),
    workday_id TEXT NOT NULL REFERENCES workdays(id),
    customer_id TEXT NOT NULL REFERENCES customers(id),
    outcome TEXT NOT NULL CHECK(outcome IN ('delivered','partial','failed')),
    total_cents INTEGER NOT NULL DEFAULT 0 CHECK(total_cents >= 0),
    returns_credit_cents INTEGER NOT NULL DEFAULT 0 CHECK(returns_credit_cents >= 0),
    receiver_name TEXT NOT NULL DEFAULT '',
    failure_reason TEXT,
    notes TEXT NOT NULL DEFAULT '',
    rescheduled INTEGER NOT NULL DEFAULT 0,
    fix TEXT NOT NULL,
    device_id TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    confirmed_at INTEGER NOT NULL
  )''',
  'CREATE INDEX idx_deliveries_customer ON deliveries(customer_id)',
  'CREATE INDEX idx_deliveries_workday ON deliveries(workday_id)',
  '''CREATE TABLE delivery_items(
    id TEXT PRIMARY KEY,
    delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    ordered_qty INTEGER NOT NULL CHECK(ordered_qty >= 0),
    delivered_qty INTEGER NOT NULL CHECK(delivered_qty >= 0),
    unit_price_cents INTEGER NOT NULL,
    reason TEXT
  )''',
  '''CREATE TABLE return_lines(
    id TEXT PRIMARY KEY,
    delivery_id TEXT NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    qty INTEGER NOT NULL CHECK(qty > 0),
    reason TEXT NOT NULL,
    condition TEXT NOT NULL CHECK(condition IN ('sellable','damaged')),
    unit_price_cents INTEGER NOT NULL
  )''',
  '''CREATE TABLE receivables(
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    folio TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK(kind IN ('invoice','delivery','credit')),
    delivery_id TEXT REFERENCES deliveries(id),
    issued_at INTEGER NOT NULL,
    due_at INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    balance_cents INTEGER NOT NULL,
    CHECK((kind = 'credit' AND balance_cents <= 0) OR (kind <> 'credit' AND balance_cents >= 0 AND balance_cents <= amount_cents))
  )''',
  'CREATE INDEX idx_receivables_customer ON receivables(customer_id, balance_cents)',
  '''CREATE TABLE payments(
    id TEXT PRIMARY KEY,
    folio TEXT NOT NULL UNIQUE,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    workday_id TEXT REFERENCES workdays(id),
    method TEXT NOT NULL CHECK(method IN ('cash','transfer','card','creditNote')),
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    received_cents INTEGER NOT NULL,
    change_cents INTEGER NOT NULL DEFAULT 0 CHECK(change_cents >= 0),
    reference TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE
  )''',
  'CREATE INDEX idx_payments_customer ON payments(customer_id)',
  'CREATE INDEX idx_payments_workday ON payments(workday_id, method)',
  '''CREATE TABLE payment_applications(
    id TEXT PRIMARY KEY,
    payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    receivable_id TEXT NOT NULL REFERENCES receivables(id),
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0)
  )''',
  '''CREATE TABLE evidence_files(
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('photo','signature')),
    rel_path TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  )''',
  'CREATE INDEX idx_evidence_owner ON evidence_files(owner_type, owner_id)',
  '''CREATE TABLE incidents(
    id TEXT PRIMARY KEY,
    folio TEXT NOT NULL UNIQUE,
    company_id TEXT NOT NULL REFERENCES companies(id),
    source TEXT NOT NULL CHECK(source IN ('driverLoad','client')),
    workday_id TEXT REFERENCES workdays(id),
    load_line_id TEXT REFERENCES load_lines(id),
    product_id TEXT REFERENCES products(id),
    order_id TEXT REFERENCES orders(id),
    delivery_id TEXT REFERENCES deliveries(id),
    customer_id TEXT REFERENCES customers(id),
    kind TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE
  )''',
  '''CREATE TABLE incident_updates(
    id TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )''',
  '''CREATE TABLE audits(
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    stop_id TEXT REFERENCES stops(id),
    workday_id TEXT REFERENCES workdays(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    visible INTEGER NOT NULL,
    faces INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE
  )''',
  '''CREATE TABLE audit_items(
    audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    shelf_qty INTEGER NOT NULL CHECK(shelf_qty >= 0),
    out_of_stock INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(audit_id, product_id)
  )''',
  '''CREATE TABLE closings(
    id TEXT PRIMARY KEY,
    folio TEXT NOT NULL UNIQUE,
    workday_id TEXT NOT NULL UNIQUE REFERENCES workdays(id),
    sales_cents INTEGER NOT NULL,
    returns_cents INTEGER NOT NULL,
    cash_expected_cents INTEGER NOT NULL,
    cash_declared_cents INTEGER NOT NULL,
    transfer_cents INTEGER NOT NULL,
    card_cents INTEGER NOT NULL,
    tolerance_cents INTEGER NOT NULL,
    justification TEXT NOT NULL DEFAULT '',
    exceptional_reason TEXT NOT NULL DEFAULT '',
    pending_stops INTEGER NOT NULL,
    stops_total INTEGER NOT NULL,
    stops_done INTEGER NOT NULL,
    end_km INTEGER NOT NULL,
    inventory TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('submitted','approved','rejected')),
    submitted_at INTEGER NOT NULL,
    reviewed_at INTEGER,
    reviewer TEXT,
    review_note TEXT
  )''',
  '''CREATE TABLE track_points(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workday_id TEXT NOT NULL REFERENCES workdays(id) ON DELETE CASCADE,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    accuracy REAL,
    recorded_at INTEGER NOT NULL
  )''',
  '''CREATE TABLE audit_log(
    id TEXT PRIMARY KEY,
    actor_id TEXT,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )''',
  '''CREATE TABLE outbox(
    id TEXT PRIMARY KEY,
    entity TEXT NOT NULL,
    op_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    depends_on TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending','sending','acknowledged','rejected')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at INTEGER,
    created_at INTEGER NOT NULL,
    acknowledged_at INTEGER
  )''',
  'CREATE INDEX idx_outbox_status ON outbox(status, created_at)',
];
