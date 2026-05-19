import * as fs from "fs";
import * as path from "path";
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

const NAVERPAY_LOGIN_URL =
  "https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fpay.naver.com%2Fpc%2Fhistory%3Fpage%3D1";

const NAVERPAY_HISTORY_URL = "https://pay.naver.com/pc/history?page=1";

function report(
  progress: ProgressReporter | undefined,
  phase: Parameters<NonNullable<ProgressReporter>>[0]["phase"],
  message: string
): void {
  progress?.({
    runId: "",
    siteId: 0,
    siteCode: config.code,
    phase,
    message
  });
}

async function readBodyText(page: Page, timeout = 1500): Promise<string> {
  return page
    .locator("body")
    .innerText({ timeout })
    .catch(() => "");
}

async function detectNaverPayLoggedIn(page: Page): Promise<boolean> {
  if (page.isClosed()) return false;

  const url = page.url();
  const bodyText = await readBodyText(page, 2000);

  const isLoginPage =
    /nid\.naver\.com/i.test(url) ||
    (/로그인/.test(bodyText) && !/로그아웃|결제내역|결제일시|주문 상세 보기/.test(bodyText));

  if (isLoginPage) return false;

  const isPayHistory = /pay\.naver\.com\/pc\/history/i.test(url);

  const hasHistorySignal =
    /결제내역|결제일시|주문 상세 보기|결제완료|배송|구매확정|상품준비중|취소완료/.test(bodyText);

  return isPayHistory && hasHistorySignal;
}

async function waitForNaverPayManualLogin(
  page: Page,
  progress?: ProgressReporter
): Promise<void> {
  report(
    progress,
    "login",
    "Naver Pay 수동 로그인 시작: 로그인 URL로 1회만 이동합니다."
  );

  await page.goto(NAVERPAY_LOGIN_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  report(
    progress,
    "login",
    "브라우저에서 네이버 로그인을 완료해 주세요. 로그인 대기 중 자동 새로고침은 하지 않습니다."
  );

  const deadline = Date.now() + 10 * 60 * 1000;
  let lastProgressAt = 0;

  while (Date.now() < deadline) {
    if (page.isClosed()) {
      throw new Error("Naver Pay login failed: page was closed during manual login");
    }

    const loggedIn = await detectNaverPayLoggedIn(page);

    if (loggedIn) {
      report(progress, "login", "Naver Pay 수동 로그인 확인 완료");
      return;
    }

    const now = Date.now();
    if (now - lastProgressAt > 10000) {
      lastProgressAt = now;
      report(
        progress,
        "login",
        "Naver Pay 로그인 대기 중입니다. 이 단계에서는 page.goto/reload를 호출하지 않습니다."
      );
    }

    await page.waitForTimeout(2500);
  }

  throw new Error("Naver Pay manual login timed out");
}

function mapNaverPayStatus(rawStatus: string): StandardOrder["shippingStatus"] {
  if (/취소완료|취소접수|취소/.test(rawStatus)) return "CANCELLED";
  if (/배송완료|구매확정/.test(rawStatus)) return "DELIVERED";
  if (/배송중/.test(rawStatus)) return "SHIPPED";
  if (/상품준비중|배송준비|준비중/.test(rawStatus)) return "READY";
  if (/결제완료|결제/.test(rawStatus)) return "PAID";

  return "PAID";
}

function getNaverPayBaseYear(options: ExtractionOptions): number {
  const since = String(options.since || "");
  const until = String(options.until || "");
  const fromSince = /^(\d{4})-/.exec(since)?.[1];
  const fromUntil = /^(\d{4})-/.exec(until)?.[1];

  return Number(fromSince || fromUntil || new Date().getFullYear());
}

function isNaverPayWithinRange(orderDate: string, options: ExtractionOptions): boolean {
  const since = String(options.since || "");
  const until = String(options.until || "");

  if (since && orderDate < since) return false;
  if (until && orderDate > until) return false;

  return true;
}

function hashNaverPayText(text: string): string {
  let hash = 0;

  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }

  return Math.abs(hash).toString(36).toUpperCase();
}

