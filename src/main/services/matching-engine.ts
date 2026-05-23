/**
 * 매칭 엔진 — tracker 주문 ↔ Admin 아이템 다중 기준 점수 매칭
 *
 * L1: 구매 URL 주문번호 매칭 → +100
 * L2: 국내 송장번호 매칭 → +80
 * L3: 카드 승인번호 매칭 → +70
 * L4: 상품 URL 매칭 → +50
 * L5: 금액 + 날짜 매칭 → +30
 *
 * 총점 80+ → 자동 매칭
 * 총점 50~79 → 수동 확인 제안
 * 총점 <50 → 매칭 실패
 */

import { normalizeTrackingNumber } from "../utils/tracking";

export interface TrackerOrder {
  id: number;
  siteCode: string;
  orderNumber: string;
  orderDate: string;
  productName: string;
  amount: number;
  trackingNumber: string | null;
  normalizedTrackingNumber: string | null;
  invoiceNumber: string | null;
  rawData: Record<string, any>;
}

export interface AdminItem {
  id: number;  // admin_order_items.id
  adminOrderId: number;
  veaslyOrderNumber: string;
  orderItemNumber: string;
  productName: string;
  brand: string;
  detailUrl: string;
  priceKRW: number;
  status: string;
  purchaseUrl: string | null;
  purchasePrice: number | null;
  cardApprovalCode: string | null;
  domesticTracking: string | null;
  orderedAt: string;
}

export interface MatchResult {
  trackerOrderId: number;
  adminItemId: number;
  score: number;
  reasons: string[];
  type: "AUTO" | "SUGGEST" | "NONE";
}

// ─── URL에서 주문번호 추출 ───

const ORDER_NUMBER_PATTERNS: Array<{
  domain: string;
  extract: (url: string) => string | null;
}> = [
  {
    // 무신사: /order/order-detail/202605181502300004
    domain: "musinsa.com",
    extract: (url) => {
      const m = url.match(/order-detail\/(\d+)/);
      return m ? m[1] : null;
    },
  },
  {
    // 29CM: eqlstore.com/.../ORD/OD202605194123006/orderInfo
    domain: "eqlstore.com",
    extract: (url) => {
      const m = url.match(/ORD\/(OD\d+)/);
      return m ? m[1] : null;
    },
  },
  {
    // 번개장터: order.bunjang.co.kr/purchases/95862042
    domain: "bunjang.co.kr",
    extract: (url) => {
      const m = url.match(/purchases\/(\d+)/);
      return m ? m[1] : null;
    },
  },
  {
    // 올리브영: 주문번호 패턴 다양
    domain: "oliveyoung",
    extract: (url) => {
      const m = url.match(/order[_-]?(?:id|no|num)[=\/]([A-Za-z0-9-]+)/i);
      return m ? m[1] : null;
    },
  },
];

/** purchase URL에서 쇼핑몰 주문번호 추출 */
export function extractOrderNumberFromUrl(url: string): string | null {
  if (!url) return null;
  for (const pat of ORDER_NUMBER_PATTERNS) {
    if (url.includes(pat.domain)) {
      return pat.extract(url);
    }
  }
  // 범용 fallback: URL의 마지막 숫자 시퀀스 (8자리 이상)
  const segments = url.split(/[/?&#=]/);
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i].trim();
    if (/^\d{8,}$/.test(seg)) return seg;
    // order_id=20260518-0000376 패턴
    if (/^\d{8}-\d+$/.test(seg)) return seg;
  }
  return null;
}

