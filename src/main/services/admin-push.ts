/**
 * admin_order_items에 새로 송장이 채워진 항목들을 admin.veasly.com으로 push.
 *
 * Auto-Match 파이프라인 Step 2의 "Server Write-Back" 단계.
 * 페어링(url-pairing.ts) 또는 수동 매칭으로 로컬에 송장이 반영된 직후 호출된다.
 */

import type Database from "better-sqlite3";
import log from "electron-log";
import { AdminApiClient } from "../admin-api/client";
import { auditLog } from "./audit";

const logger = log.scope("admin-push");

export interface AdminPushResult {
  attempted: number;
  synced: number;
  failed: number;
  skipped: number;
  noToken: boolean;
  errors: Array<{ orderItemId: number; vyCode: string; error: string }>;
}

interface ItemRow {
  id: number;
  order_item_id: number;
  vy_code: string;
  domestic_tracking_number: string | null;
  product_name: string | null;
  order_number: string;
  item_status: string | null;
}

function getAdminAccessToken(db: Database.Database): string | null {
  const row = db
    .prepare("SELECT value FROM kv WHERE key = 'admin_access_token' LIMIT 1")
    .get() as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * 주어진 admin_order_items.id 목록에 대해 송장을 admin API로 등록.
 * 토큰이 없으면 시도하지 않고 noToken=true로 반환 (호출자가 사용자 알림 처리).
 */
export async function pushTrackingsForItems(
  db: Database.Database,
  itemIds: number[]
): Promise<AdminPushResult> {
  const result: AdminPushResult = {
    attempted: 0,
    synced: 0,
    failed: 0,
    skipped: 0,
    noToken: false,
    errors: []
  };

  if (itemIds.length === 0) return result;

  const token = getAdminAccessToken(db);
  if (!token) {
    result.noToken = true;
    return result;
  }

  const fetchItem = db.prepare(
    `
    SELECT aoi.id,
           aoi.order_item_id,
           aoi.vy_code,
           aoi.domestic_tracking_number,
           aoi.product_name,
           aoi.item_status,
           ao.order_number
    FROM admin_order_items aoi
    JOIN admin_orders ao ON ao.id = aoi.admin_order_id
    WHERE aoi.id = ?
    `
  );

  const markSynced = db.prepare(
    `
    UPDATE admin_order_items
    SET warehouse_status = 'ARRIVED',
        warehouse_matched_at = COALESCE(warehouse_matched_at, datetime('now')),
        updated_at = datetime('now')
    WHERE id = ?
    `
  );

  const api = new AdminApiClient(token);

  for (const itemId of itemIds) {
    const row = fetchItem.get(itemId) as ItemRow | undefined;
    if (!row) {
      result.skipped += 1;
      continue;
    }
    if (!row.vy_code || !row.domestic_tracking_number) {
      result.skipped += 1;
      continue;
    }
    // 취소 계열(CANCEL_COMPLETED/CANCEL_REQUESTED 등)은 admin이 송장 입력 거부.
    if (row.item_status && row.item_status.startsWith("CANCEL")) {
      result.skipped += 1;
      continue;
    }

    result.attempted += 1;

    const ctx = {
      order_item_id: row.order_item_id,
      vy_code: row.vy_code,
      order_number: row.order_number,
      product_name: row.product_name
    };

    try {
      const apiResult = await api.registerDomesticTracking(
        row.vy_code,
        row.domestic_tracking_number
      );

      if (apiResult.ok) {
        markSynced.run(itemId);
        auditLog(db, "CONFIRM_SYNCED", row.domestic_tracking_number, ctx, {
          adminSynced: 1
        });
        result.synced += 1;
      } else {
        auditLog(db, "CONFIRM_SYNC_FAILED", row.domestic_tracking_number, ctx, {
          adminError: apiResult.error ?? "unknown"
        });
        result.failed += 1;
        result.errors.push({
          orderItemId: row.order_item_id,
          vyCode: row.vy_code,
          error: apiResult.error ?? "unknown"
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      auditLog(db, "CONFIRM_SYNC_FAILED", row.domestic_tracking_number, ctx, {
        adminError: msg
      });
      result.failed += 1;
      result.errors.push({
        orderItemId: row.order_item_id,
        vyCode: row.vy_code,
        error: msg
      });
    }
  }

  if (result.attempted > 0) {
    logger.info(
      `[push] attempted=${result.attempted}, synced=${result.synced}, failed=${result.failed}, skipped=${result.skipped}`
    );
  }

  return result;
}
