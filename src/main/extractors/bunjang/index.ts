/**
 * BunjangExtractor
 *
 * 번개장터 Open API를 통해 구매 주문 내역을 추출합니다.
 *
 * 인증: JWT (HS256, accessKey + base64-encoded secretKey)
 * - GET  /api/v1/orders          — 주문 목록 (statusUpdateStartDate/End, max 15일)
 * - GET  /api/v1/orders/{id}     — 주문 상세 (invoice / 배송 정보 포함)
 *
 * 자격증명 매핑 (DB sites 테이블):
 *   username  = Access Key
 *   password  = Secret Key (Base64 인코딩)
 */

import * as crypto from "node:crypto";
import type { Page } from "playwright";
import { BaseExtractor } from "../_base/BaseExtractor";
import type {
  Credentials,
  ExtractionOptions,
  ExtractorConfig,
  ProgressReporter,
  StandardOrder
} from "../_base/types";
import config from "./config.json";

// ──────────────────────────────────────────────
// 상수
// ──────────────────────────────────────────────

const BASE_URL = "https://openapi.bunjang.co.kr";
/** List Orders API 최대 조회 기간: 14일 (서버 한도 15일에서 1일 여유) */
const MAX_WINDOW_DAYS = 14;
const PAGE_SIZE = 100;

// ──────────────────────────────────────────────
// JWT 유틸리티 (jsonwebtoken 패키지 없이 순수 Node crypto 사용)
// ──────────────────────────────────────────────

function base64url(data: string | Buffer): string {
  const b64 =
    typeof data === "string"
      ? Buffer.from(data).toString("base64")
      : data.toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * 번개장터 API용 JWT 토큰 생성.
 * - 유효기간: iat 기준 30초
 * - POST/PUT/DELETE는 nonce(UUID v4) 클레임 필요
 */
function createJWT(
  accessKey: string,
  secretKeyBuf: Buffer,
  method = "GET"
): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));

  const claims: Record<string, unknown> = {
    accessKey,
    iat: Math.floor(Date.now() / 1000)
  };

  if (["POST", "PUT", "DELETE"].includes(method.toUpperCase())) {
    claims.nonce = crypto.randomUUID();
  }

  const payload = base64url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const sig = crypto
    .createHmac("sha256", secretKeyBuf)
    .update(signingInput)
    .digest();

  return `${signingInput}.${base64url(sig)}`;
}

// ──────────────────────────────────────────────
// 헬퍼
// ──────────────────────────────────────────────

/**
 * 날짜 범위를 MAX_WINDOW_DAYS 단위로 분할.
 * List Orders API의 최대 조회 기간(15일) 제약을 우회.
 */
function splitInto14DayWindows(
  since: Date,
  until: Date
): Array<{ start: Date; end: Date }> {
  const maxMs = MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const windows: Array<{ start: Date; end: Date }> = [];
  let cursor = new Date(since);

  while (cursor < until) {
    const end = new Date(Math.min(cursor.getTime() + maxMs, until.getTime()));
    windows.push({ start: new Date(cursor), end });
    cursor = end;
  }

  return windows;
}

/**
 * 번개장터 주문 상태를 delivery 객체 기반으로 정확히 판단합니다.
 *
 * item.status 는 번개장터 API에서 결제 상태(PAYMENT_RECEIVED 등)를 반환하는 경우가
 * 많아 배송 상태를 단독으로 판단하기에 부정확합니다.
 * 실제 배송 흐름은 delivery 객체의 invoice / shipDoneAt 필드와
 * item의 purchaseConfirmedAt / refundedAt 으로 파악합니다.
 *
 * 우선순위:
 * 1. 취소/환불 (item.status CANCELLED·REFUNDED 또는 refundedAt)
 * 2. 구매 확정 → DELIVERED (purchaseConfirmedAt)
 * 3. 배송 완료 표시 (item.status DELIVERED)
 * 4. 배송 중 (invoice 번호 또는 shipDoneAt 존재)
 * 5. 출고 준비 (item.status PREPARING)
 * 6. 기본값 → PAID
 */
