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
import { extractOrderRef } from "../services/order-ref";

const logger = log.scope("order-sync");

/**
 * admin API의 구매 증빙 URL은 item.purchaseHistory[0].url에 들어온다 (실제 응답으로 확인).
 * 환경/버전 차이를 위한 top-level fallback도 함께 시도.
 */
function pickPurchaseUrl(item: AdminOrderItem | Record<string, unknown>): string | null {
  const raw = item as Record<string, unknown>;

  // 1순위: purchaseHistory 배열의 첫 항목 url (admin 실제 응답 위치)
  const ph = raw.purchaseHistory;
  if (Array.isArray(ph) && ph.length > 0) {
    const first = ph[0] as Record<string, unknown> | undefined;
    const url = first?.url;
    if (typeof url === "string" && url.trim()) return url.trim();
  }

  // 2순위: top-level 키 (응답 포맷 변형에 대비)
  const candidates = [
    "purchaseUrl",
    "purchase_url",
    "purchaseProofUrl",
    "proofUrl",
    "evidenceUrl",
  ];
  for (const key of candidates) {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

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

    // 1단계: 주문 목록 수집 (페이지별 조기종료 적용)
    //
    // 기존: 모든 status의 모든 페이지를 끝까지 fetch.
    // 변경: 한 페이지 전체가 "이미 로컬에 있고 status 동일"이면 그 status의
    //       이후 페이지를 skip. admin API는 최신 주문이 앞 페이지에 오므로
    //       옛 페이지(=옛 주문)는 변경 없을 가능성이 높다는 가정.
    // 위험: 옛 주문의 status가 갑자기 변경되면 그 변경분은 다음 sync까지 놓침.
    onProgress?.({ phase: "list", message: "배송 대기 주문 목록 조회 중..." });

    const PENDING_STATUSES = [
      "PAYMENT_COMPLETED",
      "ORDER_PROCESSING",
      "SHIPPING_TO_BDJ",
      "SHIPPING_TO_HOME",
    ];
    const PAGE_SIZE = 100;
    const SAFETY_MAX_PAGE = 50;

    const existsLookup = this.db.prepare(
      "SELECT order_status FROM admin_orders WHERE order_number = ? LIMIT 1"
    );

    const orders: AdminOrderListEntry[] = [];
    const seenOrderNumbers = new Set<string>();
    let earlyStopPagesSaved = 0;

    try {
      for (const status of PENDING_STATUSES) {
        for (let page = 0; page < SAFETY_MAX_PAGE; page++) {
          const { data, hasMore } = await this.api.fetchOrdersByStatus(
            status,
            page,
            PAGE_SIZE
          );

          if (data.length === 0) break;

          let unchangedInThisPage = 0;
          for (const order of data) {
            const num = order.orderNumber;
            if (!num) continue;

            const existing = existsLookup.get(num) as
              | { order_status: string }
              | undefined;
            const remoteStatus = order.status ?? "UNKNOWN";
            if (existing && existing.order_status === remoteStatus) {
              unchangedInThisPage++;
            }

            if (!seenOrderNumbers.has(num)) {
              seenOrderNumbers.add(num);
              orders.push(order);
            }
          }

          onProgress?.({
            phase: "list",
            message: `${status} page=${page} 조회 (이 페이지 ${unchangedInThisPage}/${data.length}건 동일, 누적 ${orders.length}건)`,
          });

          // 이 페이지 전체가 변경 없음 → 이전 페이지(옛 주문)도 변경 없다고 보고 종료.
          if (unchangedInThisPage === data.length) {
            // 남은 페이지가 더 있었다면 그만큼 절약된 것.
            if (hasMore) earlyStopPagesSaved++;
            onProgress?.({
              phase: "list",
              message: `${status}: page ${page} 전체가 변경 없음 — 이후 페이지 skip (시간 절약)`,
            });
            break;
          }

          if (!hasMore) break;
        }
      }
    } catch (err) {
      const msg = `주문 목록 조회 실패: ${err}`;
      logger.error(msg);
      result.errors.push(msg);
      return result;
    }

    result.fetched = orders.length;
    logger.info(
      `[Sync] List 수집 완료: ${orders.length}건 (조기종료 ${earlyStopPagesSaved}회 발동)`
    );

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
         domestic_tracking_number, domestic_carrier, intl_tracking_number, intl_carrier,
         purchase_url, source_order_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(admin_order_id, order_item_id) DO UPDATE SET
        vy_code = COALESCE(NULLIF(excluded.vy_code, ''), admin_order_items.vy_code),
        product_name = COALESCE(excluded.product_name, admin_order_items.product_name),
        item_status = excluded.item_status,
        domestic_tracking_number = COALESCE(excluded.domestic_tracking_number, admin_order_items.domestic_tracking_number),
        domestic_carrier = COALESCE(excluded.domestic_carrier, admin_order_items.domestic_carrier),
        intl_tracking_number = COALESCE(excluded.intl_tracking_number, admin_order_items.intl_tracking_number),
        intl_carrier = COALESCE(excluded.intl_carrier, admin_order_items.intl_carrier),
        purchase_url = COALESCE(excluded.purchase_url, admin_order_items.purchase_url),
        source_order_ref = COALESCE(excluded.source_order_ref, admin_order_items.source_order_ref),
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
          const purchaseUrl = pickPurchaseUrl(item);
          const sourceOrderRef = purchaseUrl
            ? extractOrderRef(purchaseUrl)?.ref ?? null
            : null;

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
            intl?.vendor ?? null,
            purchaseUrl,
            sourceOrderRef
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
