-- admin.veasly.com에서 동기화한 마스터 주문 데이터 캐시.
-- 기존 orders 테이블(번개장터 구매)과는 역할이 다름:
--   orders     = "우리가 구매한" 주문 (Bunjang/Musinsa 등)
--   admin_orders = "고객이 우리에게 주문한" 주문 (Veasly 고객 주문)

CREATE TABLE IF NOT EXISTS admin_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,       -- "20260525TW001"
  order_status TEXT NOT NULL,              -- PAYMENT_COMPLETED, ORDER_PROCESSING, etc.
  customer_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  total_amount INTEGER,
  currency TEXT DEFAULT 'TWD',
  item_count INTEGER DEFAULT 0,
  synced_at TEXT NOT NULL,
  raw_data TEXT,                           -- API 응답 전체 JSON
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_orders_status
  ON admin_orders(order_status);
CREATE INDEX IF NOT EXISTS idx_admin_orders_synced
  ON admin_orders(synced_at);

-- 주문 아이템 (1 주문 = N 아이템, 각각 독립 배송 단위)
CREATE TABLE IF NOT EXISTS admin_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_order_id INTEGER NOT NULL REFERENCES admin_orders(id) ON DELETE CASCADE,
  order_item_id INTEGER NOT NULL,          -- admin API의 item.id (PATCH 호출에 필요)
  vy_code TEXT NOT NULL DEFAULT '',        -- "VY-aJbd5" (orderItemNumber)
  product_name TEXT,
  product_id INTEGER,
  item_status TEXT NOT NULL DEFAULT '',    -- 아이템별 상태
  -- 국내 배송
  domestic_tracking_number TEXT,
  domestic_carrier TEXT,
  -- 국제 배송
  intl_tracking_number TEXT,
  intl_carrier TEXT,
  -- 창고 매칭
  warehouse_status TEXT DEFAULT 'PENDING', -- PENDING, ARRIVED, SHIPPED
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