function deriveShippingStatus(
  item: {
    status?: string;
    purchaseConfirmedAt?: string | null;
    refundedAt?: string | null;
  },
  delivery?: {
    invoice?: { no?: string | null } | null;
    shipDoneAt?: string | null;
  } | null
): StandardOrder["shippingStatus"] {
  const st = (item.status ?? "").toUpperCase();

  // 1. 취소 / 환불
  if (
    ["CANCELLED", "CANCEL_REQUESTED", "REFUNDED", "REFUND_REQUESTED"].includes(st) ||
    item.refundedAt
  ) {
    return "CANCELLED";
  }

  // 2. 구매 확정 = 배송 완료
  if (item.purchaseConfirmedAt) return "DELIVERED";

  // 3. API가 명시적으로 DELIVERED 반환
  if (st === "DELIVERED" || st === "PURCHASE_CONFIRMED") return "DELIVERED";

  // 4. 배송 중 (송장번호 있거나 출고 일시 존재)
  const hasInvoice = !!(delivery?.invoice?.no?.trim());
  const hasShipDate = !!(delivery?.shipDoneAt);
  if (hasInvoice || hasShipDate || st === "IN_DELIVERY") return "SHIPPED";

  // 5. 출고 준비
  if (st === "PREPARING") return "READY";

  // 6. 결제 완료 (기본)
  return "PAID";
}

function report(
  progress: ProgressReporter | undefined,
  phase: Parameters<NonNullable<ProgressReporter>>[0]["phase"],
  message: string,
  current?: number,
  total?: number
): void {
  progress?.({
    runId: "",
    siteId: 0,
    siteCode: config.code,
    phase,
    message,
    ...(current !== undefined ? { current } : {}),
    ...(total !== undefined ? { total } : {})
  });
}

// ──────────────────────────────────────────────
// BunjangExtractor
// ──────────────────────────────────────────────

export class BunjangExtractor extends BaseExtractor {
  private accessKey: string | null = null;
  private secretKeyBuf: Buffer | null = null;

  constructor(extractorConfig: ExtractorConfig = config as ExtractorConfig) {
    super(extractorConfig);
  }

  // ── 인증된 API 요청 ────────────────────────

