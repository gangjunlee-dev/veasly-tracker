export type MusinsaParsedItem = {
  orderNumber: string;
  sourceOrderNumber: string;
  orderDate?: string;
  brandName?: string;
  productName: string;
  optionName?: string;
  quantity: number;
  amount: number;
  shippingStatus: string;
  shippingMessage?: string;
  carrier?: string;
  trackingNumber?: string;
  invoiceUrl?: string;
  ordOptNo?: string;
};

export function normalizeText(input: string): string {
  return input
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function parseMoney(input?: string): number {
  if (!input) return 0;
  const n = input.replace(/[^\d]/g, "");
  return n ? Number(n) : 0;
}

export function mapMusinsaStatus(text: string): string {
  const normalized = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();

  // Musinsa detail page often contains action buttons such as:
  // "주문 취소", "옵션 변경", "취소 요청".
  // These are NOT order statuses. Only explicit completed cancellation texts
  // such as "취소 완료" or "주문 취소 완료" should be mapped to CANCELLED.
  const cleaned = normalized
    .replace(/주문\s*취소(?!\s*완료)/g, " ")
    .replace(/취소\s*요청/g, " ")
    .replace(/옵션\s*변경/g, " ")
    .replace(/교환\s*요청/g, " ")
    .replace(/반품\s*요청/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/결제\s*오류|결제\s*실패|결제\s*에러/.test(cleaned)) {
    return "PAYMENT_ERROR";
  }

  if (/취소\s*완료|주문\s*취소\s*완료|결제\s*취소\s*완료|환불\s*완료/.test(cleaned)) {
    return "CANCELLED";
  }

  if (/배송\s*완료|배송완료|배달\s*완료|배달완료|도착\s*완료|배송이\s*완료|배달이\s*완료|상품이\s*도착했습니다/.test(cleaned)) {
    return "DELIVERED";
  }

  if (/배송\s*출발|배송\s*시작|배송\s*중|배송중|출고\s*완료|집화|간선|배달\s*출발/.test(cleaned)) {
    return "SHIPPED";
  }

  if (/상품\s*준비\s*중|출고\s*준비|출고\s*예정|배송\s*준비/.test(cleaned)) {
    return "READY";
  }

  if (/결제\s*완료|주문\s*완료/.test(cleaned)) {
    return "PAID";
  }

  return "PENDING";
}

export function extractSourceOrderNumberFromUrl(url: string): string | undefined {
  const match = url.match(/\/order-detail\/(\d+)/);
  return match?.[1];
}

export function extractOrdOptNoFromUrl(url: string): string | undefined {
  const parsed = new URL(url);
  return parsed.searchParams.get("ord_opt_no") || undefined;
}

export function buildInvoiceUrl(sourceOrderNumber: string, ordOptNo?: string): string | undefined {
  if (!sourceOrderNumber || !ordOptNo) return undefined;

  const url = new URL("https://www.musinsa.com/order-service/my/delivery/trace");
  url.searchParams.set("ord_no", sourceOrderNumber);
  url.searchParams.set("ord_opt_no", ordOptNo);
  url.searchParams.set("order_name", "");
  url.searchParams.set("is_return", "0");
  return url.toString();
}

export function parseTrackingText(text: string): {
  carrier?: string;
  trackingNumber?: string;
  trackingStatus?: string;
} {
  const normalized = normalizeText(text);
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let carrier: string | undefined;
  let trackingNumber: string | undefined;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (/택배사|배송사|운송사/.test(line)) {
      const sameLine = line.replace(/택배사|배송사|운송사|[:：]/g, "").trim();
      const nextLine = lines[i + 1]?.trim();

      if (sameLine && !/택배사|배송사|운송사/.test(sameLine)) {
        carrier = sameLine;
      } else if (nextLine) {
        carrier = nextLine;
      }
    }

    if (/송장\s*번호|운송장\s*번호|송장번호|운송장번호/.test(line)) {
      const sameLineNumber = line.match(/\d{8,}/)?.[0];
      const nextLineNumber = lines[i + 1]?.match(/\d{8,}/)?.[0];

      trackingNumber = sameLineNumber || nextLineNumber || trackingNumber;
    }
  }

  if (!trackingNumber) {
    trackingNumber = normalized.match(/\b\d{10,14}\b/)?.[0];
  }

  let trackingStatus: string | undefined;
  if (/배송\s*완료|배송완료/.test(normalized)) trackingStatus = "DELIVERED";
  else if (/배송\s*중|배송중|배송\s*시작|배송시작/.test(normalized)) trackingStatus = "SHIPPED";

  return {
    carrier,
    trackingNumber,
    trackingStatus
  };
}

export function makeMusinsaOrderNumber(sourceOrderNumber: string, lineIndex: number): string {
  return `MUSINSA-${sourceOrderNumber}-${String(lineIndex).padStart(3, "0")}`;
}
