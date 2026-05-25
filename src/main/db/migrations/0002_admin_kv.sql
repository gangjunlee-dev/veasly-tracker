-- admin 자격증명 및 설정을 저장하기 위한 범용 kv 테이블.
-- 기존 schema.sql에 없던 테이블이므로 마이그레이션으로 생성.
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
