/**
 * veasly-ops로 동기화 데이터를 푸시합니다.
 * admin → local SQLite 동기화 완료 후 호출됩니다.
 */

import type Database from "better-sqlite3";
import log from "electron-log";

const logger = log.scope("ops-push");

export interface OpsPushResult {
  ok: boolean;
  created?: number;
  updated?: number;
  error?: string;
}

/**
 * 로컬 DB의 주문 데이터를 veasly-ops로 푸시합니다.
 * 배치 단위로 전송하여 request body 크기를 제한합니다.
 */
export async function pushToOps(
  db: Database.Database,
  opsUrl: string,
  opsApiKey: string
): Promise<OpsPushResult> {
  // 테이블 존재 확인
  const tableExists = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='admin_orders' LIMIT 1"
    )
    .get();
  if (!tableExists) {
    return { ok: true, created: 0, updated: 0 };
  }

  // 주문 + 아이템 조회
  const orders = db
    .prepare("SELECT * FROM admin_orders ORDER BY order_number DESC")
    .all() as any[];

  if (orders.length === 0) {
    return { ok: true, created: 0, updated: 0 };
  }

  const getItems = db.prepare(
    "SELECT * FROM admin_order_items WHERE admin_order_id = ?"
  );

  // 배치로 나누어 전송 (50건씩)
  const BATCH_SIZE = 50;
  let totalCreated = 0;
  let totalUpdated = 0;

  for (let i = 0; i < orders.length; i += BATCH_SIZE) {
    const batch = orders.slice(i, i + BATCH_SIZE);
    const payload = batch.map((order: any) => {
      const items = getItems.all(order.id) as any[];
      return {
        orderNumber: order.order_number,
        orderStatus: order.order_status,
        customerName: order.customer_name,
        itemCount: order.item_count,
        items: items.map((item: any) => ({
          orderItemId: item.order_item_id,
          vyCode: item.vy_code,
          productName: item.product_name,
          itemStatus: item.item_status,
          warehouseStatus: item.warehouse_status,
          domesticTrackingNumber: item.domestic_tracking_number,
          domesticCarrier: item.domestic_carrier,
          intlTrackingNumber: item.intl_tracking_number,
          intlCarrier: item.intl_carrier,
        })),
      };
    });

    try {
      const res = await fetch(`${opsUrl}/tracker/api/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opsApiKey}`,
        },
        body: JSON.stringify({ orders: payload }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      const result = (await res.json()) as { created: number; updated: number };
      totalCreated += result.created;
      totalUpdated += result.updated;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[Ops Push] 배치 ${i}-${i + batch.length} 실패:`, msg);
      return { ok: false, error: msg, created: totalCreated, updated: totalUpdated };
    }
  }

  logger.info(`[Ops Push] 완료: ${totalCreated} created, ${totalUpdated} updated (총 ${orders.length}건)`);
  return { ok: true, created: totalCreated, updated: totalUpdated };
}