  private apiFetch(urlPath: string, method = "GET"): Promise<Response> {
    if (!this.accessKey || !this.secretKeyBuf) {
      throw new Error("번개장터 인증이 필요합니다 (accessKey/secretKey 미설정)");
    }
    const token = createJWT(this.accessKey, this.secretKeyBuf, method);
    return fetch(`${BASE_URL}${urlPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    });
  }

  // ── BaseExtractor 추상 메서드 구현 ────────

  /**
   * 자격증명을 인스턴스에 저장하고 API 연결을 검증합니다.
   * page 파라미터는 브라우저 기반 추출기와의 인터페이스 호환을 위해 존재하며
   * 번개장터 API 추출에서는 사용되지 않습니다.
   */
  async login(
    _page: Page,
    credentials: Credentials,
    progress?: ProgressReporter
  ): Promise<void> {
    report(progress, "login", "번개장터 API 인증 중...");

    this.accessKey = credentials.username.trim();
    this.secretKeyBuf = Buffer.from(credentials.password.trim(), "base64");

    // 경량 API 호출로 자격증명 유효성 검증
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const qs = new URLSearchParams({
      statusUpdateStartDate: yesterday.toISOString(),
      statusUpdateEndDate: now.toISOString(),
      page: "0",
      size: "1"
    });

    const res = await this.apiFetch(`/api/v1/orders?${qs}`);

    if (!res.ok && res.status !== 404) {
      const body = await res.text().catch(() => "");
      let reason = body;
      try {
        const parsed = JSON.parse(body) as { errorCode?: string; reason?: string };
        reason = parsed.reason ?? parsed.errorCode ?? body;
      } catch {
        // 파싱 실패 시 원문 사용
      }
      this.accessKey = null;
      this.secretKeyBuf = null;
      throw new Error(`번개장터 API 인증 실패 (HTTP ${res.status}): ${reason}`);
    }

    report(progress, "login", "번개장터 API 인증 완료");
  }

  /**
   * 현재 인스턴스에 유효한 자격증명이 로드되어 있는지 확인합니다.
   * API 기반 추출기이므로 브라우저 세션이 아닌 인스턴스 상태를 기준으로 판단합니다.
   */
  async isLoggedIn(_page: Page): Promise<boolean> {
    return this.accessKey !== null && this.secretKeyBuf !== null;
  }

  /**
   * 번개장터 구매 내역을 추출합니다.
   *
   * 1. List Orders API (statusUpdateStartDate/End 기반, 14일 단위 분할)로 orderId 수집
   * 2. Get Order API로 각 주문의 상세 정보(상품명, 가격, 송장, 배송지 등) 조회
   * 3. StandardOrder 배열로 변환하여 반환
   */
  async extractOrders(
    _page: Page,
    options: ExtractionOptions,
    progress?: ProgressReporter
  ): Promise<StandardOrder[]> {
    if (!this.accessKey || !this.secretKeyBuf) {
      throw new Error("번개장터 인증이 필요합니다");
    }

    // ── 1. 날짜 범위 설정 ──
    const since = options.since
      ? new Date(options.since)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 기본: 30일
    const until = options.until ? new Date(options.until) : new Date();

    const windows = splitInto14DayWindows(since, until);

    report(
      progress,
      "extracting",
      `날짜 범위 ${since.toISOString().slice(0, 10)} ~ ${until.toISOString().slice(0, 10)}을 ${windows.length}개 구간으로 분할합니다.`,
      0,
      windows.length
    );

    // ── 2. 주문 ID 수집 (List Orders) ──
    const orderIdSet = new Set<number>();

    for (let wi = 0; wi < windows.length; wi++) {
      const { start, end } = windows[wi];
      let pageNum = 0;
      let totalPages = 1;

      while (pageNum < totalPages) {
        const qs = new URLSearchParams({
          statusUpdateStartDate: start.toISOString(),
          statusUpdateEndDate: end.toISOString(),
          page: String(pageNum),
          size: String(PAGE_SIZE)
        });

        const res = await this.apiFetch(`/api/v1/orders?${qs}`);

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(
            `List Orders 실패 (HTTP ${res.status}): ${body.slice(0, 200)}`
          );
        }

        const json = (await res.json()) as {
          data?: Array<{ id: number }>;
          totalPages?: number;
        };

        for (const order of json.data ?? []) {
          orderIdSet.add(order.id);
        }

        totalPages = json.totalPages ?? 1;
        pageNum++;
      }

      report(
        progress,
        "extracting",
        `주문 목록 조회 중 (${wi + 1}/${windows.length}) — 누적 ${orderIdSet.size}건`,
        wi + 1,
        windows.length
      );
    }

    // ── 3. 주문 상세 조회 (Get Order) ──
    const orderIds = Array.from(orderIdSet);

    report(
      progress,
      "extracting",
      `주문 상세 조회 시작: 총 ${orderIds.length}건`,
      0,
      orderIds.length
    );

    const orders: StandardOrder[] = [];

    for (let i = 0; i < orderIds.length; i++) {
      const orderId = orderIds[i];
      const res = await this.apiFetch(`/api/v1/orders/${orderId}`);

      if (!res.ok) {
        report(
          progress,
          "extracting",
          `주문 #${orderId} 조회 실패 (HTTP ${res.status}), 건너뜁니다.`
        );
        continue;
      }

