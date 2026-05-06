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

export function mapMusinsaStatus(text?: string): string {
  const value = text || "";

  if (/결제\s*오류|결제오류|결제 실패|결제실패/.test(value)) return "PAYMENT_ERROR";
  if (/취소|환불/.test(value)) return "CANCELLED";
  if (/구매\s*확정|구매확정|배송\s*완료|배송완료|도착/.test(value)) return "DELIVERED";
  if (/배송\s*중|배송중|배송\s*시작|배송시작|출고\s*완료|출고완료/.test(value)) return "SHIPPED";
  if (/출고\s*예정|출고예정|상품\s*준비|상품준비|배송\s*준비|배송준비/.test(value)) return "READY";
  if (/결제\s*완료|결제완료/.test(value)) return "PAID";

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
