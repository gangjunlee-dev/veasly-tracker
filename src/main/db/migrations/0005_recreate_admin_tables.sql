-- 이전 실행에서 잘못된 스키마로 생성된 admin 테이블을 재생성합니다.
-- 아직 실제 데이터가 없는 개발 단계이므로 DROP + CREATE로 처리.

DROP TABLE IF EXISTS admin_order_items;
DROP TABLE IF EXISTS admin_orders;

CREATE TABLE IF NOT EXISTS admin_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  order_status TEXT NOT NULL,
  customer_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  total_amount INTEGER,
  currency TEXT DEFAULT 'TWD',
  item_count INTEGER DEFAULT 0,
  synced_at TEXT NOT NULL,
  raw_data TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_orders_status
  ON admin_orders(order_status);
CREATE INDEX IF NOT EXISTS idx_admin_orders_synced
  ON admin_orders(synced_at);

CREATE TABLE IF NOT EXISTS admin_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_order_id INTEGER NOT NULL REFERENCES admin_orders(id) ON DELETE CASCADE,
  order_item_id INTEGER NOT NULL,
  vy_code TEXT NOT NULL DEFAULT '',
  product_name TEXT,
  product_id INTEGER,
  item_status TEXT NOT NULL DEFAULT '',
  domestic_tracking_number TEXT,
  domestic_carrier TEXT,
  intl_tracking_number TEXT,
  intl_carrier TEXT,
  warehouse_status TEXT DEFAULT 'PENDING',
  warehouse_matched_at TEXT,
  warehouse_scan_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(admin_order_id, order_item_id)
);

CREATE INDEX IF NOT EXISTS idx_aoi_vy_code
  ON admin_order_items(vy_code);
CREATE INDEX IF NOT EXISTS idx_aoi_item_status
  ON admin_order_items(item_status);
CREATE INDEX IF NOT EXISTS idx_aoi_domestic_tracking
  ON admin_order_items(domestic_tracking_number);
CREATE INDEX IF NOT EXISTS idx_aoi_warehouse_status
  ON admin_order_items(warehouse_status);
CREATE INDEX IF NOT EXISTS idx_aoi_order_id
  ON admin_order_items(admin_order_id);