/** 상품 URL 정규화 (쿼리 파라미터 제거, 소문자) */
function normalizeProductUrl(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    // 핵심 path만 남기고 추적 파라미터 제거
    return `${u.hostname}${u.pathname}`.toLowerCase().replace(/\/+$/, "");
  } catch {
    return url.toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

/** 날짜 차이 (일수) */
function daysDiff(dateA: string, dateB: string): number {
  try {
    const a = new Date(dateA).getTime();
    const b = new Date(dateB).getTime();
    return Math.abs(a - b) / (1000 * 60 * 60 * 24);
  } catch {
    return Infinity;
  }
}

// ─── 메인 매칭 함수 ───

export function matchOne(
  tracker: TrackerOrder,
  admin: AdminItem
): MatchResult {
  const reasons: string[] = [];
  let score = 0;

  // L1: 구매 URL 주문번호 매칭 (+100)
  if (admin.purchaseUrl) {
    const adminOrderNo = extractOrderNumberFromUrl(admin.purchaseUrl);
    if (adminOrderNo) {
      const trackerSourceNo = tracker.rawData?.sourceOrderNumber;
      const trackerOrderId = tracker.rawData?.orderId;

      if (
        trackerSourceNo &&
        (String(trackerSourceNo) === adminOrderNo ||
          String(trackerSourceNo).includes(adminOrderNo) ||
          adminOrderNo.includes(String(trackerSourceNo)))
      ) {
        score += 100;
        reasons.push("L1_PURCHASE_URL");
      } else if (trackerOrderId && String(trackerOrderId) === adminOrderNo) {
        score += 100;
        reasons.push("L1_PURCHASE_URL_ORDER_ID");
      }
    }
  }

  // L2: 국내 송장번호 매칭 (+80)
  if (admin.domesticTracking && tracker.normalizedTrackingNumber) {
    const adminNorm = normalizeTrackingNumber(admin.domesticTracking);
    if (
      adminNorm &&
      adminNorm === tracker.normalizedTrackingNumber
    ) {
      score += 80;
      reasons.push("L2_DOMESTIC_TRACKING");
    }
  }
  // fallback: invoiceNumber 비교
  if (
    score < 80 &&
    admin.domesticTracking &&
    tracker.invoiceNumber
  ) {
    const adminNorm = normalizeTrackingNumber(admin.domesticTracking);
    const trackerNorm = normalizeTrackingNumber(tracker.invoiceNumber);
    if (adminNorm && trackerNorm && adminNorm === trackerNorm) {
      score += 80;
      reasons.push("L2_INVOICE_NUMBER");
    }
  }

  // L3: 카드 승인번호 매칭 (+70)
  if (admin.cardApprovalCode && tracker.rawData?.cardApprovalCode) {
    if (
      String(admin.cardApprovalCode) ===
      String(tracker.rawData.cardApprovalCode)
    ) {
      score += 70;
      reasons.push("L3_CARD_APPROVAL");
    }
  }

  // L4: 상품 URL 매칭 (+50)
  if (admin.detailUrl && tracker.rawData?.detailUrl) {
    const adminNorm = normalizeProductUrl(admin.detailUrl);
    const trackerNorm = normalizeProductUrl(
      tracker.rawData.detailUrl
    );
    if (adminNorm && trackerNorm && adminNorm === trackerNorm) {
      score += 50;
      reasons.push("L4_PRODUCT_URL");
    }
  }

  // L5: 금액 + 날짜 매칭 (+30)
  if (admin.purchasePrice && tracker.amount) {
    const amountMatch =
      admin.purchasePrice === tracker.amount ||
      Math.abs(admin.purchasePrice - tracker.amount) <= 100; // ±100원 허용
    const dateClose = daysDiff(admin.orderedAt, tracker.orderDate) <= 3;

    if (amountMatch && dateClose) {
      score += 30;
      reasons.push("L5_AMOUNT_DATE");
    } else if (amountMatch) {
      score += 15;
      reasons.push("L5_AMOUNT_ONLY");
    }
  }

  const type: MatchResult["type"] =
    score >= 80 ? "AUTO" : score >= 50 ? "SUGGEST" : "NONE";

  return {
    trackerOrderId: tracker.id,
    adminItemId: admin.id,
    score,
    reasons,
    type,
  };
}

/**
 * 여러 tracker 주문과 admin 아이템을 매칭.
 * 최고 점수 매칭만 반환 (1:1 매칭 보장).
 */
export function matchAll(
  trackerOrders: TrackerOrder[],
  adminItems: AdminItem[]
): MatchResult[] {
  // 모든 조합의 점수 계산
  const allScores: MatchResult[] = [];
  for (const tracker of trackerOrders) {
    for (const admin of adminItems) {
      const result = matchOne(tracker, admin);
      if (result.score > 0) {
        allScores.push(result);
      }
    }
  }

  // 점수 내림차순 정렬
  allScores.sort((a, b) => b.score - a.score);

  // 1:1 매칭: 한 tracker 주문은 하나의 admin 아이템에만 매칭
  const usedTracker = new Set<number>();
  const usedAdmin = new Set<number>();
  const results: MatchResult[] = [];

  for (const match of allScores) {
    if (
      usedTracker.has(match.trackerOrderId) ||
      usedAdmin.has(match.adminItemId)
    ) {
      continue;
    }
    results.push(match);
    usedTracker.add(match.trackerOrderId);
    usedAdmin.add(match.adminItemId);
  }

  return results;
}
