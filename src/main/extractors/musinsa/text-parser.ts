import { mapMusinsaStatus, parseMoney } from "./parser";
import { normalizeLines } from "./page-utils";

export type ParsedDetailItem = {
  brandName?: string;
  productName: string;
  optionName?: string;
  quantity: number;
  amount: number;
  shippingStatus: string;
  shippingMessage?: string;
};

export function isMusinsaActionButtonLine(line: string): boolean {
  const normalized = String(line ?? "").replace(/\s+/g, " ").trim();

  return (
    /^주문\s*취소$/.test(normalized) ||
    /^취소\s*요청$/.test(normalized) ||
    /^옵션\s*변경$/.test(normalized) ||
    /^교환\s*요청$/.test(normalized) ||
    /^반품\s*요청$/.test(normalized) ||
    /^스냅\s*보기$/.test(normalized)
  );
}

export function pickMusinsaStatusLine(lines: string[]): string | undefined {
  const normalizedLines = lines
    .map((line) => String(line ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !isMusinsaActionButtonLine(line));

  const exactPriority = [
    /^결제\s*오류$/,
    /^결제\s*실패$/,
    /^결제\s*에러$/,
    /^취소\s*완료$/,
    /^주문\s*취소\s*완료$/,
    /^결제\s*취소\s*완료$/,
    /^환불\s*완료$/,
    /^배송\s*완료$/,
    /^배달\s*완료$/,
    /^도착\s*완료$/,
    /^배송\s*출발$/,
    /^배송\s*시작$/,
    /^배송\s*중$/,
    /^상품\s*준비\s*중$/,
    /^출고\s*준비$/,
    /^배송\s*준비$/,
    /^결제\s*완료$/,
    /^주문\s*완료$/
  ];

  for (const pattern of exactPriority) {
    const matched = normalizedLines.find((line) => pattern.test(line));
    if (matched) return matched;
  }

  // Fallback for combined state line such as "결제 완료 05.12(화) 이내 출고 예정".
  // Keep this strict and never treat "주문 취소" alone as cancelled.
  const combinedPriority: Array<{ pattern: RegExp; value: string }> = [
    { pattern: /결제\s*오류|결제\s*실패|결제\s*에러/, value: "결제 오류" },
    { pattern: /취소\s*완료|주문\s*취소\s*완료|결제\s*취소\s*완료|환불\s*완료/, value: "취소 완료" },
    { pattern: /배송\s*완료|배달\s*완료|도착\s*완료/, value: "배송 완료" },
    { pattern: /배송\s*출발|배송\s*시작|배송\s*중/, value: "배송 중" },
    { pattern: /상품\s*준비\s*중|출고\s*준비|배송\s*준비/, value: "상품 준비 중" },
    { pattern: /결제\s*완료|주문\s*완료/, value: "결제 완료" }
  ];

  for (const { pattern, value } of combinedPriority) {
    const matched = normalizedLines.find((line) => pattern.test(line));
    if (matched) return value;
  }

  return undefined;
}

export function parseQuantityAndOption(line?: string): {
  optionName?: string;
  quantity: number;
} {
  if (!line) {
    return { quantity: 1 };
  }

  const quantityMatch = line.match(/(\d+)\s*개/);
  const quantity = quantityMatch?.[1] ? Number(quantityMatch[1]) : 1;

  const optionName = line
    .replace(/\/?\s*\d+\s*개/g, "")
    .replace(/^옵션\s*[:：]?/g, "")
    .replace(/^선택\s*[:：]?/g, "")
    .trim();

  return {
    optionName: optionName || undefined,
    quantity
  };
}

export function isLikelyProductAmountLine(
  line: string,
  previousLine?: string
): boolean {
  if (!/\d{1,3}(,\d{3})*\s*원/.test(line) && !/\d+\s*원/.test(line)) {
    return false;
  }

  if (!previousLine || !/(\d+)\s*개/.test(previousLine)) {
    return false;
  }

  return true;
}

export function isInvalidProductName(line?: string): boolean {
  if (!line) return true;

  return [
    /판매자\s*정보/,
    /상품\s*정보/,
    /배송\s*정보/,
    /결제\s*정보/,
    /주문\s*상품/,
    /주문번호/,
    /취소\s*요청/,
    /스냅\s*보기/,
    /영수증/,
    /거래명세서/,
    /무료배송/,
    /무신사/,
    /^\d{1,3}(,\d{3})*\s*원$/,
    /^\d+\s*개$/
  ].some((pattern) => pattern.test(line));
}

export function cleanProductName(line: string): string {
  return line.replace(/\s*\/\s*\d+\s*개\s*$/g, "").trim();
}

export function parseDetailItemFromText(
  containerText: string,
  fallbackIndex: number
): ParsedDetailItem {
  const lines = normalizeLines(containerText);

  const amountLine =
    lines.find((line) => /\d{1,3}(,\d{3})*\s*원/.test(line)) ||
    lines.find((line) => /\d+\s*원/.test(line));

  const amount = parseMoney(amountLine);

  const quantityLine = lines.find((line) => /(\d+)\s*개/.test(line));
  const quantityMatch = quantityLine?.match(/(\d+)\s*개/);
  const quantity = quantityMatch?.[1] ? Number(quantityMatch[1]) : 1;

  const shippingMessage =
    lines.find((line) => /도착|예정|배송|출고|결제/.test(line)) || undefined;

  const optionLine =
    lines.find((line) => /^옵션\s*[:：]/.test(line)) ||
    lines.find((line) => /^옵션/.test(line)) ||
    lines.find((line) =>
      /^(FREE|XS|S|M|L|XL|XXL|BLACK|WHITE|BROWN|NAVY|GRAY|GREY|BEIGE)$/i.test(
        line
      )
    );

  const optionName = optionLine
    ?.replace(/^옵션\s*[:：]?/g, "")
    .replace(/^선택\s*[:：]?/g, "")
    .trim();

  const excluded = [
    /배송\s*조회/,
    /배송조회/,
    /주문\s*상세/,
    /교환|반품|취소|리뷰/,
    /택배사|송장\s*번호|운송장/,
    /\d{1,3}(,\d{3})*\s*원/,
    /무료배송/,
    /^\d+\s*개$/,
    /^옵션/,
    /도착|예정|배송\s*완료|배송\s*중|배송\s*시작|출고|결제\s*완료|상품\s*준비/
  ];

  const productCandidates = lines.filter((line) => {
    if (line.length < 3) return false;
    return !excluded.some((pattern) => pattern.test(line));
  });

  const productName =
    productCandidates.sort((a, b) => b.length - a.length)[0] ||
    `Musinsa Item ${fallbackIndex}`;

  const productLineIndex = lines.findIndex((line) => line === productName);
  const possibleBrand =
    productLineIndex > 0 && lines[productLineIndex - 1].length <= 30
      ? lines[productLineIndex - 1]
      : undefined;

  const invalidBrandPatterns = [
    /판매자\s*정보/,
    /브랜드\s*정보/,
    /상품\s*정보/,
    /배송\s*정보/,
    /주문\s*정보/,
    /결제\s*정보/,
    /고객\s*센터/,
    /문의/,
    /무신사/
  ];

  const brandName =
    possibleBrand &&
    !excluded.some((pattern) => pattern.test(possibleBrand)) &&
    !invalidBrandPatterns.some((pattern) => pattern.test(possibleBrand)) &&
    possibleBrand !== productName
      ? possibleBrand
      : undefined;

  const statusLine =
    pickMusinsaStatusLine(lines) || pickMusinsaStatusLine([containerText]);
  const statusSource = statusLine || shippingMessage || "";

  return {
    brandName,
    productName,
    optionName,
    quantity,
    amount,
    shippingStatus: mapMusinsaStatus(statusSource),
    shippingMessage
  };
}

export function parseDetailItemsFromBodyText(
  bodyText: string
): ParsedDetailItem[] {
  const lines = normalizeLines(bodyText);

  const globalStatusLine =
    lines.find((line) =>
      /결제\s*완료|상품\s*준비\s*중|출고\s*준비|배송\s*준비|배송\s*시작|배송\s*중|배송\s*완료|구매\s*확정|결제오류|결제\s*오류|취소\s*완료|주문\s*취소\s*완료|결제\s*취소\s*완료|환불\s*완료/.test(
        line
      )
    ) || undefined;

  const globalShippingMessage =
    lines.find((line) =>
      /도착보장|도착\s*예정|이내\s*도착|내일.*도착|오늘.*도착|출고\s*예정/.test(
        line
      )
    ) || undefined;

  const items: ParsedDetailItem[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const amountLine = lines[i];
    const optionLine = lines[i - 1];

    if (!isLikelyProductAmountLine(amountLine, optionLine)) {
      continue;
    }

    let productName = cleanProductName(lines[i - 2] || "");

    if (isInvalidProductName(productName)) {
      productName = cleanProductName(lines[i - 3] || "");
    }

    if (isInvalidProductName(productName)) {
      productName = `Musinsa Item ${items.length + 1}`;
    }

    const sellerInfoIndex = i - 3;
    const possibleBrand =
      sellerInfoIndex >= 1 && /판매자\s*정보/.test(lines[sellerInfoIndex])
        ? lines[sellerInfoIndex - 1]
        : undefined;

    const brandName =
      possibleBrand && !isInvalidProductName(possibleBrand)
        ? possibleBrand
        : undefined;

    const quantityAndOption = parseQuantityAndOption(optionLine);
    const amount = parseMoney(amountLine);
    const localLines = lines.slice(Math.max(0, i - 6), i + 2);
    const localStatusLine =
      pickMusinsaStatusLine(localLines) ||
      pickMusinsaStatusLine([globalStatusLine || ""]);
    const statusSource = localStatusLine || globalShippingMessage || "";

    items.push({
      brandName,
      productName,
      optionName: quantityAndOption.optionName,
      quantity: quantityAndOption.quantity,
      amount,
      shippingStatus: mapMusinsaStatus(statusSource),
      shippingMessage: globalShippingMessage || globalStatusLine
    });
  }

  return items;
}
