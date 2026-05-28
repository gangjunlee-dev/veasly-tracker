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
  buildTwentyNineCmInvoiceUrl,
  extractTwentyNineCmOrdOptNoFromUrl,
  extractTwentyNineCmSourceOrderNumberFromUrl,
  makeTwentyNineCmOrderNumber,
  mapTwentyNineCmStatus,
  parseMoney,
  parseTrackingText
} from "./parser";
import { TWENTY_NINE_CM_SELECTORS, TWENTY_NINE_CM_URLS } from "./selectors";

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

function normalizeExtractionDateInput(value?: string): string | undefined {
  if (!value) return undefined;

  const trimmed = String(value).trim();
  const match = trimmed.match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})/);

  if (!match) return undefined;

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function orderDateKeyFromSourceOrderNumber(sourceOrderNumber: string): string | undefined {
  const match = String(sourceOrderNumber ?? "").match(/^(\d{4})(\d{2})(\d{2})/);

  if (!match) return undefined;

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function isSourceOrderNumberInDateRange(
  sourceOrderNumber: string,
  since?: string,
  until?: string
): boolean {
  const orderDate = orderDateKeyFromSourceOrderNumber(sourceOrderNumber);
  const sinceDate = normalizeExtractionDateInput(since);
  const untilDate = normalizeExtractionDateInput(until);

  if (!orderDate) return true;
  if (sinceDate && orderDate < sinceDate) return false;
  if (untilDate && orderDate > untilDate) return false;

  return true;
}

function getSourceOrderNumberFromDetailLink(link: DetailLink): string | undefined {
  return (
    extractTwentyNineCmSourceOrderNumberFromUrl(link.url) ||
    String(link.text ?? "").match(/\b20\d{12,}\b/)?.[0]
  );
}

function filterDetailLinksByDateRange(
  links: DetailLink[],
  since?: string,
  until?: string
): {
  links: DetailLink[];
  skipped: number;
} {
  const filtered = links.filter((link) => {
    const sourceOrderNumber = getSourceOrderNumberFromDetailLink(link);

    if (!sourceOrderNumber) return true;

    return isSourceOrderNumberInDateRange(sourceOrderNumber, since, until);
  });

  return {
    links: filtered,
    skipped: links.length - filtered.length
  };
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
    `29CM Item ${fallbackIndex}`;

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
    /29CM/
  ];

  const brandName =
    possibleBrand &&
    !excluded.some((pattern) => pattern.test(possibleBrand)) &&
    !invalidBrandPatterns.some((pattern) => pattern.test(possibleBrand)) &&
    possibleBrand !== productName
      ? possibleBrand
      : undefined;

  const statusLine =
    pick29CMStatusLine(lines) || pick29CMStatusLine([containerText]);
  const statusSource = statusLine || shippingMessage || "";

  return {
    brandName,
    productName,
    optionName,
    quantity,
    amount,
    shippingStatus: mapTwentyNineCmStatus(statusSource),
    shippingMessage
  };
}

function is29CMActionButtonLine(line: string): boolean {
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

function pick29CMStatusLine(lines: string[]): string | undefined {
  const normalizedLines = lines
    .map((line) => String(line ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !is29CMActionButtonLine(line));

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
    /29CM/,
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
      productName = `29CM Item ${items.length + 1}`;
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
      pick29CMStatusLine(localLines) ||
      pick29CMStatusLine([globalStatusLine || ""]);
    const statusSource = localStatusLine || globalShippingMessage || "";

    items.push({
      brandName,
      productName,
      optionName: quantityAndOption.optionName,
      quantity: quantityAndOption.quantity,
      amount,
      shippingStatus: mapTwentyNineCmStatus(statusSource),
      shippingMessage: globalShippingMessage || globalStatusLine
    });
  }

  return items;
}

async function gotoTwentyNineCmOrderList(page: Page): Promise<void> {
  const candidates =
    TWENTY_NINE_CM_URLS.orderListCandidates || [TWENTY_NINE_CM_URLS.orderList];

  for (const url of candidates) {
    await page
      .goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      })
      .catch(() => undefined);

    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await page.waitForTimeout(1500);

    const bodyText = await getBodyText(page);
    const passwordInputs = await page
      .locator("input[type='password']")
      .count()
      .catch(() => 0);

    if (
      passwordInputs > 0 ||
      /주문|배송|구매|마이|로그인|ORDER|MY/i.test(bodyText) ||
      /order\/my-order|my-page|mypage|order|login/i.test(page.url())
    ) {
      return;
    }
  }
}

async function getBodyText(page: Page): Promise<string> {
  try {
    return await page.locator("body").innerText({ timeout: 5000 });
  } catch {
    return "";
  }
}

