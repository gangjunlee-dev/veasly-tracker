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
import {
  buildInvoiceUrl,
  extractOrdOptNoFromUrl,
  extractSourceOrderNumberFromUrl,
  makeMusinsaOrderNumber,
  mapMusinsaStatus,
  parseMoney,
  parseTrackingText
} from "./parser";
import { MUSINSA_SELECTORS, MUSINSA_URLS } from "./selectors";

type DetailLink = {
  url: string;
  text: string;
};

type TrackingTarget = {
  index: number;
  href?: string;
  text: string;
  containerText: string;
};

type ParsedDetailItem = {
  brandName?: string;
  productName: string;
  optionName?: string;
  quantity: number;
  amount: number;
  shippingStatus: string;
  shippingMessage?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function orderDateFromSourceOrderNumber(sourceOrderNumber: string): string {
  const compact = sourceOrderNumber.slice(0, 8);

  if (!/^\d{8}$/.test(compact)) {
    return new Date().toISOString().slice(0, 10);
  }

  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function normalizeLines(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
}

function unique<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function parseDetailItemFromText(containerText: string, fallbackIndex: number): ParsedDetailItem {
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
    lines.find((line) => /^(FREE|XS|S|M|L|XL|XXL|BLACK|WHITE|BROWN|NAVY|GRAY|GREY|BEIGE)$/i.test(line));

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

function isMusinsaActionButtonLine(line: string): boolean {
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

function pickMusinsaStatusLine(lines: string[]): string | undefined {
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
function parseQuantityAndOption(line?: string): {
  optionName?: string;
  quantity: number;
} {
  if (!line) {
    return {
      quantity: 1
    };
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

function isLikelyProductAmountLine(line: string, previousLine?: string): boolean {
  if (!/\d{1,3}(,\d{3})*\s*원/.test(line) && !/\d+\s*원/.test(line)) {
    return false;
  }

  if (!previousLine || !/(\d+)\s*개/.test(previousLine)) {
    return false;
  }

  return true;
}

function isInvalidProductName(line?: string): boolean {
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

function cleanProductName(line: string): string {
  return line
    .replace(/\s*\/\s*\d+\s*개\s*$/g, "")
    .trim();
}

function parseDetailItemsFromBodyText(
  bodyText: string,
  _sourceOrderNumber: string
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
async function getBodyText(page: Page): Promise<string> {
  try {
    return await page.locator("body").innerText({ timeout: 5000 });
  } catch {
    return "";
  }
}

async function waitForManualLogin(page: Page, progress?: ProgressReporter): Promise<void> {
  const maxWaitMs = 5 * 60 * 1000;
  const startedAt = Date.now();

  progress?.({
    runId: "",
    siteId: 0,
    siteCode: config.code,
    phase: "login",
    message: "무신사 주문내역 페이지로 이동합니다. 로그인 화면이 보이면 브라우저에서 수동 로그인해 주세요."
  });

  await page.goto(MUSINSA_URLS.orderList, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  while (Date.now() - startedAt < maxWaitMs) {
    const url = page.url();
    const passwordInputs = await page.locator("input[type='password']").count().catch(() => 0);
    const detailLinkCount = await page
      .locator(MUSINSA_SELECTORS.orderDetailLinks.join(","))
      .count()
      .catch(() => 0);

    const bodyText = await getBodyText(page);

    const looksLikeOrderList =
      url.includes("/order/order-list") &&
      passwordInputs === 0 &&
      (detailLinkCount > 0 || /주문\s*상세|배송\s*조회|배송조회|주문번호/.test(bodyText));

    if (looksLikeOrderList) {
      progress?.({
        runId: "",
        siteId: 0,
        siteCode: config.code,
        phase: "login",
        message: "무신사 로그인/주문내역 접근 확인 완료"
      });
      return;
    }

    progress?.({
      runId: "",
      siteId: 0,
      siteCode: config.code,
      phase: "login",
      message: "무신사 로그인 대기 중입니다. 브라우저에서 로그인을 완료해 주세요."
    });

    await sleep(3000);
  }

  throw new Error("무신사 로그인 대기 시간이 초과되었습니다. 다시 실행 후 브라우저에서 로그인을 완료해 주세요.");
}

async function collectDetailLinks(page: Page): Promise<DetailLink[]> {
  const anchorLinks = await page
    .locator(MUSINSA_SELECTORS.orderDetailLinks.join(","))
    .evaluateAll((elements) => {
      return elements.map((element) => {
        const anchor = element as HTMLAnchorElement;
        return {
          url: anchor.href,
          text: anchor.innerText || anchor.textContent || ""
        };
      });
    })
    .catch(() => []);

  const html = await page.content().catch(() => "");

  const absoluteMatches = Array.from(
    html.matchAll(/https?:\/\/www\.musinsa\.com\/order\/order-detail\/\d+/g)
  ).map((match) => ({
    url: match[0],
    text: ""
  }));

  const relativeMatches = Array.from(
    html.matchAll(/\/order\/order-detail\/\d+/g)
  ).map((match) => ({
    url: `https://www.musinsa.com${match[0]}`,
    text: ""
  }));

  return unique(
    [...anchorLinks, ...absoluteMatches, ...relativeMatches]
      .filter((link) => link.url && link.url.includes("/order/order-detail/"))
      .map((link) => ({
        url: link.url,
        text: link.text.trim()
      })),
    (link) => link.url
  );
}

function trackingLocator(page: Page) {
  return page.locator(
    [
      "a[href*='/order-service/my/delivery/trace']",
      "button:has-text('배송 조회')",
      "button:has-text('배송조회')",
      "a:has-text('배송 조회')",
      "a:has-text('배송조회')",
      "[role='button']:has-text('배송 조회')",
      "[role='button']:has-text('배송조회')"
    ].join(",")
  );
}

async function collectTrackingTargets(page: Page): Promise<TrackingTarget[]> {
  const locator = trackingLocator(page);
  const count = await locator.count().catch(() => 0);
  const targets: TrackingTarget[] = [];

  for (let i = 0; i < count; i += 1) {
    const element = locator.nth(i);

    const data = await element
      .evaluate((node) => {
        const el = node as HTMLElement;
        const anchor = el.closest("a") as HTMLAnchorElement | null;

        let current: HTMLElement | null = el;
        let selected: HTMLElement | null = el;

        for (let depth = 0; current && depth < 12; depth += 1) {
          const text = current.innerText || "";

          if (text.length > 20 && /원|개|배송|출고|결제|도착|예정/.test(text)) {
            selected = current;
          }

          if (
            text.length > 80 &&
            /원/.test(text) &&
            /배송|출고|결제|도착|예정/.test(text)
          ) {
            break;
          }

          current = current.parentElement;
        }

        return {
          href: anchor?.href || el.getAttribute("href") || undefined,
          text: el.innerText || el.textContent || "",
          containerText: selected?.innerText || el.parentElement?.innerText || ""
        };
      })
      .catch(() => undefined);

    if (!data) continue;

    const text = data.text.trim();
    const containerText = data.containerText.trim();

    if (!/배송\s*조회|배송조회/.test(`${text}\n${containerText}`)) {
      continue;
    }

    targets.push({
      index: i,
      href: data.href,
      text,
      containerText
    });
  }

  const html = await page.content().catch(() => "");

  const absoluteTraceMatches = Array.from(
    html.matchAll(
      /https?:\/\/www\.musinsa\.com\/order-service\/my\/delivery\/trace\?[^"'<>\\\s]+/g
    )
  ).map((match, index) => ({
    index: count + index,
    href: match[0].replace(/&amp;/g, "&"),
    text: "배송조회 URL",
    containerText: ""
  }));

  const relativeTraceMatches = Array.from(
    html.matchAll(/\/order-service\/my\/delivery\/trace\?[^"'<>\\\s]+/g)
  ).map((match, index) => ({
    index: count + absoluteTraceMatches.length + index,
    href: `https://www.musinsa.com${match[0].replace(/&amp;/g, "&")}`,
    text: "배송조회 URL",
    containerText: ""
  }));

  return unique(
    [...targets, ...absoluteTraceMatches, ...relativeTraceMatches],
    (target) => target.href || `${target.index}-${target.text}-${target.containerText.slice(0, 40)}`
  );
}

async function openTrackingAndReadText(
  page: Page,
  target: TrackingTarget
): Promise<{
  trackingText: string;
  trackingUrl?: string;
}> {
  if (target.href && target.href.includes("/order-service/my/delivery/trace")) {
    await page.goto(target.href, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(1500);

    return {
      trackingText: await getBodyText(page),
      trackingUrl: page.url()
    };
  }

  const locator = trackingLocator(page);
  const count = await locator.count().catch(() => 0);

  if (target.index >= count) {
    return {
      trackingText: "",
      trackingUrl: undefined
    };
  }

  const beforeUrl = page.url();

  const popupPromise = page
    .waitForEvent("popup", { timeout: 5000 })
    .catch(() => null);

  const urlChangePromise = page
    .waitForURL((url) => url.toString() !== beforeUrl, {
      timeout: 10000,
      waitUntil: "domcontentloaded"
    })
    .catch(() => null);

  await locator.nth(target.index).click({ timeout: 10000 });

  const popup = await popupPromise;
  await urlChangePromise;

  if (popup) {
    await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
    await popup.waitForTimeout(1500);

    const trackingText = await getBodyText(popup);
    const trackingUrl = popup.url();

    await popup.close().catch(() => undefined);

    return {
      trackingText,
      trackingUrl
    };
  }

  await page.waitForTimeout(1500);

  return {
    trackingText: await getBodyText(page),
    trackingUrl: page.url()
  };
}

async function extractOrdersFromDetailPage(
  page: Page,
  detailUrl: string,
  detailIndex: number,
  includeNoTracking: boolean,
  progress?: ProgressReporter
): Promise<StandardOrder[]> {
  await page.goto(detailUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(1500);

  const currentUrl = page.url();
  const bodyText = await getBodyText(page);
  const sourceOrderNumber =
    extractSourceOrderNumberFromUrl(currentUrl) ||
    bodyText.match(/\b20\d{12,}\b/)?.[0] ||
    `UNKNOWN-${detailIndex}`;

  const orderDate = orderDateFromSourceOrderNumber(sourceOrderNumber);
  const detailItems = parseDetailItemsFromBodyText(bodyText, sourceOrderNumber);

  progress?.({
    runId: "",
    siteId: 0,
    siteCode: config.code,
    phase: "extracting",
    message: `무신사 주문 상세 분석 중: ${sourceOrderNumber}`
  });

  const firstTargets = await collectTrackingTargets(page);

  progress?.({
    runId: "",
    siteId: 0,
    siteCode: config.code,
    phase: "extracting",
    message: `배송조회 버튼/URL 수집 결과: ${sourceOrderNumber} / ${firstTargets.length}건`
  });

  if (firstTargets.length === 0) {
    if (includeNoTracking && detailItems.length > 0) {
      progress?.({
        runId: "",
        siteId: 0,
        siteCode: config.code,
        phase: "extracting",
        message: `배송조회 없음: ${sourceOrderNumber} / 상품 ${detailItems.length}건을 송장 없이 저장합니다.`
      });

      return detailItems.map((item, index) => {
        const lineIndex = index + 1;

        return {
          orderNumber: makeMusinsaOrderNumber(sourceOrderNumber, lineIndex),
          orderDate,
          productName: item.productName,
          quantity: item.quantity,
          amount: item.amount,
          currency: "KRW",
          invoiceNumber: undefined,
          invoiceUrl: undefined,
          shippingStatus: item.shippingStatus,
          rawData: JSON.stringify({
            source: "musinsa",
            sourceOrderNumber,
            lineIndex,
            brandName: item.brandName,
            optionName: item.optionName,
            carrier: undefined,
            trackingNumber: undefined,
            shippingMessage: item.shippingMessage,
            detailUrl,
            trackingUrl: undefined,
            noTracking: true
          })
        };
      });
    }

    progress?.({
      runId: "",
      siteId: 0,
      siteCode: config.code,
      phase: "extracting",
      message: `배송조회 버튼/URL과 상품 row를 모두 찾지 못했습니다: ${sourceOrderNumber}`
    });

    return [];
  }

  const orders: StandardOrder[] = [];

  for (let i = 0; i < firstTargets.length; i += 1) {
    await page.goto(detailUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(1000);

    const currentTargets = await collectTrackingTargets(page);
    const trackingTarget = currentTargets[i];

    if (!trackingTarget) {
      progress?.({
        runId: "",
        siteId: 0,
        siteCode: config.code,
        phase: "extracting",
        message: `배송조회 대상 재수집 실패: ${sourceOrderNumber} / ${i + 1}`
      });
      continue;
    }

    const lineIndex = i + 1;
    const item = detailItems[i] ?? parseDetailItemFromText(trackingTarget.containerText, lineIndex);

    progress?.({
      runId: "",
      siteId: 0,
      siteCode: config.code,
      phase: "extracting",
      message: `배송조회 클릭/확인 중: ${sourceOrderNumber} / ${lineIndex}/${firstTargets.length}`,
      current: lineIndex,
      total: firstTargets.length
    });

    const trackingResult = await openTrackingAndReadText(page, trackingTarget);

    const trackingText = trackingResult.trackingText;
    const finalTrackingUrl = trackingResult.trackingUrl || trackingTarget.href;

    const tracking = parseTrackingText(trackingText);

    const ordOptNo = finalTrackingUrl
      ? extractOrdOptNoFromUrl(finalTrackingUrl)
      : trackingTarget.href
        ? extractOrdOptNoFromUrl(trackingTarget.href)
        : undefined;

    const invoiceUrl =
      finalTrackingUrl && finalTrackingUrl.includes("/order-service/my/delivery/trace")
        ? finalTrackingUrl
        : buildInvoiceUrl(sourceOrderNumber, ordOptNo) || trackingTarget.href;

    const trackingFallbackStatus = trackingText ? mapMusinsaStatus(trackingText) : "PENDING";
    const shippingStatus =
      tracking.trackingStatus ||
      (trackingFallbackStatus !== "PENDING" ? trackingFallbackStatus : item.shippingStatus);

    orders.push({
      orderNumber: makeMusinsaOrderNumber(sourceOrderNumber, lineIndex),
      orderDate,
      productName: item.productName,
      quantity: item.quantity,
      amount: item.amount,
      currency: "KRW",
      invoiceNumber: tracking.trackingNumber,
      invoiceUrl,
      shippingStatus,
      rawData: JSON.stringify({
        source: "musinsa",
        sourceOrderNumber,
        lineIndex,
        ordOptNo,
        brandName: item.brandName,
        optionName: item.optionName,
        carrier: tracking.carrier,
        trackingNumber: tracking.trackingNumber,
        shippingMessage: item.shippingMessage,
        detailUrl,
        trackingUrl: invoiceUrl,
        trackingButtonText: trackingTarget.text
      })
    });

    await page.goto(detailUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(800);
  }

  return orders;
}

class MusinsaExtractor extends BaseExtractor {
  constructor(extractorConfig: ExtractorConfig = config) {
    super(extractorConfig);
  }

  async login(
    page: Page,
    _credentials: Credentials,
    progress?: ProgressReporter
  ): Promise<void> {
    await waitForManualLogin(page, progress);
  }

  async isLoggedIn(page: Page): Promise<boolean> {
    await page.goto(MUSINSA_URLS.orderList, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    const passwordInputs = await page.locator("input[type='password']").count().catch(() => 0);
    const bodyText = await getBodyText(page);
    const detailLinks = await collectDetailLinks(page).catch(() => []);

    return (
      passwordInputs === 0 &&
      (detailLinks.length > 0 || /주문\s*상세|배송\s*조회|배송조회|주문번호/.test(bodyText))
    );
  }

  async extractOrders(
    page: Page,
    options: ExtractionOptions,
    progress?: ProgressReporter
  ): Promise<StandardOrder[]> {
    progress?.({
      runId: "",
      siteId: 0,
      siteCode: this.config.code,
      phase: "extracting",
      message: "무신사 주문 목록을 수집합니다."
    });

    await page.goto(MUSINSA_URLS.orderList, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(3000);

    const detailLinks = await collectDetailLinks(page);
    const requestedMaxDetails =
      options.maxPages && options.maxPages > 0 ? options.maxPages : 10;
    const maxDetails = Math.min(detailLinks.length, requestedMaxDetails);
    const targetLinks = detailLinks.slice(0, maxDetails);
    const includeNoTracking = options.includeNoTracking ?? true;

    if (targetLinks.length === 0) {
      progress?.({
        runId: "",
        siteId: 0,
        siteCode: this.config.code,
        phase: "extracting",
        message: "무신사 주문 상세 링크를 찾지 못했습니다."
      });

      return [];
    }

    progress?.({
      runId: "",
      siteId: 0,
      siteCode: this.config.code,
      phase: "extracting",
      message: `무신사 주문 상세 ${targetLinks.length}건을 분석합니다.`,
      current: 0,
      total: targetLinks.length
    });

    const allOrders: StandardOrder[] = [];

    for (let i = 0; i < targetLinks.length; i += 1) {
      const detailLink = targetLinks[i];

      progress?.({
        runId: "",
        siteId: 0,
        siteCode: this.config.code,
        phase: "extracting",
        message: `무신사 주문 상세 진입 중: ${i + 1}/${targetLinks.length}`,
        current: i + 1,
        total: targetLinks.length
      });

      const orders = await extractOrdersFromDetailPage(
        page,
        detailLink.url,
        i + 1,
        includeNoTracking,
        progress
      );

      allOrders.push(...orders);
    }

    progress?.({
      runId: "",
      siteId: 0,
      siteCode: this.config.code,
      phase: "extracting",
      message: `무신사 상품별 주문 ${allOrders.length}건 추출 완료`,
      current: allOrders.length,
      total: allOrders.length
    });

    return allOrders;
  }
}

export default MusinsaExtractor;
