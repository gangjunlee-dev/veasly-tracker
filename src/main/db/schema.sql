PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  password_ciphertext TEXT NOT NULL,
  password_iv TEXT NOT NULL,
  password_auth_tag TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_extracted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sites_code ON sites(code);
CREATE INDEX IF NOT EXISTS idx_sites_enabled ON sites(enabled);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL,
  order_number TEXT NOT NULL,
  order_date TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'KRW',
  invoice_number TEXT,
  invoice_url TEXT,
  shipping_status TEXT,
  warehouse_status TEXT NOT NULL DEFAULT 'NOT_ARRIVED',
  warehouse_arrived_at TEXT,
  warehouse_scan_id INTEGER,
  raw_data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  UNIQUE(site_id, order_number)
);

CREATE INDEX IF NOT EXISTS idx_orders_site_id ON orders(site_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_shipping_status ON orders(shipping_status);
CREATE INDEX IF NOT EXISTS idx_orders_invoice_number ON orders(invoice_number);

CREATE TABLE IF NOT EXISTS extraction_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'success', 'failed', 'cancelled')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  message TEXT,
  total_orders INTEGER NOT NULL DEFAULT 0,
  new_orders INTEGER NOT NULL DEFAULT 0,
  updated_orders INTEGER NOT NULL DEFAULT 0,
  error_stack TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_extraction_logs_site_id ON extraction_logs(site_id);
CREATE INDEX IF NOT EXISTS idx_extraction_logs_started_at ON extraction_logs(started_at);


CREATE TABLE IF NOT EXISTS inbound_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_number TEXT NOT NULL,
  normalized_tracking_number TEXT NOT NULL UNIQUE,
  carrier TEXT,
  raw_input TEXT,
  status TEXT NOT NULL DEFAULT 'SCANNED',
  matched_order_count INTEGER NOT NULL DEFAULT 0,
  scan_count INTEGER NOT NULL DEFAULT 1,
  scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_scanned_at TEXT,
  matched_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_inbound_scans_tracking
  ON inbound_scans(normalized_tracking_number);

CREATE INDEX IF NOT EXISTS idx_inbound_scans_status
  ON inbound_scans(status);

CREATE INDEX IF NOT EXISTS idx_inbound_scans_scanned_at
  ON inbound_scans(scanned_at);

CREATE TABLE IF NOT EXISTS inbound_scan_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'AUTO',
  matched_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (scan_id) REFERENCES inbound_scans(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  UNIQUE(scan_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_inbound_scan_matches_scan_id
  ON inbound_scan_matches(scan_id);

CREATE INDEX IF NOT EXISTS idx_inbound_scan_matches_order_id
  ON inbound_scan_matches(order_id);
CREATE TABLE IF NOT EXISTS _migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