async function waitForManualLogin(
  page: Page,
  progress?: ProgressReporter
): Promise<void> {
  progress?.({
    runId: "",
    siteId: 0,
    siteCode: config.code,
    phase: "login",
    message: "29CM 수동 로그인 모드입니다. 브라우저에서 직접 로그인 후 주문내역 페이지로 이동해 주세요."
  });

  await page
    .goto("https://www.29cm.co.kr/order/my-order/list", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    })
    .catch(() => undefined);

  await page.waitForLoadState("domcontentloaded").catch(() => undefined);

  const maxWaitMs = 10 * 60 * 1000;
  const startedAt = Date.now();
  let lastMessageAt = 0;

  while (Date.now() - startedAt < maxWaitMs) {
    const url = page.url();

    const passwordInputs = await page
      .locator("input[type='password']")
      .count()
      .catch(() => 0);

    const bodyText = await getBodyText(page);

    const looksLikeLogin =
      passwordInputs > 0 ||
      /auth\.29cm\.co\.kr|login|signin|guest/i.test(url) ||
      (/로그인|이메일|비밀번호|카카오|네이버|휴대폰|인증/.test(bodyText) &&
        !/주문\s*내역|주문\/배송|배송\s*조회|주문번호|구매\s*내역/.test(bodyText));

    const looksLikeOrderPage =
      passwordInputs === 0 &&
      (
        /www\.29cm\.co\.kr\/order\/my-order/i.test(url) ||
        /주문\s*내역|주문\/배송|주문배송|배송\s*조회|배송조회|주문번호|구매\s*내역|최근\s*주문|주문한\s*상품이\s*없습니다|주문\s*내역이\s*없습니다/.test(bodyText)
      );

    if (looksLikeOrderPage && !looksLikeLogin) {
      progress?.({
        runId: "",
        siteId: 0,
        siteCode: config.code,
        phase: "login",
        message: "29CM 수동 로그인/주문내역 접근 확인 완료"
      });

      return;
    }

    if (Date.now() - lastMessageAt > 5000) {
      lastMessageAt = Date.now();

      progress?.({
        runId: "",
        siteId: 0,
        siteCode: config.code,
        phase: "login",
        message: looksLikeLogin
          ? "29CM 로그인 대기 중입니다. 열린 브라우저에서 로그인을 완료해 주세요."
          : "29CM 주문내역 페이지 대기 중입니다. 로그인 후 주문내역 페이지로 이동해 주세요."
      });
    }

    await sleep(2000);
  }

  throw new Error("29CM 수동 로그인 대기 시간이 초과되었습니다. 다시 실행 후 브라우저에서 로그인해 주세요.");
}
async function tryAutoLogin(
  page: Page,
  credentials: Credentials,
  progress?: ProgressReporter
): Promise<boolean> {
  const report = (message: string) => {
    progress?.({
      runId: "",
      siteId: 0,
      siteCode: config.code,
      phase: "login",
      message
    });
  };

  const setInputValue = async (
    locator: ReturnType<Page["locator"]>,
    value: string
  ) => {
    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
    await locator.click({ timeout: 5000 }).catch(() => undefined);
    await locator.fill("");

    await locator.evaluate((element, nextValue) => {
      const input = element as HTMLInputElement;
      const prototype = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

      if (descriptor?.set) {
        descriptor.set.call(input, nextValue);
      } else {
        input.value = nextValue;
      }

      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    }, value);
  };

  const looksLikeOrderAccess = async () => {
    const passwordInputs = await page
      .locator("input[type='password']")
      .count()
      .catch(() => 0);

    const bodyText = await getBodyText(page);
    const detailLinks = await collectDetailLinks(page).catch(() => []);

    return (
      passwordInputs === 0 &&
      (detailLinks.length > 0 ||
        /주문\s*내역|주문\s*상세|배송\s*조회|배송조회|주문번호|주문\s*상품|구매\s*내역|주문한\s*상품이\s*없습니다|주문\s*내역이\s*없습니다|최근\s*주문|주문\/배송|주문배송/.test(
          bodyText
        ))
    );
  };

  try {
    report("29CM 자동 로그인을 시도합니다.");

    await page
      .goto(TWENTY_NINE_CM_URLS.orderList, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      })
      .catch(() => undefined);

    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await page.waitForTimeout(1500);

    if (await looksLikeOrderAccess()) {
      report("29CM 이미 로그인된 상태입니다.");
      return true;
    }

    const memberLoginUrl = /member\.one\.musinsa\.com\/login/i.test(page.url());

    const usernameInput = page
      .locator(
        [
          'input.login-v2-input__input[placeholder="통합계정 또는 이메일"]',
          'input[placeholder="통합계정 또는 이메일"]',
          'input[type="text"].login-v2-input__input',
          'input[type="email"]',
          'input[type="text"]'
        ].join(", ")
      )
      .first();

    const passwordInput = page
      .locator(
        [
          'input.login-v2-input__input[placeholder="비밀번호"]',
          'input[placeholder="비밀번호"]',
          'input[type="password"].login-v2-input__input',
          'input[type="password"]'
        ].join(", ")
      )
      .first();

    const usernameVisible = await usernameInput
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    const passwordVisible = await passwordInput
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    if (!usernameVisible || !passwordVisible) {
      report(
        memberLoginUrl
          ? "29CM 통합 로그인 입력창을 찾지 못해 수동 로그인으로 전환합니다."
          : "29CM 로그인 입력창을 찾지 못해 수동 로그인으로 전환합니다."
      );

      return false;
    }

    report("29CM 로그인 폼을 감지했습니다.");

    await setInputValue(usernameInput, credentials.username);
    await setInputValue(passwordInput, credentials.password);

    report("29CM 저장 계정 정보를 입력했습니다.");

    const autoLoginCheckbox = page
      .locator(
        [
          'input#login-v2-member__util__login-auto',
          'input[name="autologin"]'
        ].join(", ")
      )
      .first();

    const autoLoginExists = await autoLoginCheckbox
      .count()
      .then((count) => count > 0)
      .catch(() => false);

    if (autoLoginExists) {
      const checked = await autoLoginCheckbox
        .isChecked()
        .catch(() => false);

      if (!checked) {
        await autoLoginCheckbox
          .check({ force: true })
          .catch(async () => {
            await page
              .locator('label[for="login-v2-member__util__login-auto"]')
              .click({ timeout: 3000 })
              .catch(() => undefined);
          });
      }
    }

    const submitButton = page
      .locator(
        [
          'button.login-v2-button__item--black[type="submit"]',
          'button[type="submit"]:has-text("로그인")',
          'button:has-text("로그인")'
        ].join(", ")
      )
      .first();

    const submitVisible = await submitButton
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    if (!submitVisible) {
      report("29CM 로그인 버튼을 찾지 못해 엔터키로 로그인을 시도합니다.");
      await passwordInput.press("Enter");
    } else {
      report("29CM 로그인 버튼을 클릭합니다.");
      await submitButton.click();
    }

    const loginCheckStartedAt = Date.now();
    const maxLoginCheckMs = 25000;

    while (Date.now() - loginCheckStartedAt < maxLoginCheckMs) {
      await page.waitForTimeout(1000);

      const currentUrl = page.url();
      const bodyText = await getBodyText(page);
      const passwordInputCount = await page
        .locator("input[type='password']")
        .count()
        .catch(() => 0);

      const needsManualVerification =
        /본인\s*인증|휴대폰\s*인증|인증번호|보안\s*문자|캡차|captcha|추가\s*인증|비정상|잠금|보호/i.test(
          bodyText
        );

      if (needsManualVerification) {
        report("29CM 추가 인증이 필요해 수동 로그인으로 전환합니다.");
        return false;
      }

      const loginFailed =
        passwordInputCount > 0 &&
        /일치하지|확인해\s*주세요|다시\s*입력|로그인\s*실패|비밀번호가\s*일치하지|아이디가\s*일치하지|계정\s*정보/i.test(
          bodyText
        );

      if (loginFailed) {
        report(
          "29CM 자동 로그인에 실패했습니다. 저장된 계정 정보를 확인하거나 브라우저에서 수동 로그인해 주세요."
        );
        return false;
      }

      if (/member\.one\.musinsa\.com\/login/i.test(currentUrl)) {
        continue;
      }

      await page
        .goto(TWENTY_NINE_CM_URLS.orderList, {
          waitUntil: "domcontentloaded",
          timeout: 60000
        })
        .catch(() => undefined);

      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await page.waitForTimeout(1500);

      if (await looksLikeOrderAccess()) {
        report("29CM 자동 로그인 완료");
        return true;
      }
    }

    await page
      .goto(TWENTY_NINE_CM_URLS.orderList, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      })
      .catch(() => undefined);

    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await page.waitForTimeout(2000);

    if (await looksLikeOrderAccess()) {
      report("29CM 자동 로그인 완료");
      return true;
    }

    report("29CM 자동 로그인 확인에 실패해 수동 로그인으로 전환합니다.");
    return false;
  } catch (error) {
    report("29CM 자동 로그인 중 오류가 발생해 수동 로그인으로 전환합니다.");
    return false;
  }
}