      const json = (await res.json()) as {
        data?: {
          order?: {
            id: number;
            totalPrice?: number;
            totalProductPrice?: number;
            deliveryPrice?: number;
            orderDoneAt?: string;
            approvedAt?: string;
            orderItems?: Array<{
              id: number;
              status?: string;
              product?: { id?: number; name?: string; price?: number };
              purchaseConfirmedAt?: string;
              refundedAt?: string;
              statusUpdatedAt?: string;
              shippingFeeIncluded?: boolean;
              returnRequestId?: number;
            }>;
          };
          seller?: { id?: number; shopName?: string };
          delivery?: {
            invoice?: {
              no?: string;
              companyCode?: string;
              companyName?: string;
            };
            address?: {
              name?: string;
              phone?: string;
              address1?: string;
              address2?: string;
              zipCode?: string;
            };
            shipDoneAt?: string;
          };
          returns?: Array<{
            id?: number;
            invoice?: { no?: string; companyCode?: string; companyName?: string };
          }>;
        };
      };

      const detail = json.data;
      const order = detail?.order;
      const delivery = detail?.delivery;
      const seller = detail?.seller;

      if (!order) continue;

      for (const item of order.orderItems ?? []) {
        // 주문일: orderDoneAt > approvedAt > statusUpdatedAt 순으로 fallback
        const orderDate = (
          order.orderDoneAt ??
          order.approvedAt ??
          item.statusUpdatedAt ??
          ""
        ).slice(0, 10);

        const productName =
          item.product?.name?.trim() || `상품 #${item.product?.id ?? orderId}`;

        const invoiceNo = delivery?.invoice?.no ?? null;
        const carrier = delivery?.invoice?.companyName ?? null;
        const carrierCode = delivery?.invoice?.companyCode ?? null;

        orders.push({
          orderNumber: `BUNJANG-${item.id}`,
          orderDate,
          productName,
          quantity: 1,
          amount: item.product?.price ?? 0,
          currency: "KRW",
          invoiceNumber: invoiceNo,
          invoiceUrl: null,
          shippingStatus: deriveShippingStatus(item, delivery),
          // 셀러 API의 order.id가 구매자 URL의 purchases/{id}와 동일 (= 카드 승인 번호).
          sourceOrderRef: String(order.id),
          rawData: JSON.stringify({
            source: "bunjang",
            orderId: order.id,
            orderItemId: item.id,
            productId: item.product?.id ?? null,
            // 배송 / 송장
            carrier,
            carrierCode,
            trackingNumber: invoiceNo, // IPC 레이어에서 tracking_number 컬럼으로 자동 승격
            // 배송지
            buyerName: delivery?.address?.name ?? null,
            buyerPhone: delivery?.address?.phone ?? null,
            address1: delivery?.address?.address1 ?? null,
            address2: delivery?.address?.address2 ?? null,
            zipCode: delivery?.address?.zipCode ?? null,
            // 판매자
            sellerShopName: seller?.shopName ?? null,
            // 가격 내역
            totalPrice: order.totalPrice ?? null,
            totalProductPrice: order.totalProductPrice ?? null,
            deliveryPrice: order.deliveryPrice ?? null,
            // 타임스탬프
            orderDoneAt: order.orderDoneAt ?? null,
            approvedAt: order.approvedAt ?? null,
            shipDoneAt: delivery?.shipDoneAt ?? null,
            purchaseConfirmedAt: item.purchaseConfirmedAt ?? null,
            refundedAt: item.refundedAt ?? null
          })
        });
      }

      report(
        progress,
        "extracting",
        `주문 상세 조회 중 (${i + 1}/${orderIds.length}) — #${orderId} 처리 완료`,
        i + 1,
        orderIds.length
      );
    }

    report(
      progress,
      "extracting",
      `번개장터 추출 완료: ${orders.length}건`
    );

    return orders;
  }
}

export default BunjangExtractor;