async function collectNaverPayDomDiagnostic(page: Page): Promise<unknown> {
  const result = await page.evaluate(() => {
    const clean = (value: unknown) =>
      String(value || "").replace(/\s+/g, " ").trim();

    const all = Array.from(document.querySelectorAll("div, li, article, section"));

    const candidates = all
      .map((el, index) => {
        const element = el as HTMLElement;
        const text = clean(element.innerText);

        const links = Array.from(element.querySelectorAll("a")).map((a) => {
          const anchor = a as HTMLAnchorElement;

          return {
            text: clean(anchor.innerText),
            href: anchor.href
          };
        });

        const money = Array.from(text.matchAll(/([\d,]+)\s*원/g)).map((m) => m[0]);

        const dates = Array.from(
          text.matchAll(/\d{1,2}\.\s*\d{1,2}|\d{4}\.\s*\d{1,2}\.\s*\d{1,2}/g)
        ).map((m) => m[0]);

        return {
          index,
          tag: element.tagName,
          className: clean(element.className),
          text,
          textLength: text.length,
          money,
          dates,
          links
        };
      })
      .filter((item) => {
        if (item.textLength < 30 || item.textLength > 1500) return false;
        if (item.money.length === 0) return false;

        return /결제일시|주문 상세 보기|결제완료|상품준비중|배송중|배송완료|취소완료|구매확정/.test(
          item.text
        );
      })
      .slice(0, 50);

    return {
      url: location.href,
      title: document.title,
      bodyPreview: clean(document.body?.innerText || "").slice(0, 3000),
      count: candidates.length,
      candidates
    };
  });

  const outputPath = path.join(process.cwd(), "naverpay-dom-diagnostic.json");
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf8");

  return result;
}

