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