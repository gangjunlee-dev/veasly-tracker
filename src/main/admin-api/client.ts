/**
 * admin.veasly.com / api.veasly.com API 클라이언트.
 *
 * 주문 조회, 상세 조회, 상태 업데이트를 담당합니다.
 * API 구조는 veasly-ops/src/modules/shipping/routes.ts 에서 검증된 형태입니다.
 */

import log from "electron-log";

const logger = log.scope("admin-api");

const API_ENVS = {
  production: "https://api.veasly.com",
  development: "https://dev-api.veasly.com",
} as const;

export type AdminEnv = keyof typeof API_ENVS;

// ── 타입 정의 ──

export interface AdminOrderItem {
  id: number;
  orderItemNumber?: string; // VY 코드
  status?: string;
  product?: { id?: number; name?: string; price?: number };
  productName?: string;
  shippingInfo?: Array<{
    isDomestic: boolean;
    vendor?: { text: string };
    trackingNumber?: string;
  }>;
  // 운영자가 admin.veasly.com에서 구매 증빙으로 입력한 마이페이지 URL.
  // 실제 응답 키 이름은 환경별로 다를 수 있어 pickPurchaseUrl()에서 fallback 처리.
  purchaseUrl?: string | null;
}

export interface AdminOrderListEntry {
  orderNumber: string;
  status?: string;
  items?: AdminOrderItem[];
  recipientName?: string;
  recipientPhone?: string;
  recipientAddress?: string;
  totalPrice?: number;
}

export class AdminApiClient {
  private token: string;
  private baseUrl: string;

  constructor(accessToken: string, env: AdminEnv = "production") {
    this.token = accessToken.startsWith("Bearer")
      ? accessToken
      : `Bearer ${accessToken}`;
    this.baseUrl = API_ENVS[env];
  }

  // ── 토큰 검증 ──

  async verifyToken(): Promise<boolean> {
    try {
      logger.info("[Sync] 토큰 검증 중... →", this.baseUrl);
      const res = await fetch(
        `${this.baseUrl}/admin/orders/20260101TW000000000/detail`,
        { headers: { Authorization: this.token } }
      );
      const valid = res.status !== 401 && res.status !== 403;
      logger.info(`[Sync] 토큰 검증 결과: HTTP ${res.status} → ${valid ? "유효" : "만료/거부"}`);
      return valid;
    } catch (err) {
      logger.warn("[Sync] 토큰 검증 네트워크 오류:", err);
      return false;
    }
  }

  // ── 주문 목록 조회 ──

  /**
   * 특정 상태의 주문 목록을 페이지 단위로 가져옵니다.
   * API: GET /admin/orders/{page}/{size}?orderStatus={status}
   */
  async fetchOrdersByStatus(
    status: string,
    page = 0,
    size = 100
  ): Promise<{ data: AdminOrderListEntry[]; hasMore: boolean }> {
    const url = `${this.baseUrl}/admin/orders/${page}/${size}?orderStatus=${status}`;
    logger.info(`[Sync] 주문 목록 요청: ${status} page=${page} size=${size}`);
    const res = await fetch(url, {
      headers: { Authorization: this.token },
    });

    if (res.status === 401 || res.status === 403) {
      logger.error(`[Sync] 인증 실패: HTTP ${res.status}`);
      throw new Error("토큰 만료 또는 권한 없음");
    }
    if (!res.ok) {
      logger.error(`[Sync] 주문 목록 조회 실패: HTTP ${res.status}`);
      throw new Error(`주문 목록 조회 실패 (HTTP ${res.status})`);
    }

    const body = (await res.json()) as any;
    const data: any[] = body.data ?? body ?? [];
    const items = Array.isArray(data) ? data : [];
    logger.info(`[Sync] 주문 목록 응답: ${status} page=${page} → ${items.length}건`);

    return {
      data: items,
      hasMore: items.length >= size,
    };
  }

  /**
   * 배송 대기 중인 모든 주문을 수집합니다.
   * 여러 상태를 순회하며 전체 활성 주문을 수집합니다.
   */
  async fetchPendingShipmentOrders(
    onProgress?: (msg: string) => void
  ): Promise<AdminOrderListEntry[]> {
    const statuses = [
      "PAYMENT_COMPLETED",
      "ORDER_PROCESSING",
      "SHIPPING_TO_BDJ",
      "SHIPPING_TO_HOME",
    ];
    const all: AdminOrderListEntry[] = [];
    const seen = new Set<string>();

    for (const status of statuses) {
      let page = 0;
      while (true) {
        const { data, hasMore } = await this.fetchOrdersByStatus(
          status,
          page,
          100
        );

        for (const order of data) {
          const num = order.orderNumber;
          if (num && !seen.has(num)) {
            seen.add(num);
            all.push(order);
          }
        }

        onProgress?.(
          `${status} 조회 중 (page ${page}, 누적 ${all.length}건)`
        );

        if (!hasMore) break;
        page++;
      }
    }

    logger.info(`[Sync] 배송 대기 주문 총 ${all.length}건 수집 완료 (${statuses.join(", ")})`);
    return all;
  }

