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
      "Naver Pay v1: 결제내역 카드 파싱을 시작합니다."
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

    const orders = await extractNaverPayOrdersFromCurrentPage(page, options);

    report(
      progress,
      "extracting",
      "Naver Pay v1 파싱 완료: " + orders.length + "건"
    );

    return orders;
  }
}

export default NaverPayExtractor;
