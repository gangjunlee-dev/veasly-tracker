-- URL 기반 페어링용 매칭 키 컬럼 추가.
-- Dataset A (admin_order_items)와 Dataset B (orders)를
-- (site_code, source_order_ref) 키로 페어링하기 위한 컬럼들.

-- Dataset B: 추출기가 마이페이지/셀러 API에서 받아온 원본 주문번호.
-- 추출기 코드에서 이미 변수 sourceOrderNumber로 다뤄지는 값을
-- DB 컬럼으로 노출만 한 것.
ALTER TABLE orders ADD COLUMN source_order_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_source_order_ref
  ON orders(source_order_ref);

-- Dataset A: 운영자가 admin.veasly.com에서 구매 증빙으로 입력한
-- 마이페이지 URL과, 거기서 사이트별 규칙으로 추출한 식별자.
-- purchase_url   : 원본 URL 보존 (감사/디버깅용)
-- source_order_ref : 매칭에 실제로 쓰는 정규화된 식별자
ALTER TABLE admin_order_items ADD COLUMN purchase_url TEXT;
ALTER TABLE admin_order_items ADD COLUMN source_order_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_aoi_source_order_ref
  ON admin_order_items(source_order_ref);