  // ── 주문 상세 조회 ──

  /**
   * 주문번호로 상세 정보(아이템, 배송 정보)를 가져옵니다.
   * API: GET /admin/orders/{code}/detail
   *
   * 응답 형식이 다양할 수 있어 shipping/routes.ts resolve-ids 패턴을 따릅니다.
   */
  async fetchOrderDetail(orderNumber: string): Promise<AdminOrderItem[]> {
    logger.debug(`[Sync] 주문 상세 요청: ${orderNumber}`);

    // 1) 일반 주문 상세 시도
    const res = await fetch(
      `${this.baseUrl}/admin/orders/${orderNumber}/detail`,
      { headers: { Authorization: this.token } }
    );

    if (res.status === 401 || res.status === 403) {
      logger.error(`[Sync] 주문 상세 인증 실패: ${orderNumber} HTTP ${res.status}`);
      throw new Error("토큰 만료 또는 권한 없음");
    }

    if (res.ok) {
      const body = (await res.json()) as any;
      // statusCode가 있으면 서버 에러 응답 (합배송 등)
      if (!body.statusCode) {
        const items = normalizeOrderItems(body);
        if (items.length > 0) {
          logger.debug(`[Sync] 주문 상세 응답: ${orderNumber} → ${items.length} items`);
          return items;
        }
      }
    }

    // 2) 합배송 fallback: combined-shipping-detail
    logger.debug(`[Sync] 합배송 조회 시도: ${orderNumber}`);
    try {
      const baseRes = await fetch(
        `${this.baseUrl}/admin/orders/${orderNumber}/combined-shipping-base`,
        { headers: { Authorization: this.token } }
      );

      if (baseRes.ok) {
        const baseData = (await baseRes.json()) as any;
        if (baseData.result !== false && !baseData.statusCode && baseData.payment) {
          // 합배송 확인됨 → detail 조회
          const detRes = await fetch(
            `${this.baseUrl}/admin/orders/${orderNumber}/combined-shipping-detail`,
            { headers: { Authorization: this.token } }
          );

          if (detRes.ok) {
            const detData = (await detRes.json()) as any;
            const allItems: AdminOrderItem[] = [];
            for (const child of detData.data ?? []) {
              for (const item of child.items ?? []) {
                allItems.push(item);
              }
            }
            logger.info(`[Sync] 합배송 응답: ${orderNumber} → ${allItems.length} items`);
            return allItems;
          }
        }
      }
    } catch (err) {
      logger.warn(`[Sync] 합배송 조회 실패: ${orderNumber}`, err);
    }

    // 둘 다 실패
    logger.error(`[Sync] 주문 상세 조회 실패 (일반+합배송): ${orderNumber}`);
    throw new Error(`주문 상세 조회 실패 — 일반/합배송 모두 응답 없음 (${orderNumber})`);
  }

  // ── 상태 업데이트 ──

  /**
   * 국내 송장 등록 (바코드 스캔 후 매칭 확정 시 호출).
   * API: PATCH /admin/orders/items/status/SHIPPING-TO-BDJ
   */
  async registerDomesticTracking(
    vyCode: string,
    trackingNumber: string
  ): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(
      `${this.baseUrl}/admin/orders/items/status/SHIPPING-TO-BDJ`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.token,
        },
        body: JSON.stringify({
          orderItemNumbers: vyCode,
          trackingNumber,
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    return { ok: true };
  }

  /**
   * 해외 송장 등록.
   * API: PATCH /admin/orders/items/status/SHIPPING-TO-HOME
   */
  async registerInternationalShipping(params: {
    orderItemIds: number[];
    orderNumbers: string[];
    vendor: string;
    trackingNumber: string;
    measuredWeight?: number;
    billedWeight?: number;
    dimensionWidth?: number;
    dimensionDepth?: number;
    dimensionHeight?: number;
    shippingCost?: number;
  }): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch(
      `${this.baseUrl}/admin/orders/items/status/SHIPPING-TO-HOME`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.token,
        },
        body: JSON.stringify(params),
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    return { ok: true };
  }
}

/** API 응답에서 아이템 배열을 정규화 (resolve-ids 패턴) */
function normalizeOrderItems(body: any): AdminOrderItem[] {
  const items = Array.isArray(body)
    ? body
    : body.orderItems ??
      body.order_items ??
      body.data?.orderItems ??
      body.data?.order_items ??
      body.data ??
      [];
  return Array.isArray(items) ? items : [];
}