async function extractNaverPayOrdersFromCurrentPage(
  page: Page,
  options: ExtractionOptions
): Promise<StandardOrder[]> {
  const baseYear = getNaverPayBaseYear(options);

  const rawItems = await page.evaluate((yearFromNode) => {
    const clean = (value: unknown) =>
      String(value || "").replace(/\s+/g, " ").trim();

    const parseAmountLocal = (text: string) => {
      const match = /([1-9][\d,]*)\s*원/.exec(text);
      if (!match) return 0;

      return Number(match[1].replace(/,/g, ""));
    };

    const parseDateLocal = (text: string) => {
      const match =
        /결제일시\s*(\d{1,2})\.\s*(\d{1,2})\.?/.exec(text) ||
        /(\d{1,2})\.\s*(\d{1,2})\.?/.exec(text);

      if (!match) {
        return new Date().toISOString().slice(0, 10);
      }

      const month = String(Number(match[1])).padStart(2, "0");
      const day = String(Number(match[2])).padStart(2, "0");

      return String(yearFromNode) + "-" + month + "-" + day;
    };

    const parseDetailIdLocal = (detailUrl: string) => {
      const detailMatch = /\/detail\/([^?/#]+)/.exec(detailUrl);
      if (detailMatch?.[1]) return detailMatch[1];

      const statusMatch = /\/status\/([^?/#]+)/.exec(detailUrl);
      if (statusMatch?.[1]) return statusMatch[1];

      return "";
    };

    const cleanProductNameLocal = (text: string, rawStatus: string) => {
      let value = clean(text)
        .replace(/^자세히 보기\s*/, "")
        .replace(/^더보기\s*/, "");

      if (rawStatus) {
        value = value.replace(rawStatus, "").trim();
      }

      const amountMatch = /[1-9][\d,]*\s*원/.exec(value);
      if (amountMatch && typeof amountMatch.index === "number") {
        value = value.slice(0, amountMatch.index).trim();
      }

      return value
        .replace(/^\d{1,2}\.\s*\d{1,2}\.\s*\([^)]*\)\s*취소\s*\([^)]*\)\s*/g, "")
        .replace(/^\d{1,2}\.\s*\d{1,2}\.\s*\([^)]*\)\s*취소\s*/g, "")
        .replace(/^\d{1,2}\.\d{1,2}\.\s*\([^)]*\)\s*취소\s*\([^)]*\)\s*/g, "")
        .replace(/^\d{1,2}\.\d{1,2}\.\s*\([^)]*\)\s*취소\s*/g, "")
        .replace(/\s*결제일시\s*.*$/g, "")
        .replace(/\s*주문 상세 보기\s*.*$/g, "")
        .replace(/\s*더보기\s*$/g, "")
        .replace(/\s*다시 담기\s*$/g, "")
        .replace(/\s*다시 구매\s*$/g, "")
        .trim();
    };

    const cards = Array.from(
      document.querySelectorAll("[class*='PaymentItem_item-payment']")
    );

    return cards
      .map((card, index) => {
        const element = card as HTMLElement;
        const text = clean(element.innerText);

        const statusMatch =
          /(결제완료|상품준비중|배송중|배송완료|구매확정|취소완료|취소접수|반품완료|교환완료)/.exec(
            text
          );

        const rawStatus = statusMatch?.[1] || "";

        const anchors = Array.from(element.querySelectorAll("a")).map(
          (a) => a as HTMLAnchorElement
        );

        const detailAnchor = anchors.find(
          (a) =>
            clean(a.innerText).includes("주문 상세 보기") ||
            /orders\.pay\.naver\.com\/instantPay\/detail/.test(a.href)
        );

        const merchantAnchor = anchors.find(
          (a) => !/orders\.pay\.naver\.com\/instantPay\/detail/.test(a.href)
        );

        const detailUrl = detailAnchor?.href || "";
        const merchantUrl = merchantAnchor?.href || "";

        const amount = parseAmountLocal(text);
        const orderDate = parseDateLocal(text);
        const productName = cleanProductNameLocal(text, rawStatus);
        const detailId = parseDetailIdLocal(detailUrl);

        return {
          index,
          rawText: text,
          rawStatus,
          productName,
          amount,
          quantity: 1,
          orderDate,
          detailUrl,
          detailId,
          merchantUrl
        };
      })
      .filter((item) => {
        if (!item.rawText.includes("결제일시")) return false;
        if (!item.rawText.includes("주문 상세 보기")) return false;
        if (!item.productName) return false;
        if (!item.amount) return false;

        if (/구매했어요|자주 구매/.test(item.rawText)) return false;

        return true;
      });
  }, baseYear);

  const uniqueRawItems = rawItems.filter((item, index, array) => {
    const key = [
      item.detailUrl || item.detailId || "",
      item.rawStatus || "",
      item.productName || "",
      String(item.amount || 0),
      item.orderDate || ""
    ].join("|");

    return (
      array.findIndex((other) => {
        const otherKey = [
          other.detailUrl || other.detailId || "",
          other.rawStatus || "",
          other.productName || "",
          String(other.amount || 0),
          other.orderDate || ""
        ].join("|");

        return otherKey === key;
      }) === index
    );
  });

  const dateFilteredItems = uniqueRawItems.filter((item) =>
    isNaverPayWithinRange(item.orderDate, options)
  );

  const lineCounters = new Map<string, number>();

  const orders = dateFilteredItems.map((item, index) => {
    const detailId = item.detailId || hashNaverPayText(item.rawText);
    const currentLine = (lineCounters.get(detailId) || 0) + 1;
    lineCounters.set(detailId, currentLine);

    const suffix = String(currentLine).padStart(3, "0");
    const orderNumber = "NAVERPAY-" + detailId + "-" + suffix;

    return {
      orderNumber,
      orderDate: item.orderDate,
      productName: item.productName,
      quantity: item.quantity || 1,
      amount: item.amount,
      currency: "KRW",
      shippingStatus: mapNaverPayStatus(item.rawStatus),
      rawData: JSON.stringify({
        source: "naverpay",
        rawText: item.rawText,
        rawStatus: item.rawStatus,
        detailUrl: item.detailUrl,
        detailId: item.detailId,
        merchantUrl: item.merchantUrl,
        sourceIndex: item.index,
        parsedIndex: index,
        splitProductIndex: currentLine,
        splitProductCount: dateFilteredItems.filter((other) => {
          const otherDetailId = other.detailId || hashNaverPayText(other.rawText);
          return otherDetailId === detailId;
        }).length
      })
    } as StandardOrder;
  });

  return orders;
}


