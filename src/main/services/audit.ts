/**
 * match_audit_log 기록 헬퍼.
 * 매칭/동기화 모듈 여러 곳에서 import해 사용.
 */

import type Database from "better-sqlite3";

export type AuditEvent =
  | "SCAN_AUTO"
  | "SCAN_PARTIAL"
  | "SCAN_MISS"
  | "CONFIRM_LOCAL"
  | "CONFIRM_SYNCED"
  | "CONFIRM_SYNC_FAILED"
  | "RETRY_SUCCESS"
  | "RETRY_FAILED";

export interface AuditContext {
  order_item_id?: number | null;
  orderItemId?: number | null;
  vy_code?: string | null;
  vyCode?: string | null;
  order_number?: string | null;
  orderNumber?: string | null;
  product_name?: string | null;
  productName?: string | null;
}

export interface AuditExtra {
  adminSynced?: number;
  adminError?: string;
}

export function auditLog(
  db: Database.Database,
  eventType: AuditEvent | string,
  trackingNumber: string,
  row?: AuditContext,
  extra?: AuditExtra
): void {
  try {
    db.prepare(
      `INSERT INTO match_audit_log
        (event_type, tracking_number, order_item_id, vy_code, order_number, product_name, admin_synced, admin_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      eventType,
      trackingNumber,
      row?.order_item_id ?? row?.orderItemId ?? null,
      row?.vy_code ?? row?.vyCode ?? null,
      row?.order_number ?? row?.orderNumber ?? null,
      row?.product_name ?? row?.productName ?? null,
      extra?.adminSynced ?? 0,
      extra?.adminError ?? null
    );
  } catch {
    // 감사 로그 실패는 치명적이지 않음 — 무시
  }
}
