/**
 * OrderSync — admin.veasly.com → 로컬 SQLite 동기화 엔진.
 *
 * 앱 시작 시 또는 수동 sync 버튼으로 호출됩니다.
 * 배송 대기 주문(PAYMENT_COMPLETED, ORDER_PROCESSING, SHIPPING_TO_BDJ)을
 * admin API에서 가져와 로컬 admin_orders / admin_order_items에 캐시합니다.
 */

import type Database from "better-sqlite3";
import type {
  AdminApiClient,
  AdminOrderItem,
  AdminOrderListEntry,
} from "../admin-api/client";
import log from "electron-log";

const logger = log.scope("order-sync");

export interface SyncResult {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  detailed: number;
  errors: string[];
}

export interface SyncProgress {
  phase: "list" | "detail" | "done";
  message: string;
  current?: number;
  total?: number;
}

export class OrderSync {
  private db: Database.Database;
  private api: AdminApiClient;

  constructor(db: Database.Database, api: AdminApiClient) {
    this.db = db;
    this.api = api;
  }

  /**
   * 배송 대기 주문을 admin에서 가져와 로컬 DB에 동기화합니다.
   *
   * 1단계: fetchPendingShipmentOrders() — 주문 목록 수집
   * 2단계: fetchOrderDetail() — 각 주문의 아이템/배송 상세 조회
   * 3단계: upsert — 로컬 DB에 저장
   */
  async syncPendingOrders(
    onProgress?: (p: SyncProgress) => void
  ): Promise<SyncResult> {
    const result: SyncResult = {
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      detailed: 0,
      errors: [],
    };

    // 1단계: 주문 목록 수집
    onProgress?.({ phase: "list", message: "배송 대기 주문 목록 조회 중..." });

    let orders: AdminOrderListEntry[];
    try {
      orders = await this.api.fetchPendingShipmentOrders((msg) => {
        onProgress?.({ phase: "list", message: msg });
      });
    } catch (err) {
      const msg = `주문 목록 조회 실패: ${err}`;
      logger.error(msg);
      result.errors.push(msg);
      return result;
    }

    result.fetched = orders.length;
    if (orders.length === 0) {
      onProgress?.({ phase: "done", message: "배송 대기 주문이 없습니다." });
      return result;
    }

    // prepared statements
    const upsertOrder = this.db.prepare(`
      INSERT INTO admin_orders
        (order_number, order_status, customer_name, customer_phone, customer_address, total_amount, currency, item_count, synced_at, raw_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
      ON CONFLICT(order_number) DO UPDATE SET
        order_status = excluded.order_status,
        customer_name = COALESCE(excluded.customer_name, admin_orders.customer_name),
        customer_phone = COALESCE(excluded.customer_phone, admin_orders.customer_phone),
        customer_address = COALESCE(excluded.customer_address, admin_orders.customer_address),
        total_amount = COALESCE(excluded.total_amount, admin_orders.total_amount),
        item_count = excluded.item_count,
        synced_at = datetime('now'),
        raw_data = excluded.raw_data,
        updated_at = datetime('now')
    `);

    const getOrderId = this.db.prepare(
      "SELECT id FROM admin_orders WHERE order_number = ?"
    );

    const upsertItem = this.db.prepare(`
      INSERT INTO admin_order_items
        (admin_order_id, order_item_id, vy_code, product_name, product_id, item_status,
         domestic_tracking_number, domestic_carrier, intl_tracking_number, intl_carrier)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(admin_order_id, order_item_id) DO UPDATE SET
        vy_code = COALESCE(NULLIF(excluded.vy_code, ''), admin_order_items.vy_code),
        product_name = COALESCE(excluded.product_name, admin_order_items.product_name),
        item_status = excluded.item_status,
        domestic_tracking_number = COALESCE(excluded.domestic_tracking_number, admin_order_items.domestic_tracking_number),
        domestic_carrier = COALESCE(excluded.domestic_carrier, admin_order_items.domestic_carrier),
        intl_tracking_number = COALESCE(excluded.intl_tracking_number, admin_order_items.intl_tracking_number),
        intl_carrier = COALESCE(excluded.intl_carrier, admin_order_items.intl_carrier),
        updated_at = datetime('now')
    `);

    const existsCheck = this.db.prepare(
      "SELECT order_status FROM admin_orders WHERE order_number = ? LIMIT 1"
    );

    // 2단계: 신규/변경 주문만 상세 조회
    let skipped = 0;
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      const orderNumber = order.orderNumber;

      // 이미 로컬에 있고 상태가 동일하면 상세 조회 생략
      const existing = existsCheck.get(orderNumber) as { order_status: string } | undefined;
      const remoteStatus = order.status ?? "UNKNOWN";
      if (existing && existing.order_status === remoteStatus) {
        skipped++;
        continue;
      }

      onProgress?.({
        phase: "detail",
        message: `주문 상세 조회 중: ${orderNumber} (${i + 1 - skipped}/${orders.length - skipped} 신규/변경)`,
        current: i + 1,
        total: orders.length,
      });

      try {
        // 상세 조회
        const items = await this.api.fetchOrderDetail(orderNumber);
        result.detailed++;

        const isNew = !existing;

        // admin_orders upsert
        upsertOrder.run(
          orderNumber,
          order.status ?? items[0]?.status ?? "UNKNOWN",
          order.recipientName ?? null,
          order.recipientPhone ?? null,
          order.recipientAddress ?? null,
          order.totalPrice ?? null,
          "TWD",
          items.length,
          JSON.stringify({ listData: order, detailItems: items })
        );

        if (isNew) {
          result.created++;
        } else {
          result.updated++;
        }

        // admin_order_id 가져오기
        const row = getOrderId.get(orderNumber) as
          | { id: number }
          | undefined;
        if (!row) continue;
        const adminOrderId = row.id;

        // admin_order_items upsert
        for (const item of items) {
          const domestic = extractShippingInfo(item, true);
          const intl = extractShippingInfo(item, false);

          upsertItem.run(
            adminOrderId,
            item.id,
            item.orderItemNumber ?? "",
            item.product?.name ?? item.productName ?? "",
            item.product?.id ?? null,
            item.status ?? "",
            domestic?.trackingNumber ?? null,
            domestic?.vendor ?? null,
            intl?.trackingNumber ?? null,
            intl?.vendor ?? null
          );
        }
      } catch (err) {
        const msg = `${orderNumber}: ${err}`;
        logger.warn(msg);
        result.errors.push(msg);
      }
    }

    result.skipped = skipped;

    onProgress?.({
      phase: "done",
      message: `동기화 완료: ${result.created}건 신규, ${result.updated}건 업데이트, ${skipped}건 생략, ${result.errors.length}건 오류`,
    });

    logger.info(
      `Sync 완료: fetched=${result.fetched}, created=${result.created}, updated=${result.updated}, skipped=${skipped}, errors=${result.errors.length}`
    );

    return result;
  }
}

/** shippingInfo 배열에서 국내/국제 배송 정보를 추출 */
function extractShippingInfo(
  item: AdminOrderItem,
  isDomestic: boolean
): { trackingNumber: string; vendor: string } | null {
  const info = item.shippingInfo?.find((s) => s.isDomestic === isDomestic);
  if (!info) return null;
  return {
    trackingNumber: info.trackingNumber ?? "",
    vendor: info.vendor?.text ?? "",
  };
}