async function collectNaverPayShippingDiagnostic(
  page: Page,
  orders: StandardOrder[],
  progress?: ProgressReporter
): Promise<void> {
  const targets = orders
    .map((order) => {
      let raw: Record<string, unknown> = {};

      try {
        raw =
          typeof order.rawData === "string"
            ? JSON.parse(order.rawData)
            : ((order.rawData || {}) as Record<string, unknown>);
      } catch {
        raw = {};
      }

      return {
        order,
        detailUrl: String(raw.detailUrl || ""),
        rawStatus: String(raw.rawStatus || "")
      };
    })
    .filter((item) => {
      if (!item.detailUrl) return false;

      return (
        orderHasShippingStatus(item.order.shippingStatus) ||
        /배송중|배송완료|구매확정/.test(item.rawStatus)
      );
    })
    .slice(0, 5);

  const collectSnapshot = async (
    targetPage: Page,
    orderInfo: Record<string, unknown>,
    phaseLabel: string
  ): Promise<unknown> => {
    return targetPage.evaluate(
      ({ orderFromNode, labelFromNode }) => {
        const clean = (value: unknown) =>
          String(value || "").replace(/\s+/g, " ").trim();

        const bodyText = clean(document.body?.innerText || "");

        const links = Array.from(document.querySelectorAll("a")).map((a) => {
          const anchor = a as HTMLAnchorElement;

          return {
            text: clean(anchor.innerText),
            href: anchor.href
          };
        });

        const buttons = Array.from(document.querySelectorAll("button")).map((button) => {
          const element = button as HTMLButtonElement;

          return {
            text: clean(element.innerText),
            ariaLabel: clean(element.getAttribute("aria-label") || ""),
            className: clean(element.className)
          };
        });

        const candidates = Array.from(
          document.querySelectorAll("div, li, section, article, p, span, table, dl")
        )
          .map((el, idx) => {
            const element = el as HTMLElement;
            const text = clean(element.innerText || element.textContent || "");

            return {
              index: idx,
              tag: element.tagName,
              className: clean(element.className),
              text,
              textLength: text.length
            };
          })
          .filter((item) => {
            if (item.textLength < 5 || item.textLength > 1500) return false;

            return /배송조회|배송추적|운송장|송장|택배|CJ대한통운|대한통운|우체국|롯데택배|한진택배|로젠택배|배송완료|배송중|배달완료|집화|이동중|상품인수/.test(
              item.text
            );
          })
          .slice(0, 100);

        const trackingCandidates = Array.from(
          bodyText.matchAll(/\b\d{10,14}\b/g)
        ).map((match) => match[0]);

        const carrierCandidates = Array.from(
          bodyText.matchAll(/CJ대한통운|대한통운|우체국택배|우체국|롯데택배|한진택배|로젠택배|일양로지스|경동택배|대신택배|편의점택배|GS Postbox|CU편의점택배/g)
        ).map((match) => match[0]);

        return {
          label: labelFromNode,
          order: orderFromNode,
          url: location.href,
          title: document.title,
          bodyPreview: bodyText.slice(0, 6000),
          trackingCandidates: Array.from(new Set(trackingCandidates)),
          carrierCandidates: Array.from(new Set(carrierCandidates)),
          links: links.filter((link) =>
            /배송|조회|추적|택배|송장|운송장|invoice|tracking|delivery/i.test(
              link.text + " " + link.href
            )
          ),
          buttons: buttons.filter((button) =>
            /배송|조회|추적|택배|운송장|송장/.test(
              button.text + " " + button.ariaLabel
            )
          ),
          candidates
        };
      },
      {
        orderFromNode: orderInfo,
        labelFromNode: phaseLabel
      }
    );
  };

  const diagnostics: unknown[] = [];

  for (const [index, target] of targets.entries()) {
    const orderInfo = {
      orderNumber: target.order.orderNumber,
      orderDate: target.order.orderDate,
      productName: target.order.productName,
      amount: target.order.amount,
      shippingStatus: target.order.shippingStatus,
      rawStatus: target.rawStatus,
      detailUrl: target.detailUrl
    };

    report(
      progress,
      "extracting",
      "Naver Pay 배송조회 클릭 진단 " +
        (index + 1) +
        "/" +
        targets.length +
        ": " +
        target.order.orderNumber
    );

    await page
      .goto(target.detailUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      })
      .catch(() => undefined);

    await page.waitForTimeout(2500);

    const beforeClick = await collectSnapshot(page, orderInfo, "before-click");

    const popupPromise = page
      .context()
      .waitForEvent("page", { timeout: 5000 })
      .catch(() => null);

    const clicked = await page
      .locator("button", { hasText: "배송조회" })
      .first()
      .click({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    await page.waitForTimeout(2500);

    const popup = await popupPromise;

    let afterClick: unknown;

    if (popup) {
      await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
      await popup.waitForTimeout(2500).catch(() => undefined);

      afterClick = await collectSnapshot(popup, orderInfo, "after-click-popup");

      await popup.close().catch(() => undefined);
    } else {
      afterClick = await collectSnapshot(page, orderInfo, "after-click-current-page-or-modal");
    }

    diagnostics.push({
      order: orderInfo,
      clicked,
      beforeClick,
      afterClick
    });
  }

  const outputPath = path.join(process.cwd(), "naverpay-shipping-click-diagnostic.json");
  fs.writeFileSync(outputPath, JSON.stringify(diagnostics, null, 2), "utf8");

  report(
    progress,
    "extracting",
    "Naver Pay 배송조회 클릭 진단 완료: " +
      diagnostics.length +
      "건. naverpay-shipping-click-diagnostic.json 확인"
  );
}

function orderHasShippingStatus(status: StandardOrder["shippingStatus"]): boolean {
  return status === "SHIPPED" || status === "DELIVERED";
}

export class NaverPayExtractor extends BaseExtractor {
  constructor(extractorConfig: ExtractorConfig = config as ExtractorConfig) {
    super(extractorConfig);
  }

  async login(
    page: Page,
    _credentials: Credentials,
    progress?: ProgressReporter
  ): Promise<void> {
    await waitForNaverPayManualLogin(page, progress);
  }

  async isLoggedIn(page: Page): Promise<boolean> {
    return detectNaverPayLoggedIn(page);
  }

  async extractOrders(
    page: Page,
    options: ExtractionOptions,
    progress?: ProgressReporter
  ): Promise<StandardOrder[]> {
    report(
      progress,
      "extracting",
      "Naver Pay v1.4: 결제내역 페이지네이션 파싱을 시작합니다."
    );

    if (!(await detectNaverPayLoggedIn(page))) {
      await page.goto(NAVERPAY_HISTORY_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      await page.waitForTimeout(2500);
    }

    if (!(await detectNaverPayLoggedIn(page))) {
      throw new Error("Naver Pay history page is not accessible after login");
    }

    const maxPages = Math.max(1, Number(options.maxPages || 1));
    const allOrders: StandardOrder[] = [];

    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
      const pageUrl = "https://pay.naver.com/pc/history?page=" + pageNo;

      report(
        progress,
        "extracting",
        "Naver Pay page " + pageNo + " 이동 중: " + pageUrl
      );

      await page.goto(pageUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      await page.waitForTimeout(2500);

      if (pageNo === 1) {
        const diagnostic = await collectNaverPayDomDiagnostic(page);
        const diagnosticCount =
          typeof diagnostic === "object" &&
          diagnostic !== null &&
          "count" in diagnostic
            ? String((diagnostic as { count?: unknown }).count || 0)
            : "0";

        report(
          progress,
          "extracting",
          "Naver Pay DOM 진단 완료: 후보 " + diagnosticCount + "개."
        );
      }

      const pageOrders = await extractNaverPayOrdersFromCurrentPage(page, options);

      report(
        progress,
        "extracting",
        "Naver Pay page " + pageNo + " 파싱 완료: " + pageOrders.length + "건"
      );

      if (pageOrders.length === 0) {
        report(
          progress,
          "extracting",
          "Naver Pay page " + pageNo + "에서 주문이 없어 페이지네이션을 중단합니다."
        );
        break;
      }

      allOrders.push(...pageOrders);
    }

    const uniqueOrders = allOrders.filter((order, index, array) => {
      return array.findIndex((other) => other.orderNumber === order.orderNumber) === index;
    });

    report(
      progress,
      "extracting",
      "Naver Pay v1.4 전체 파싱 완료: " + uniqueOrders.length + "건"
    );

    if ((options as any)?.debugShippingDiagnostic === true) {
      const diagnosticOrders = uniqueOrders.slice(0, Number((options as any)?.diagnosticLimit || 5));
      await collectNaverPayShippingDiagnostic(page, diagnosticOrders, progress);
    }

    const naverPayOnlyTrackable = (options as any)?.onlyTrackable === true || (options as any)?.trackingOnly === true;

    const naverPaySourceOrdersForFinalReturn = naverPayOnlyTrackable
      ? uniqueOrders.filter((order) => shouldFetchNaverPayTrackingInfoForTracking(order))
      : uniqueOrders;

    if (naverPayOnlyTrackable) {
      (progress as any)?.({
        phase: "extracting" as any,
        message: `Naver Pay 배송조회 가능 주문 필터 적용: 전체 ${uniqueOrders.length}건 중 ${naverPaySourceOrdersForFinalReturn.length}건`
      });
    }

    const naverPayMaxOrdersForFinalReturn = Number((options as any)?.maxOrders ?? (options as any)?.limit ?? (options as any)?.maxItems ?? 0);
    const naverPayFinalOrders =
      Number.isFinite(naverPayMaxOrdersForFinalReturn) && naverPayMaxOrdersForFinalReturn > 0
        ? naverPaySourceOrdersForFinalReturn.slice(0, Math.floor(naverPayMaxOrdersForFinalReturn))
        : naverPaySourceOrdersForFinalReturn;

    (progress as any)?.({
      phase: "extracting" as any,
      message: `Naver Pay 최종 추출 수량 확정: 전체 ${naverPaySourceOrdersForFinalReturn.length}건 중 ${naverPayFinalOrders.length}건 반환`
    });

    const naverPayTrackingLimitForFinalReturn = Number((options as any)?.trackingLimit ?? (options as any)?.maxTracking ?? naverPayFinalOrders.length);
    const naverPayEffectiveTrackingLimit =
      Number.isFinite(naverPayTrackingLimitForFinalReturn) && naverPayTrackingLimitForFinalReturn > 0
        ? Math.floor(naverPayTrackingLimitForFinalReturn)
        : naverPayFinalOrders.length;

    const naverPayEnrichedFinalOrders = await enrichNaverPayOrdersWithTrackingForTracking(
      page,
      naverPayFinalOrders,
      {
        ...(options as any),
        trackingLimit: naverPayEffectiveTrackingLimit
      },
      progress
    );

    return naverPayEnrichedFinalOrders;
  }
}

export default NaverPayExtractor;




function resolveNaverPayLimitOptionForTracking(
  options: any,
  keys: string[],
  fallback: number
): number {
  for (const key of keys) {
    const value = Number(options?.[key]);

    if (Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
  }

  return fallback;
}

function getNaverPayMaxOrdersForTracking(options: any, fallback: number): number {
  return resolveNaverPayLimitOptionForTracking(
    options,
    ["maxOrders", "limit", "maxItems", "take", "count"],
    fallback
  );
}

function getNaverPayTrackingLimitForTracking(options: any, fallback: number): number {
  return resolveNaverPayLimitOptionForTracking(
    options,
    ["trackingLimit", "maxTracking", "maxTrackingOrders", "trackingCount"],
    fallback
  );
}

function normalizeNaverPayRawDataForTracking(rawData: unknown): Record<string, any> {
  if (!rawData) return {};

  if (typeof rawData === "string") {
    try {
      return JSON.parse(rawData);
    } catch {
      return {};
    }
  }

  if (typeof rawData === "object") {
    return rawData as Record<string, any>;
  }

  return {};
}

function parseNaverPayTrackingTextForTracking(text: string): {
  carrier?: string;
  trackingNumber?: string;
} {
  const carrierList = [
    "CJ대한통운",
    "대한통운",
    "한진택배",
    "롯데택배",
    "우체국택배",
    "로젠택배",
    "경동택배",
    "대신택배",
    "일양로지스",
    "천일택배",
    "합동택배",
    "CU편의점택배",
    "GS Postbox",
    "GS포스트박스",
    "편의점택배",
    "홈픽",
    "DHL",
    "FedEx",
    "UPS"
  ];

  const carrier = carrierList.find((name) => text.includes(name));

  const trackingNumber =
    text.match(/송장번호\s*([0-9]{8,20})/)?.[1] ||
    text.match(/운송장번호\s*([0-9]{8,20})/)?.[1] ||
    text.match(/등기번호\s*([0-9]{8,20})/)?.[1] ||
    text.match(/\b[0-9]{10,14}\b/)?.[0];

  return {
    carrier: carrier || undefined,
    trackingNumber: trackingNumber || undefined
  };
}

function shouldFetchNaverPayTrackingInfoForTracking(order: StandardOrder): boolean {
  const rawData = normalizeNaverPayRawDataForTracking((order as any).rawData);
  const rawStatus = String(rawData.rawStatus || "");
  const detailUrl = String(rawData.detailUrl || "");

  if (!detailUrl) return false;

  const status = String((order as any).shippingStatus || "");

  return (
    status === "SHIPPED" ||
    status === "DELIVERED" ||
    /배송중|배송완료|구매확정/.test(rawStatus)
  );
}

async function clickNaverPayDeliveryTrackingButtonForTracking(page: Page): Promise<boolean> {
  const clickTargets = [
    async () => page.getByText("배송조회", { exact: true }).first().click({ timeout: 5_000 }),
    async () => page.locator('button:has-text("배송조회")').first().click({ timeout: 5_000 }),
    async () => page.locator('a:has-text("배송조회")').first().click({ timeout: 5_000 }),
    async () => page.locator('[role="button"]:has-text("배송조회")').first().click({ timeout: 5_000 }),
    async () => page.locator('text=배송조회').first().click({ timeout: 5_000 })
  ];

  for (const clickTarget of clickTargets) {
    const clicked = await clickTarget()
      .then(() => true)
      .catch(() => false);

    if (clicked) return true;
  }

  return false;
}

async function fetchNaverPayTrackingInfoForTracking(
  page: Page,
  order: StandardOrder,
  progress?: ProgressReporter
): Promise<{
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  trackingText?: string;
}> {
  const rawData = normalizeNaverPayRawDataForTracking((order as any).rawData);
  const detailUrl = String(rawData.detailUrl || "");

  if (!detailUrl) return {};

  (progress as any)?.({
    phase: "extracting" as any,
    message: `Naver Pay 배송조회 진입: ${(order as any).orderNumber}`
  });

  await page.goto(detailUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000
  });

  await page.waitForTimeout(1_500);

  const beforeText = await page
    .locator("body")
    .innerText({ timeout: 8_000 })
    .catch(() => "");

  if (!/배송조회/.test(beforeText)) {
    return {
      trackingText: beforeText.slice(0, 3000)
    };
  }

  const popupPromise = page
    .context()
    .waitForEvent("page", { timeout: 4_000 })
    .catch(() => null);

  const clicked = await clickNaverPayDeliveryTrackingButtonForTracking(page);

  if (!clicked) {
    return {
      trackingText: beforeText.slice(0, 3000)
    };
  }

  const popup = await popupPromise;
  const targetPage = popup || page;

  await targetPage
    .waitForLoadState("domcontentloaded", { timeout: 20_000 })
    .catch(() => undefined);

  await targetPage.waitForTimeout(2_000);

  const trackingUrl = targetPage.url();

  const trackingText = await targetPage
    .locator("body")
    .innerText({ timeout: 10_000 })
    .catch(() => "");

  const parsed = parseNaverPayTrackingTextForTracking(trackingText);

  if (popup) {
    await popup.close().catch(() => undefined);
  }

  return {
    carrier: parsed.carrier,
    trackingNumber: parsed.trackingNumber,
    trackingUrl,
    trackingText: trackingText.slice(0, 5000)
  };
}

async function enrichNaverPayOrdersWithTrackingForTracking(
  page: Page,
  orders: StandardOrder[],
  options: any,
  progress?: ProgressReporter
): Promise<StandardOrder[]> {
  const includeTracking = options?.includeTracking !== false;

  if (!includeTracking) {
    (progress as any)?.({
      phase: "extracting" as any,
      message: "Naver Pay 배송조회 추출을 건너뜁니다. includeTracking=false"
    });

    return orders;
  }

  const trackingLimit = Number.isFinite(Number(options?.trackingLimit)) && Number(options?.trackingLimit) > 0
    ? Math.floor(Number(options?.trackingLimit))
    : orders.length;

  const enriched: StandardOrder[] = [];
  let attempted = 0;
  let found = 0;

  for (const order of orders) {
    if (!shouldFetchNaverPayTrackingInfoForTracking(order)) {
      enriched.push(order);
      continue;
    }

    if (attempted >= trackingLimit) {
      enriched.push(order);
      continue;
    }

    attempted += 1;

    try {
      const trackingInfo = await fetchNaverPayTrackingInfoForTracking(page, order, progress);
      const rawData = normalizeNaverPayRawDataForTracking((order as any).rawData);

      const nextOrder: any = {
        ...(order as any),
        rawData: {
          ...rawData,
          carrier: trackingInfo.carrier,
          trackingNumber: trackingInfo.trackingNumber,
          trackingUrl: trackingInfo.trackingUrl,
          trackingText: trackingInfo.trackingText
        }
      };

      if (trackingInfo.carrier) {
        nextOrder.carrier = trackingInfo.carrier;
      }

      if (trackingInfo.trackingNumber) {
        nextOrder.trackingNumber = trackingInfo.trackingNumber;
      }

      if (trackingInfo.carrier || trackingInfo.trackingNumber) {
        found += 1;

        (progress as any)?.({
          phase: "extracting" as any,
          message: `Naver Pay 송장 추출 성공: ${nextOrder.orderNumber} / ${trackingInfo.carrier || "-"} / ${trackingInfo.trackingNumber || "-"}`
        });
      } else {
        (progress as any)?.({
          phase: "extracting" as any,
          message: `Naver Pay 송장 후보 없음: ${(order as any).orderNumber}`
        });
      }

      enriched.push(nextOrder as StandardOrder);
    } catch (error) {
      (progress as any)?.({
        phase: "extracting" as any,
        message: `Naver Pay 송장 추출 실패: ${(order as any).orderNumber} / ${String((error as Error)?.message || error)}`
      });

      enriched.push(order);
    }
  }

  (progress as any)?.({
    phase: "extracting" as any,
    message: `Naver Pay 배송조회 완료: 대상 ${attempted}건, 송장 발견 ${found}건`
  });

  return enriched;
}

function applyNaverPayMaxOrdersLimitForTracking(
  orders: StandardOrder[],
  options: any,
  progress?: ProgressReporter
): StandardOrder[] {
  const maxOrders = getNaverPayMaxOrdersForTracking(options, 0);

  if (!maxOrders) {
    return orders;
  }

  const limited = orders.slice(0, maxOrders);

  (progress as any)?.({
    phase: "extracting" as any,
    message: `Naver Pay 추출 수량 제한 적용: 전체 ${orders.length}건 중 ${limited.length}건 반환, maxOrders=${maxOrders}`
  });

  return limited;
}

