-- ops push incremental을 위한 컬럼.
-- last_pushed_at: 이 admin_orders가 ops에 마지막으로 push될 때 그 시점의 synced_at.
-- 다음 push 시 (last_pushed_at IS NULL OR synced_at > last_pushed_at) 조건으로 변경된 주문만 전송.

ALTER TABLE admin_orders ADD COLUMN last_pushed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_admin_orders_last_pushed_at
  ON admin_orders(last_pushed_at);
