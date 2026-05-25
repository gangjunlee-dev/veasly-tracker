-- 매칭 감사 로그: 스캔 → 매칭 → Admin 전송 전 과정을 기록.
-- Parallel Run 기간 동안 기존 수동 프로세스와 비교 검증용.

CREATE TABLE IF NOT EXISTS match_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 이벤트 종류
  event_type TEXT NOT NULL,
  -- SCAN_AUTO: 자동 매칭 성공
  -- SCAN_PARTIAL: 부분 매칭
  -- SCAN_MISS: 매칭 실패
  -- CONFIRM_LOCAL: 로컬 입고 확정
  -- CONFIRM_SYNCED: Admin 송장 등록 성공
  -- CONFIRM_SYNC_FAILED: Admin 송장 등록 실패 (재시도 필요)
  -- RETRY_SUCCESS: 재시도 성공
  -- RETRY_FAILED: 재시도 실패

  -- 관련 데이터
  tracking_number TEXT,
  order_item_id INTEGER,
  vy_code TEXT,
  order_number TEXT,
  product_name TEXT,

  -- Admin 전송 결과
  admin_synced INTEGER DEFAULT 0,       -- 0=미전송/실패, 1=전송 성공
  admin_error TEXT,                     -- 실패 시 에러 메시지
  retry_count INTEGER DEFAULT 0,

  -- 메타
  details TEXT,                         -- JSON (추가 정보)
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_event ON match_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_created ON match_audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_synced ON match_audit_log(admin_synced)
  WHERE event_type IN ('CONFIRM_SYNC_FAILED', 'RETRY_FAILED');
