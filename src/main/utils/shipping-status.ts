/**
 * 배송 상태 정규화 유틸 (Phase 1)
 *
 * 구매 사이트마다 배송 상태 표기가 제각각이라(무신사 "배송준비중",
 * 올리브영 "상품준비중", 네이버페이 "배송준비" 등) 이를 하나의 정규
 * enum으로 변환한다. 부수효과 없는 순수 함수 — Vitest로 검증한다.
 *
 * 여기서 "shipped"는 판매자/구매 사이트가 발송을 완료한 상태를 뜻한다.
 * 최종 고객에게 배송 완료된 것을 의미하지 않는다.
 */

export type ShippingStatus =
  | "purchased"
  | "awaiting_shipment"
  | "preparing_shipment"
  | "shipped"
  | "partially_shipped"
  | "canceled"
  | "refunded"
  | "unknown";

type Rule = { status: ShippingStatus; keywords: string[] };

/**
 * 위에서부터 순서대로 검사하며 첫 번째로 일치하는 규칙을 채택한다.
 * 구체적인 표현(취소/환불/부분배송)을 일반 표현(배송)보다 먼저 둔다.
 * 영문 키워드는 모두 소문자로 둔다(검사 시 입력을 소문자화하므로).
 */
const RULES: Rule[] = [
  { status: "canceled", keywords: ["취소", "cancel"] },
  { status: "refunded", keywords: ["환불", "반품", "refund", "return"] },
  {
    status: "partially_shipped",
    keywords: ["부분배송", "부분출고", "분할배송", "일부배송", "partial"]
  },
  {
    status: "shipped",
    keywords: [
      "배송완료",
      "배송중",
      "배송시작",
      "배송출발",
      "발송완료",
      "출고완료",
      "구매확정",
      "수령완료",
      "delivered",
      "shipped",
      "shipping"
    ]
  },
  {
    status: "preparing_shipment",
    keywords: ["배송준비", "상품준비", "출고준비", "발송준비", "preparing"]
  },
  {
    status: "awaiting_shipment",
    keywords: [
      "발송대기",
      "출고대기",
      "배송대기",
      "배송예정",
      "발송예정",
      "출고예정",
      "awaiting",
      "pending"
    ]
  },
  {
    status: "purchased",
    keywords: ["결제완료", "주문완료", "주문접수", "구매완료", "ordered", "paid"]
  }
];

function matchByKeyword(text: string): ShippingStatus {
  for (const rule of RULES) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) {
      return rule.status;
    }
  }
  return "unknown";
}

export type NormalizeShippingStatusOptions = {
  /**
   * 송장번호/택배사 정보가 있으면 true.
   * 상태 텍스트로 판별이 안 될 때(unknown)에 한해 'shipped'로 보정한다.
   * 텍스트가 명확하면(예: "상품준비중") 보정하지 않고 원 판정을 유지해
   * 데이터 충돌 정보를 잃지 않는다 — 충돌 해소는 '미발송' 판정 단계에서.
   */
  hasTracking?: boolean;
};

/**
 * 사이트별 원문 배송 상태 텍스트를 정규 ShippingStatus로 변환한다.
 *
 * @param rawStatus 사이트에서 추출한 원문 상태 텍스트
 * @param options   hasTracking: 송장/택배사 정보 존재 여부(보정용)
 */
export function normalizeShippingStatus(
  rawStatus: string | null | undefined,
  options: NormalizeShippingStatusOptions = {}
): ShippingStatus {
  const text = String(rawStatus ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();

  if (!text) {
    return options.hasTracking ? "shipped" : "unknown";
  }

  const matched = matchByKeyword(text);

  if (matched === "unknown" && options.hasTracking) {
    return "shipped";
  }

  return matched;
}