async function collectDetailLinks(page: Page): Promise<DetailLink[]> {
  const anchorLinks = await page
    .locator(TWENTY_NINE_CM_SELECTORS.orderDetailLinks.join(","))
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
    html.matchAll(/https?:\/\/(?:[a-z0-9-]+\.)?29cm\.co\.kr\/[^"'<>\s]*order[^"'<>\s]*/g)
  ).map((match) => ({
    url: match[0],
    text: ""
  }));

  const relativeMatches = Array.from(
    html.matchAll(/\/[^"'<>\s]*order[^"'<>\s]*/g)
  ).map((match) => ({
    url: match[0].startsWith("http")
      ? match[0]
      : `https://www.29cm.co.kr${match[0]}`,
    text: ""
  }));

  return unique(
    [...anchorLinks, ...absoluteMatches, ...relativeMatches]
      .filter((link) => link.url && /order|orders|my-order|mypage|my-page/i.test(link.url))
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
    href: `https://www.29cm.co.kr${match[0].replace(/&amp;/g, "&")}`,
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
    extractTwentyNineCmSourceOrderNumberFromUrl(currentUrl) ||
    bodyText.match(/\b20\d{12,}\b/)?.[0] ||
    `UNKNOWN-${detailIndex}`;

  const orderDate = orderDateFromSourceOrderNumber(sourceOrderNumber);
  const detailItems = parseDetailItemsFromBodyText(bodyText, sourceOrderNumber);

  progress?.({
    runId: "",
    siteId: 0,
    siteCode: config.code,
    phase: "extracting",
    message: `29CM 주문 상세 분석 중: ${sourceOrderNumber}`
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
          orderNumber: makeTwentyNineCmOrderNumber(sourceOrderNumber, lineIndex),
          orderDate,
          productName: cleanTwentyNineCmProductNameFinal(item.productName, (item as { rawText?: string }).rawText),
          quantity: item.quantity,
          amount: normalizeTwentyNineCmAmountFinal(item.amount, (item as { rawText?: string }).rawText, item.productName),
          currency: "KRW",
          invoiceNumber: undefined,
          invoiceUrl: undefined,
          shippingStatus: item.shippingStatus,
          sourceOrderRef: sourceOrderNumber,
          rawData: JSON.stringify({
            source: "29cm",
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
      ? extractTwentyNineCmOrdOptNoFromUrl(finalTrackingUrl)
      : trackingTarget.href
        ? extractTwentyNineCmOrdOptNoFromUrl(trackingTarget.href)
        : undefined;

    const invoiceUrl =
      finalTrackingUrl && finalTrackingUrl.includes("/order-service/my/delivery/trace")
        ? finalTrackingUrl
        : buildTwentyNineCmInvoiceUrl(sourceOrderNumber, ordOptNo) || trackingTarget.href;

    const trackingFallbackStatus = trackingText ? mapTwentyNineCmStatus(trackingText) : "PENDING";
    const shippingStatus =
      tracking.trackingStatus ||
      (trackingFallbackStatus !== "PENDING" ? trackingFallbackStatus : item.shippingStatus);

    orders.push({
      orderNumber: makeTwentyNineCmOrderNumber(sourceOrderNumber, lineIndex),
      orderDate,
      productName: cleanTwentyNineCmProductNameFinal(item.productName, (item as { rawText?: string }).rawText),
      quantity: item.quantity,
      amount: normalizeTwentyNineCmAmountFinal(item.amount, (item as { rawText?: string }).rawText, item.productName),
      currency: "KRW",
      invoiceNumber: tracking.trackingNumber,
      invoiceUrl,
      shippingStatus,
      sourceOrderRef: sourceOrderNumber,
      rawData: JSON.stringify({
        source: "29cm",
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


type TwentyNineCmListRawItem = {
  sourceOrderNumber: string;
  orderDate: string;
  detailUrl?: string;
  productName: string;
  quantity: number;
  amount: number;
  shippingStatusText: string;
  carrier?: string;
  trackingNumber?: string;
  expectedDeliveryText?: string;
  rawText: string;
  sourceIndex: number;
};

function normalizeTwentyNineCmDateInput(value?: string): string | undefined {
  if (!value) return undefined;

  const trimmed = String(value).trim();
  const match = trimmed.match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})/);

  if (!match) return undefined;

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function isTwentyNineCmDateInRange(
  orderDate: string,
  since?: string,
  until?: string
): boolean {
  const normalizedOrderDate = normalizeTwentyNineCmDateInput(orderDate);
  const sinceDate = normalizeTwentyNineCmDateInput(since);
  const untilDate = normalizeTwentyNineCmDateInput(until);

  if (!normalizedOrderDate) return true;
  if (sinceDate && normalizedOrderDate < sinceDate) return false;
  if (untilDate && normalizedOrderDate > untilDate) return false;

  return true;
}


function normalizeTwentyNineCmStatusFinal(statusText?: string, rawText?: string): string {
  const status = String(statusText || "").replace(/\s+/g, " ").trim();
  const raw = String(rawText || "").replace(/\s+/g, " ").trim();
  const text = [status, raw].filter(Boolean).join(" ");

  if (/취소\s*완료|주문\s*취소|결제\s*취소|환불\s*완료|^취소$/.test(status)) {
    return "CANCELLED";
  }

  if (/구매\s*확정/.test(status)) {
    return "DELIVERED";
  }

  if (/배송\s*완료/.test(status)) {
    return "DELIVERED";
  }

  // 중요: 29CM의 "결제완료 5.21 이내 배송시작"은 배송중이 아니라 결제완료/출고예정이다.
  if (/결제\s*완료/.test(status)) {
    return "PAID";
  }

  // 중요: "상품준비중 5.21 이내 배송시작"은 READY다.
  if (/상품\s*준비\s*중|배송\s*준비\s*중|출고\s*준비/.test(status)) {
    return "READY";
  }

  if (/배송\s*시작|배송\s*중/.test(status)) {
    return "SHIPPED";
  }

  if (/주문\s*완료/.test(status)) {
    return "PAID";
  }

  if (/취소\s*완료|주문\s*취소|결제\s*취소|환불\s*완료/.test(text)) {
    return "CANCELLED";
  }

  if (/구매\s*확정|배송\s*완료/.test(text)) {
    return "DELIVERED";
  }

  if (/결제\s*완료/.test(text)) {
    return "PAID";
  }

  if (/상품\s*준비\s*중|배송\s*준비\s*중|출고\s*준비/.test(text)) {
    return "READY";
  }

  if (/배송\s*시작|배송\s*중/.test(text)) {
    return "SHIPPED";
  }

  return "PENDING";
}

// 29CM 카드 rawText에서 상품명 앞쪽에 반복적으로 붙는 noise 토큰들을
// "마지막 매치 위치까지" 잘라낸다. 한 카드에 여러 상품이 있을 때
// segmentBeforeAmount = [이전 상품의 후위 노이즈] + [이번 상품의 [상태][날짜][도착키워드][브랜드+상품명+옵션]]
// 구조이므로, 노이즈 토큰의 "마지막 매치 끝 이후"가 진짜 상품명이다.
export function stripLeadingNoiseFromProductText(text: string): string {
  if (!text) return "";

  const noiseEnd =
    /(?:주문일자\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\s*주문상세|주문상세|이내\s*배송시작|도착\s*예정|도착|취소상세|취소접수|반품접수|교환접수|배송조회|리뷰작성\s*\+\s*최대\s*[\d,]+\s*원|구매확정\s*\+\s*\d[\d,]*\s*원|(?:결제완료|상품준비중|배송준비중|배송완료|배송중|배송시작|구매확정|취소완료)\s*\d{1,2}\.\s*\d{1,2}\s*\([^)]+\)|배송비\s*:\s*(?:무료배송|[\d,]+\s*원)|결제완료|상품준비중|배송준비중|배송완료|배송중|배송시작|구매확정|취소완료|\d{1,2}\.\s*\d{1,2}\s*\([^)]+\))/g;

  let lastEnd = 0;
  let m: RegExpExecArray | null;

  while ((m = noiseEnd.exec(text)) !== null) {
    lastEnd = m.index + m[0].length;
    // Safety: zero-length match로 무한 루프 빠지지 않도록.
    if (m[0].length === 0) noiseEnd.lastIndex += 1;
  }

  const stripped = text.slice(lastEnd).trim();

  // Safety: 과도하게 잘렸으면 (3자 미만) 원본을 살린다.
  if (stripped.length < 3 && text.trim().length >= 3) {
    return text.trim();
  }

  return stripped;
}

export function cleanTwentyNineCmProductNameFinal(productName?: string | null, rawText?: string | null): string {
  const raw = String(rawText || "").replace(/\s+/g, " ").trim();
  let text = String(productName || "").replace(/\s+/g, " ").trim();

  // rawText가 있으면 rawText 기준으로 상품명 복원.
  // 이유: 기존 productName은 이미 가격/옵션 일부가 잘린 상태일 수 있음.
  if (raw) {
    const amountMatch = /[1-9]\d{0,2}(?:,\d{3})+\s*원\s*\/\s*수량\s*\d+\s*개/.exec(raw);

    if (amountMatch && typeof amountMatch.index === "number") {
      text = raw.slice(0, amountMatch.index).trim();
    } else if (!text) {
      text = raw;
    }
  }

  text = text.replace(/\s+/g, " ").trim();

  // 앞쪽 noise (상태/날짜/액션버튼/이전 상품의 후위 부산물) 전체를 한 번에 제거.
  text = stripLeadingNoiseFromProductText(text);

  // 뒤쪽 trailing 정리는 유지 — anchor textContent를 productName으로 받은 케이스 대비.
  text = text
    .replace(/배송완료.*$/, "")
    .replace(/배송중.*$/, "")
    .replace(/배송시작.*$/, "")
    .replace(/상품준비중.*$/, "")
    .replace(/결제완료.*$/, "")
    .replace(/구매확정.*$/, "")
    .replace(/취소완료.*$/, "")
    .replace(/반품접수.*$/, "")
    .replace(/교환접수.*$/, "")
    .replace(/배송조회.*$/, "")
    .replace(/리뷰작성.*$/, "")
    .replace(/배송비\s*:\s*[\d,]+원.*$/, "")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

function parseTwentyNineCmStrictAmountQuantity(text?: string | null): { amount: number; quantity: number } | null {
  const source = String(text || "");

  if (!source.trim()) {
    return null;
  }

  const candidates: Array<{
    amount: number;
    quantity: number;
    index: number;
    raw: string;
  }> = [];

  // 29CM 상품금액은 "72,200원 / 수량 1개" 패턴만 상품 금액으로 인정한다.
  // "[Size]23072,200원 / 수량 1개"처럼 옵션 숫자와 붙어도
  // 정규식은 "72,200원 / 수량 1개"부터 정상 매칭한다.
  const pattern = /([1-9]\d{0,2}(?:,\d{3})+)\s*원\s*\/\s*수량\s*(\d+)\s*개/g;

  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const amount = Number.parseInt(String(match[1] || "").replace(/,/g, ""), 10);
    const quantity = Number.parseInt(String(match[2] || "1"), 10) || 1;

    if (!Number.isFinite(amount)) continue;
    if (amount <= 0) continue;
    if (amount >= 3_000_000) continue;

    candidates.push({
      amount,
      quantity,
      index: Number(match.index),
      raw: match[0]
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => a.index - b.index);

  return {
    amount: candidates[0].amount,
    quantity: candidates[0].quantity
  };
}

function normalizeTwentyNineCmAmountFinal(
  currentAmount?: number | null,
  rawText?: string | null,
  productName?: string | null
): number {
  const fromRaw = parseTwentyNineCmStrictAmountQuantity(rawText);
  if (fromRaw) {
    return fromRaw.amount;
  }

  const fromProduct = parseTwentyNineCmStrictAmountQuantity(productName);
  if (fromProduct) {
    return fromProduct.amount;
  }

  // rawText가 있는데 상품금액 패턴을 못 찾으면 기존 currentAmount는 신뢰하지 않는다.
  // currentAmount에 구매확정 포인트/리뷰 포인트가 들어올 수 있기 때문.
  if (rawText && String(rawText).trim()) {
    return 0;
  }

  if (
    typeof currentAmount === "number" &&
    Number.isFinite(currentAmount) &&
    currentAmount > 0 &&
    currentAmount < 3_000_000
  ) {
    return currentAmount;
  }

  return 0;
}



function normalizeTwentyNineCmSplitAmount(rawAmountText: string, beforeText?: string | null): number {
  const raw = String(rawAmountText || "");
  const before = String(beforeText || "");

  let amount = Number.parseInt(raw.replace(/,/g, ""), 10);

  const commaIndex = raw.indexOf(",");
  const prefixLength = commaIndex >= 0 ? commaIndex : 0;
  const hasOptionMarkerBefore = /\[(?:Size|SIZE|사이즈|옵션|Color|COLOR|컬러|기종|선택|패키지)[^\]]*\]?$|(?:Size|SIZE|사이즈|옵션|Color|COLOR|컬러|기종|선택|패키지)\]?$/.test(before.slice(-30));

  // 29CM DOM에서 옵션 숫자와 금액이 붙는 케이스 보정.
  // 예:
  // [사이즈]1143,100원 => 실제 143,100원
  // [사이즈]262,100원  => 실제 62,100원
  // [Size]23072,200원 => 실제 72,200원
  if (hasOptionMarkerBefore && prefixLength >= 3) {
    for (let cut = 1; cut <= Math.min(3, prefixLength - 1); cut += 1) {
      const candidateRaw = raw.slice(cut);

      if (!/^[1-9]\d{0,2}(?:,\d{3})+$/.test(candidateRaw)) {
        continue;
      }

      const candidate = Number.parseInt(candidateRaw.replace(/,/g, ""), 10);

      if (Number.isFinite(candidate) && candidate > 0 && candidate < 3_000_000) {
        return candidate;
      }
    }
  }

  if (Number.isFinite(amount) && amount > 0 && amount < 3_000_000) {
    return amount;
  }

  return 0;
}

function findTwentyNineCmProductAmountMatchesForSplit(rawText?: string | null): Array<{
  raw: string;
  rawAmount: string;
  amount: number;
  quantity: number;
  index: number;
}> {
  const text = String(rawText || "");
  const result: Array<{
    raw: string;
    rawAmount: string;
    amount: number;
    quantity: number;
    index: number;
  }> = [];

  // 정상: 72,200원 / 수량 1개
  // 옵션 결합: [사이즈]262,100원 / 수량 1개
  const pattern = /([1-9]\d{0,4}(?:,\d{3})+)\s*원\s*\/\s*수량\s*(\d+)\s*개/g;

  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const rawAmount = String(match[1] || "");
    const before = text.slice(Math.max(0, Number(match.index) - 50), Number(match.index));
    const amount = normalizeTwentyNineCmSplitAmount(rawAmount, before);
    const quantity = Number.parseInt(String(match[2] || "1"), 10) || 1;

    if (!amount) continue;

    result.push({
      raw: match[0],
      rawAmount,
      amount,
      quantity,
      index: Number(match.index)
    });
  }

  return result;
}

function extractTwentyNineCmSplitStatus(segment?: string | null, fallback?: string | null): string {
  const text = String(segment || "");
  const match = /(취소완료|반품완료|교환완료|구매확정|배송완료|배송중|배송시작|상품준비중|결제완료|주문완료)/.exec(text);
  return match?.[1] || String(fallback || "");
}

function extractTwentyNineCmSplitExpectedDelivery(segment?: string | null, fallback?: string | null): string | undefined {
  const text = String(segment || "");
  const match = /\d{1,2}\.\s*\d{1,2}\s*\([^)]*\)\s*(?:도착 예정|도착|이내 배송시작)/.exec(text);
  return match?.[0]?.trim() || fallback || undefined;
}

function extractTwentyNineCmSplitTracking(segment?: string | null): { carrier?: string; trackingNumber?: string } {
  const text = String(segment || "").replace(/\s+/g, " ").trim();
  const match = /(CJ대한통운|우체국택배|롯데택배|로젠택배|한진택배|딜리박스|경동택배|대신택배)\s+(\d{8,20})/.exec(text);

  if (!match) {
    return {};
  }

  return {
    carrier: match[1],
    trackingNumber: match[2]
  };
}

function splitTwentyNineCmRawItemIntoProductsFinal<T extends {
  rawText?: string | null;
  productName?: string | null;
  amount?: number | null;
  quantity?: number | null;
  shippingStatusText?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  expectedDeliveryText?: string | null;
  sourceOrderNumber?: string | null;
}>(item: T): T[] {
  const rawText = String(item.rawText || "");
  const matches = findTwentyNineCmProductAmountMatchesForSplit(rawText);

  if (matches.length <= 1) {
    return [item];
  }

  return matches.map((match, index) => {
    const prevEnd =
      index === 0
        ? 0
        : matches[index - 1].index + matches[index - 1].raw.length;

    const nextStart =
      index + 1 < matches.length
        ? matches[index + 1].index
        : rawText.length;

    const segmentBeforeAmount = rawText.slice(prevEnd, match.index);
    const segment = rawText.slice(prevEnd, nextStart);

    const tracking = extractTwentyNineCmSplitTracking(segment);
    const productName = cleanTwentyNineCmProductNameFinal(segmentBeforeAmount, segment);
    const shippingStatusText = extractTwentyNineCmSplitStatus(segment, item.shippingStatusText);
    const expectedDeliveryText = extractTwentyNineCmSplitExpectedDelivery(segment, item.expectedDeliveryText);

    return {
      ...item,
      productName,
      amount: match.amount,
      quantity: match.quantity,
      shippingStatusText,
      carrier: tracking.carrier || item.carrier,
      trackingNumber: tracking.trackingNumber || item.trackingNumber,
      expectedDeliveryText,
      rawText: segment,
      productText: segmentBeforeAmount,
      splitProductIndex: index + 1,
      splitProductCount: matches.length
    } as T;
  });
}

function expandTwentyNineCmItemsForProducts<T extends object>(items: T[]): T[] {
  const expanded: T[] = [];

  for (const item of items) {
    expanded.push(...splitTwentyNineCmRawItemIntoProductsFinal(item as any));
  }

  return expanded;
}

async function waitForTwentyNineCmOrderCards(
  page: Page,
  progress?: ProgressReporter
): Promise<{ cardCount: number; isEmptyPage: boolean }> {
  const maxWaitMs = 15000;
  const pollIntervalMs = 500;
  const startedAt = Date.now();

  let last = { cardCount: 0, isEmptyPage: false };

  while (Date.now() - startedAt < maxWaitMs) {
    last = await page.evaluate(() => {
      const clean = (v: unknown) =>
        String(v || "").replace(/\s+/g, " ").trim();

      const lis = Array.from(document.querySelectorAll("li"));
      const cardCount = lis.filter((el) => {
        const t = clean(el.textContent || "");
        return (
          /주문일자\s*20\d{2}[.]/.test(t) &&
          /주문상세/.test(t) &&
          /[\d,]+\s*원\s*\/\s*수량\s*\d+\s*개/.test(t)
        );
      }).length;

      const body = clean(document.body?.innerText || "");
      const isEmptyPage =
        /주문한\s*상품이\s*없습니다|주문\s*내역이\s*없습니다|구매\s*내역이\s*없습니다/.test(
          body
        );

      return { cardCount, isEmptyPage };
    });

    if (last.cardCount > 0 || last.isEmptyPage) {
      return last;
    }

    await page.waitForTimeout(pollIntervalMs);
  }

  progress?.({
    runId: "",
    siteId: 0,
    siteCode: config.code,
    phase: "extracting",
    message: `29CM 주문 카드 등장을 ${maxWaitMs}ms 기다렸으나 감지하지 못함 (마지막 cardCount=${last.cardCount})`
  });

  return last;
}

async function extractTwentyNineCmOrdersFromListPage(
  page: Page,
  options: ExtractionOptions,
  progress?: ProgressReporter
): Promise<StandardOrder[]> {
  await gotoTwentyNineCmOrderList(page);

  await page.waitForLoadState("domcontentloaded").catch(() => undefined);

  // 주문 카드 li가 실제로 렌더될 때까지 폴링.
  // 기존 고정 2500ms 대기는 lazy load/지연 렌더 환경에서 0건이 자주 나옴.
  // (사용자가 본 "추출했는데 변화 없음"의 주요 원인)
  const waitResult = await waitForTwentyNineCmOrderCards(page, progress);

  progress?.({
    runId: "",
    siteId: 0,
    siteCode: config.code,
    phase: "extracting",
    message: waitResult.isEmptyPage
      ? "29CM 주문 내역이 비어있음을 확인"
      : `29CM 주문 카드 ${waitResult.cardCount}건 렌더 확인`
  });

  const rawItems = await page.evaluate(() => {
    const clean = (value: unknown) =>
      String(value || "")
        .replace(/\s+/g, " ")
        .trim();

    const parseDate = (text: string) => {
      const match = clean(text).match(/주문일자\s*(20\d{2})[.]\s*(\d{1,2})[.]\s*(\d{1,2})/);
      if (!match) return "";

      return [
        match[1],
        String(match[2]).padStart(2, "0"),
        String(match[3]).padStart(2, "0")
      ].join("-");
    };

    const parseAmountQuantity = (text: string) => {
      const match = clean(text).match(/([\d,]+)\s*원\s*\/\s*수량\s*(\d+)\s*개/);

      return {
        amount: match?.[1] ? Number(match[1].replace(/,/g, "")) : 0,
        quantity: match?.[2] ? Number(match[2]) : 1
      };
    };

    const parseStatus = (text: string) => {
      const match = clean(text).match(
        /(배송완료|배송중|배송시작|배송준비중|상품준비중|결제완료|주문완료|구매확정|취소완료|취소|반품|교환)/
      );

      return match?.[1] || "";
    };

    const parseTracking = (text: string) => {
      const normalized = clean(text);
      const match = normalized.match(
        /(CJ대한통운|우체국택배|한진택배|롯데택배|로젠택배|대한통운|딜리박스|일양로지스|GS\s*Postbox|CU\s*편의점택배)\s*(\d{8,20})/
      );

      return {
        carrier: match?.[1] ? clean(match[1]) : "",
        trackingNumber: match?.[2] || ""
      };
    };

    const parseExpectedDelivery = (text: string) => {
      const match = clean(text).match(/(\d{1,2}[.]\s*\d{1,2}\s*\([^)]+\)\s*도착\s*예정)/);

      return match?.[1] ? clean(match[1]) : "";
    };

    const cleanProductName = (text: string) => {
      return clean(text)
        .replace(/[\d,]+\s*원\s*\/\s*수량\s*\d+\s*개/g, "")
        .replace(/무료배송/g, "")
        .trim();
    };

    const cards = Array.from(document.querySelectorAll("li"))
      .map((element, sourceIndex) => {
        const rawText = clean(element.textContent || "");

        if (
          !/주문일자\s*20\d{2}[.]/.test(rawText) ||
          !/주문상세/.test(rawText) ||
          !/[\d,]+\s*원\s*\/\s*수량\s*\d+\s*개/.test(rawText)
        ) {
          return null;
        }

        const anchors = Array.from(element.querySelectorAll("a[href*='/order/my-order/detail/']")) as HTMLAnchorElement[];

        const detailAnchor =
          anchors.find((anchor) => clean(anchor.textContent || "") === "주문상세") ||
          anchors[0];

        const productAnchor =
          anchors.find((anchor) => {
            const text = clean(anchor.textContent || "");
            return text.length > 10 && /[\d,]+\s*원\s*\/\s*수량/.test(text);
          }) ||
          anchors.find((anchor) => clean(anchor.textContent || "").length > 10);

        const detailUrl = detailAnchor?.href || productAnchor?.href || "";
        const sourceOrderNumber =
          detailUrl.match(/\/order\/my-order\/detail\/(\d+)/)?.[1] ||
          rawText.match(/\b\d{7,12}\b/)?.[0] ||
          "";

        const orderDate = parseDate(rawText);
        const amountQuantity = parseAmountQuantity(rawText);
        const tracking = parseTracking(rawText);
        const productName = cleanProductName(productAnchor?.textContent || rawText);
        const status = parseStatus(rawText);
        const expectedDeliveryText = parseExpectedDelivery(rawText);

        if (!sourceOrderNumber || !orderDate || !productName || amountQuantity.amount <= 0) {
          return null;
        }

        return {
          sourceOrderNumber,
          orderDate,
          detailUrl,
          productName,
          quantity: amountQuantity.quantity,
          amount: amountQuantity.amount,
          shippingStatusText: status,
          carrier: tracking.carrier || undefined,
          trackingNumber: tracking.trackingNumber || undefined,
          expectedDeliveryText: expectedDeliveryText || undefined,
          rawText,
          sourceIndex
        };
      })
      .filter(Boolean);

    const seen = new Set<string>();
    const uniqueItems = [];

    for (const item of cards as TwentyNineCmListRawItem[]) {
      const key = [
        item.sourceOrderNumber,
        item.orderDate,
        item.productName,
        item.amount,
        item.quantity,
        item.trackingNumber || "",
        item.sourceIndex
      ].join("|");

      if (seen.has(key)) continue;

      seen.add(key);
      uniqueItems.push(item);
    }

    return uniqueItems;
  });

  const since = normalizeTwentyNineCmDateInput(options.since);
  const until = normalizeTwentyNineCmDateInput(options.until);

  const dateFiltered = rawItems.filter((item) =>
    isTwentyNineCmDateInRange(item.orderDate, since, until)
  );

  progress?.({
    runId: "",
    siteId: 0,
    siteCode: config.code,
    phase: "extracting",
    message: `29CM 목록 페이지 상품 ${rawItems.length}건 중 날짜 필터 후 ${dateFiltered.length}건 대상`
  });

  const requestedMaxItems =
    options.maxPages && options.maxPages > 0 ? options.maxPages : dateFiltered.length;

  const targetItems = dateFiltered.slice(0, requestedMaxItems);
  const expandedTargetItems = expandTwentyNineCmItemsForProducts(targetItems);

  progress?.({
    runId: "",
    siteId: 0,
    siteCode: config.code,
    phase: "extracting",
    message: `29CM 상품 split: 원본 ${targetItems.length}건 → 상품 ${expandedTargetItems.length}건`,
    current: expandedTargetItems.length,
    total: expandedTargetItems.length
  });

  const lineCounters = new Map<string, number>();

  const orders = expandedTargetItems.map((item) => {
    const nextLineIndex = (lineCounters.get(item.sourceOrderNumber) || 0) + 1;
    lineCounters.set(item.sourceOrderNumber, nextLineIndex);

    const shippingStatus = normalizeTwentyNineCmStatusFinal(
      item.shippingStatusText,
      item.rawText
    );

    const invoiceUrl = item.trackingNumber
      ? item.detailUrl || "https://www.29cm.co.kr/order/my-order/list"
      : undefined;

    return {
      orderNumber: makeTwentyNineCmOrderNumber(item.sourceOrderNumber, nextLineIndex),
      orderDate: item.orderDate,
      productName: cleanTwentyNineCmProductNameFinal(item.productName, (item as { rawText?: string }).rawText),
      quantity: item.quantity,
      amount: normalizeTwentyNineCmAmountFinal(item.amount, (item as { rawText?: string }).rawText, item.productName),
      currency: "KRW",
      invoiceNumber: item.trackingNumber,
      invoiceUrl,
      shippingStatus,
      sourceOrderRef: item.sourceOrderNumber,
      rawData: JSON.stringify({
        source: "29cm",
        sourceOrderNumber: item.sourceOrderNumber,
        lineIndex: nextLineIndex,
        carrier: item.carrier,
        trackingNumber: item.trackingNumber,
        expectedDeliveryText: item.expectedDeliveryText,
        shippingStatusText: item.shippingStatusText,
        detailUrl: item.detailUrl,
        sourceIndex: item.sourceIndex,
        rawText: item.rawText
      })
    };
  });

  progress?.({
    runId: "",
    siteId: 0,
    siteCode: config.code,
    phase: "extracting",
    message: `29CM 목록 페이지에서 상품별 주문 ${orders.length}건 추출 완료`,
    current: orders.length,
    total: orders.length
  });

  return orders;
}

class TwentyNineCmExtractor extends BaseExtractor {
  constructor(extractorConfig: ExtractorConfig = config) {
    super(extractorConfig);
  }

    async login(
    page: Page,
    credentials: Credentials,
    progress?: ProgressReporter
  ): Promise<void> {
    const username = String(credentials?.username || "").trim();
    const password = String(credentials?.password || "").trim();

    const forceManualLogin =
      !username ||
      !password ||
      username === "manual-login" ||
      password === "manual-login";

    if (forceManualLogin) {
      progress?.({
        runId: "",
        siteId: 0,
        siteCode: this.config.code,
        phase: "login",
        message: "29CM 저장 계정이 manual-login이므로 자동 로그인을 건너뛰고 수동 로그인으로 진행합니다."
      });

      await waitForManualLogin(page, progress);
      return;
    }

    const autoLoginSucceeded = await tryAutoLogin(
      page,
      credentials,
      progress
    );

    if (autoLoginSucceeded) {
      return;
    }

    await waitForManualLogin(page, progress);
  }


  async isLoggedIn(page: Page): Promise<boolean> {
    await page
      .goto("https://www.29cm.co.kr/order/my-order/list", {
        waitUntil: "domcontentloaded",
        timeout: 60000
      })
      .catch(() => undefined);

    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await page.waitForTimeout(1500);

    const maxWaitMs = 8000;
    const startedAt = Date.now();

    while (Date.now() - startedAt < maxWaitMs) {
      const url = page.url();

      const passwordInputs = await page
        .locator("input[type='password']")
        .count()
        .catch(() => 0);

      const bodyText = await getBodyText(page);

      const looksLikeLogin =
        passwordInputs > 0 ||
        /auth\.29cm\.co\.kr|login|signin|guest/i.test(url) ||
        (
          /로그인|이메일|비밀번호|카카오|네이버|휴대폰|인증/.test(bodyText) &&
          !/주문\s*내역|주문\/배송|배송\s*조회|주문번호|구매\s*내역|최근\s*주문/.test(bodyText)
        );

      if (looksLikeLogin) {
        return false;
      }

      const isOrderUrl = /www\.29cm\.co\.kr\/order\/my-order/i.test(url);

      const hasOrderSignal =
        /주문\s*내역|주문\/배송|주문배송|배송\s*조회|배송조회|주문번호|구매\s*내역|최근\s*주문|주문한\s*상품이\s*없습니다|주문\s*내역이\s*없습니다/.test(bodyText);

      const hasRealOrderContent =
        /\d{1,3}(,\d{3})*\s*원|배송\s*완료|배송\s*중|상품\s*준비|결제\s*완료|구매\s*확정|주문\s*상세|상세\s*보기/.test(bodyText);

      if (
        passwordInputs === 0 &&
        isOrderUrl &&
        hasOrderSignal &&
        hasRealOrderContent
      ) {
        return true;
      }

      await page.waitForTimeout(800);
    }

    return false;
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
      message: "29CM 주문/예매내역 목록 페이지를 직접 분석합니다."
    });

    return extractTwentyNineCmOrdersFromListPage(page, options, progress);
  }
}

export default TwentyNineCmExtractor;
