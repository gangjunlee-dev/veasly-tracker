-- Veasly Admin 주문 동기화 + 매칭 시스템
-- 2026-05-23

-- Admin에서 가져온 주문 데이터
CREATE TABLE IF NOT EXISTS admin_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  veasly_order_number TEXT NOT NULL UNIQUE,   -- 20260518TW305456681
  ordered_at TEXT,
  status TEXT,                                 -- PAYMENT_COMPLETED, ORDER_PROCESSING, SHIPPING_TO_BDJ, etc.
  total_amount_local INTEGER DEFAULT 0,        -- 고객 결제 총액 (TWD)
  currency TEXT DEFAULT 'TWD',
  is_combined INTEGER DEFAULT 0,               -- 합배송 여부
  has_free_shipping INTEGER DEFAULT 0,
  customer_name TEXT,
  shipping_address_type TEXT,                  -- CUSTOM, CONVENIENCE_STORE
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_orders_status ON admin_orders(status);
CREATE INDEX IF NOT EXISTS idx_admin_orders_synced_at ON admin_orders(synced_at);

-- Admin 주문 내 개별 상품 아이템
CREATE TABLE IF NOT EXISTS admin_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_order_id INTEGER NOT NULL,
  order_item_number TEXT,                      -- VY-xxxxx
  product_name TEXT,
  brand TEXT,
  detail_url TEXT,                             -- 고객이 제출한 상품 URL
  price_local INTEGER DEFAULT 0,               -- TWD
  price_krw INTEGER DEFAULT 0,
  quantity INTEGER DEFAULT 1,
  estimated_weight INTEGER DEFAULT 0,          -- 예상 무게 (g)
  status TEXT,
  is_free_shipping INTEGER DEFAULT 0,
  is_cancelled INTEGER DEFAULT 0,
  -- 구매 정보 (매칭 키)
  purchase_url TEXT,                           -- 쇼핑몰 주문 URL (핵심 매칭 키)
  purchase_price INTEGER,                      -- 실제 구매가 (KRW)
  card_approval_code TEXT,                     -- 카드 승인번호
  card_provider TEXT,                          -- SAMSUNG, BUNJANG 등
  -- 배송 정보
  domestic_tracking TEXT,                      -- 한국 국내 송장번호
  overseas_tracking TEXT,                      -- 해외 송장번호
  overseas_vendor TEXT,                        -- LINKPORT, W-EXPRESS
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (admin_order_id) REFERENCES admin_orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_admin_items_order ON admin_order_items(admin_order_id);
CREATE INDEX IF NOT EXISTS idx_admin_items_purchase_url ON admin_order_items(purchase_url);
CREATE INDEX IF NOT EXISTS idx_admin_items_domestic_tracking ON admin_order_items(domestic_tracking);
CREATE INDEX IF NOT EXISTS idx_admin_items_card_approval ON admin_order_items(card_approval_code);
CREATE INDEX IF NOT EXISTS idx_admin_items_status ON admin_order_items(status);

-- 매칭 결과 테이블: tracker 주문 ↔ admin 아이템
CREATE TABLE IF NOT EXISTS order_matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracker_order_id INTEGER NOT NULL,           -- orders.id (tracker 쇼핑몰 주문)
  admin_item_id INTEGER NOT NULL,              -- admin_order_items.id (admin 아이템)
  match_score INTEGER NOT NULL DEFAULT 0,      -- 매칭 점수 (0~200)
  match_reasons TEXT,                          -- JSON: ["L1_PURCHASE_URL", "L5_AMOUNT_DATE"]
  match_type TEXT NOT NULL DEFAULT 'AUTO',     -- AUTO, MANUAL, REJECTED
  confirmed INTEGER DEFAULT 0,                 -- 사용자 확인 여부
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (tracker_order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_item_id) REFERENCES admin_order_items(id) ON DELETE CASCADE,
  UNIQUE(tracker_order_id, admin_item_id)
);

CREATE INDEX IF NOT EXISTS idx_order_matches_tracker ON order_matches(tracker_order_id);
CREATE INDEX IF NOT EXISTS idx_order_matches_admin ON order_matches(admin_item_id);
CREATE INDEX IF NOT EXISTS idx_order_matches_score ON order_matches(match_score);
CREATE INDEX IF NOT EXISTS idx_order_matches_type ON order_matches(match_type);

-- Admin 동기화 로그
CREATE TABLE IF NOT EXISTS admin_sync_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK(status IN ('running', 'success', 'failed')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  total_orders INTEGER DEFAULT 0,
  new_orders INTEGER DEFAULT 0,
  updated_orders INTEGER DEFAULT 0,
  matched_count INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
