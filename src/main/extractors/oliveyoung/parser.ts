export function normalizeText(input: string): string {
  return String(input ?? "")
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

export function normalizeDate(input?: string): string | undefined {
  if (!input) return undefined;

  const text = normalizeText(input);

  const yyyyMmDd = text.match(/(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (yyyyMmDd) {
    const [, y, m, d] = yyyyMmDd;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const compact = text.match(/(20\d{2})(\d{2})(\d{2})/);
  if (compact) {
    const [, y, m, d] = compact;
    return `${y}-${m}-${d}`;
  }

  return undefined;
}

export function parseQuantity(input?: string): number {
  if (!input) return 1;

  const text = normalizeText(input);
  const match =
    text.match(/수량\s*(\d+)/) ||
    text.match(/(\d+)\s*개/) ||
    text.match(/(\d+)\s*ea/i);

  return match ? Number(match[1]) : 1;
}

export function mapOliveYoungStatus(text: string): string {
  const normalized = normalizeText(text);

  if (/주문\s*취소|취소\s*완료|환불/.test(normalized)) return "CANCELLED";
  if (/배송\s*완료|구매\s*확정/.test(normalized)) return "DELIVERED";
  if (/배송\s*중|배송조회|송장|운송장/.test(normalized)) return "SHIPPING";
  if (/배송\s*준비|상품\s*준비|출고\s*준비/.test(normalized)) return "PREPARING";
  if (/결제\s*완료|주문\s*완료/.test(normalized)) return "PAID";

  return normalized.slice(0, 80) || "UNKNOWN";
}

export function makeOliveYoungOrderNumber(sourceOrderNumber: string, lineIndex: number): string {
  const safeSource = sourceOrderNumber || "UNKNOWN";
  return `OLIVEYOUNG-${safeSource}-${String(lineIndex).padStart(3, "0")}`;
}

export function extractOrderNumbers(text: string): string[] {
  const normalized = normalizeText(text);
  const matches = normalized.match(/\b[A-Z]?\d{10,20}\b/g) ?? [];

  return Array.from(new Set(matches)).filter((value) => {
    return /\d{10,}/.test(value);
  });
}
