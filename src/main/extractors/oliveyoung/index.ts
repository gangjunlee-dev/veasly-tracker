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
  extractOrderNumbers,
  makeOliveYoungOrderNumber,
  mapOliveYoungStatus,
  normalizeDate,
  normalizeText,
  parseMoney,
  parseQuantity
} from "./parser";
import { OLIVEYOUNG_SELECTORS, OLIVEYOUNG_URLS } from "./selectors";

type OliveYoungRawOrder = {
  sourceOrderNumber: string;
  orderDate?: string;
  productName: string;
  quantity: number;
  amount: number;
  shippingStatus?: string;
  rawText: string;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateInRange(date: string, since?: string, until?: string): boolean {
  if (since && date < since) return false;
  if (until && date > until) return false;
  return true;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function getBodyText(page: Page): Promise<string> {
  return page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
}

function looksLikeLoginPageText(text: string): boolean {
  return /로그인|아이디|비밀번호|CJ\s*ONE|카카오로\s*로그인|Apple로\s*로그인/.test(text);
}

function looksLikeOrderPageText(text: string): boolean {
  return /주문\/배송|주문\s*배송|주문\s*내역|주문번호|배송조회|배송\s*조회|주문일자|결제금액|상품준비|배송완료/.test(
    text
  );
}

async function navigateToOrderList(page: Page): Promise<boolean> {
  for (const url of OLIVEYOUNG_URLS.orderListCandidates) {
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

    if (passwordInputs === 0 && looksLikeOrderPageText(bodyText)) {
      return true;
    }
  }

  return false;
}

function isOliveYoungOrderPageLike(url: string, text: string): boolean {
  return (
    /oliveyoung\.co\.kr/i.test(url) &&
    /주문|배송|주문\/배송|주문내역|배송조회|주문상세/i.test(text) &&
    !/비밀번호|아이디|로그인|CJ ONE 로그인/i.test(text)
  );
}

function isOliveYoungLoginOrSecurityPageLike(url: string, text: string): boolean {
  return /login|로그인|CJ ONE|아이디|비밀번호|Cloudflare|Checking if the site connection is secure|captcha|보안|로봇|verify|verification/i.test(
    `${url}\n${text}`
  );
}

async function getReadableBodyText(page: Page): Promise<string> {
  return page
    .locator("body")
    .innerText({ timeout: 2000 })
    .catch(() => "");
}

const OLIVEYOUNG_MANUAL_LOGIN_TIMEOUT_MS = 15 * 60 * 1000;

async function waitForManualLogin(
  page: Page,
  progress?: ProgressReporter
): Promise<void> {
  progress?.({
    runId: "",
    siteId: 0,
    siteCode: "oliveyoung",
    phase: "login",
    message:
      "올리브영은 일반 브라우저처럼 직접 로그인한 뒤 주문/배송조회 페이지에서 추출합니다."
  });

  const context = page.context();
  let activePage: Page | null = page.isClosed() ? null : page;

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const getActivePage = async (): Promise<Page | null> => {
    try {
      if (activePage && !activePage.isClosed()) {
        return activePage;
      }

      const existingPage = context
        .pages()
        .find((candidate) => !candidate.isClosed());

      if (existingPage) {
        activePage = existingPage;
        return activePage;
      }

      // 탭만 닫힌 경우에는 같은 persistent context 안에서 새 탭을 다시 엽니다.
      activePage = await context.newPage();
      return activePage;
    } catch {
      return null;
    }
  };

  const firstPage = await getActivePage();

  if (!firstPage) {
    throw new Error(
      "올리브영 브라우저를 열 수 없습니다. 앱을 재시작한 뒤 다시 실행해 주세요."
    );
  }

  // 중요:
  // 주문 페이지나 로그인 페이지로 강제 이동하지 않습니다.
  // about:blank 상태일 때만 올리브영 홈을 한 번 열어줍니다.
  if (firstPage.url() === "about:blank") {
    await firstPage
      .goto("https://www.oliveyoung.co.kr/store/main/main.do", {
        waitUntil: "domcontentloaded",
        timeout: 60000
      })
      .catch(() => {
        // Cloudflare/리다이렉트/보안 확인 중 timeout이 나도 수동 대기로 유지합니다.
      });
  }

  progress?.({
    runId: "",
    siteId: 0,
    siteCode: "oliveyoung",
    phase: "login",
    message:
      "브라우저에서 직접 Cloudflare 확인, 로그인, 마이페이지 > 주문/배송조회 이동까지 완료해 주세요. extractor는 페이지 이동을 강제하지 않습니다."
  });

  const startedAt = Date.now();
  let lastMessage = "";

  while (Date.now() - startedAt < OLIVEYOUNG_MANUAL_LOGIN_TIMEOUT_MS) {
    const currentPage = await getActivePage();

    if (!currentPage) {
      progress?.({
        runId: "",
        siteId: 0,
        siteCode: "oliveyoung",
        phase: "login",
        message:
          "올리브영 브라우저 연결이 끊겼습니다. 앱을 재시작한 뒤 다시 실행해 주세요."
      });

      throw new Error(
        "올리브영 브라우저 연결이 끊겼습니다. 앱을 재시작한 뒤 다시 실행해 주세요."
      );
    }

    const currentUrl = currentPage.url();

    const bodyText = await currentPage
      .locator("body")
      .innerText({ timeout: 2000 })
      .catch(() => "");

    const isOrderPage =
      /oliveyoung\.co\.kr/i.test(currentUrl) &&
      /주문|배송|주문\/배송|주문내역|배송조회|주문상세/i.test(bodyText) &&
      !/비밀번호|아이디|로그인|CJ ONE 로그인|Cloudflare|captcha|보안|로봇/i.test(bodyText);

    if (isOrderPage) {
      progress?.({
        runId: "",
        siteId: 0,
        siteCode: "oliveyoung",
        phase: "login",
        message:
          "올리브영 주문/배송조회 페이지를 감지했습니다. 현재 페이지에서 추출을 시작합니다."
      });

      return;
    }

    const isLoginOrSecurityPage =
      /login|로그인|CJ ONE|아이디|비밀번호|Cloudflare|Checking if the site connection is secure|captcha|보안|로봇|verify|verification/i.test(
        `${currentUrl}\n${bodyText}`
      );

    const nextMessage = isLoginOrSecurityPage
      ? "올리브영 로그인 또는 보안 확인 대기 중입니다. 일반 브라우저처럼 직접 완료한 뒤 주문/배송조회 페이지로 이동해 주세요."
      : "올리브영 주문/배송조회 페이지 대기 중입니다. 직접 마이페이지 > 주문/배송조회로 이동해 주세요.";

    if (nextMessage !== lastMessage) {
      progress?.({
        runId: "",
        siteId: 0,
        siteCode: "oliveyoung",
        phase: "login",
        message: nextMessage
      });

      lastMessage = nextMessage;
    }

    await sleep(3000);
  }

  throw new Error(
    "올리브영 수동 로그인 대기 시간이 초과되었습니다. 다시 실행 후 로그인과 주문/배송조회 이동을 완료해 주세요."
  );
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

  try {
    report("올리브영 자동 로그인을 시도합니다.");

    if (await navigateToOrderList(page)) {
      report("올리브영 이미 로그인된 상태입니다.");
      return true;
    }

    await page
      .goto(OLIVEYOUNG_URLS.login, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      })
      .catch(() => undefined);

    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await page.waitForTimeout(1500);

    const usernameInput = page
      .locator(OLIVEYOUNG_SELECTORS.usernameInputs.join(", "))
      .first();

    const passwordInput = page
      .locator(OLIVEYOUNG_SELECTORS.passwordInputs.join(", "))
      .first();

    const usernameVisible = await usernameInput
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    const passwordVisible = await passwordInput
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    if (!usernameVisible || !passwordVisible) {
      report("올리브영 로그인 입력창을 찾지 못해 수동 로그인으로 전환합니다.");
      return false;
    }

    report("올리브영 로그인 폼을 감지했습니다.");

    await usernameInput.fill(credentials.username);
    await passwordInput.fill(credentials.password);

    const autoLoginCheckbox = page
      .locator("input[type='checkbox'][name*='auto'], input[type='checkbox'][id*='auto'], label:has-text('자동로그인'), label:has-text('자동 로그인')")
      .first();

    const autoLoginVisible = await autoLoginCheckbox
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (autoLoginVisible) {
      await autoLoginCheckbox.click({ force: true }).catch(() => undefined);
    }

    report("올리브영 저장 계정 정보를 입력했습니다.");

    const loginButton = page
      .locator(OLIVEYOUNG_SELECTORS.loginButtons.join(", "))
      .first();

    const loginButtonVisible = await loginButton
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    if (loginButtonVisible) {
      report("올리브영 로그인 버튼을 클릭합니다.");
      await loginButton.click();
    } else {
      report("올리브영 로그인 버튼을 찾지 못해 엔터키로 로그인을 시도합니다.");
      await passwordInput.press("Enter");
    }

    const maxCheckMs = 30000;
    const startedAt = Date.now();

    while (Date.now() - startedAt < maxCheckMs) {
      await page.waitForTimeout(1500);

      const bodyText = await getBodyText(page);
      const passwordInputs = await page
        .locator("input[type='password']")
        .count()
        .catch(() => 0);

      const needsManualVerification =
        /본인\s*인증|휴대폰\s*인증|인증번호|보안\s*문자|캡차|captcha|추가\s*인증|비정상|잠금|보호/i.test(
          bodyText
        );

      if (needsManualVerification) {
        report("올리브영 추가 인증이 필요해 수동 로그인으로 전환합니다.");
        return false;
      }

      const loginFailed =
        passwordInputs > 0 &&
        /일치하지|확인해\s*주세요|다시\s*입력|로그인\s*실패|비밀번호|아이디/i.test(
          bodyText
        );

      if (loginFailed) {
        report("올리브영 자동 로그인에 실패했습니다. 저장된 계정 정보를 확인하거나 브라우저에서 수동 로그인해 주세요.");
        return false;
      }

      if (await navigateToOrderList(page)) {
        report("올리브영 자동 로그인 완료");
        return true;
      }
    }

    report("올리브영 자동 로그인 확인에 실패해 수동 로그인으로 전환합니다.");
    return false;
  } catch {
    report("올리브영 자동 로그인 중 오류가 발생해 수동 로그인으로 전환합니다.");
    return false;
  }
}

async function collectRawOrders(page: Page): Promise<OliveYoungRawOrder[]> {
  const candidates = await page.evaluate(() => {
    const visible = (element: Element) => {
      const htmlElement = element as HTMLElement;
      return !!(
        htmlElement.offsetWidth ||
        htmlElement.offsetHeight ||
        htmlElement.getClientRects().length
      );
    };

    const normalize = (value: string) =>
      String(value ?? "")
        .replace(/\r/g, "")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim();

    const elements = Array.from(
      document.querySelectorAll("li, tr, article, section, div")
    );

    return elements
      .filter((element) => visible(element))
      .map((element) => normalize((element as HTMLElement).innerText || ""))
      .filter((text) => {
        if (text.length < 20) return false;
        if (!/주문|배송|결제|상품|올리브영|오늘드림|픽업/.test(text)) return false;
        return /\b[A-Z]?\d{10,20}\b/.test(text);
      })
      .slice(0, 200);
  });

  const seenOrderNumbers = new Set<string>();
  const rawOrders: OliveYoungRawOrder[] = [];

  for (const rawText of candidates) {
    const normalized = normalizeText(rawText);
    const orderNumbers = extractOrderNumbers(normalized);

    if (orderNumbers.length === 0) {
      continue;
    }

    const sourceOrderNumber = orderNumbers[0];

    if (seenOrderNumbers.has(sourceOrderNumber)) {
      continue;
    }

    seenOrderNumbers.add(sourceOrderNumber);

    const orderDate =
      normalizeDate(normalized) ??
      normalizeDate(sourceOrderNumber) ??
      todayIsoDate();

    const lines = normalized
      .split("\n")
      .map((line) => normalizeText(line))
      .filter(Boolean);

    const productName =
      lines.find((line) => {
        if (/주문번호|주문일|주문일자|결제|배송|취소|교환|반품|리뷰|상세|조회/.test(line)) {
          return false;
        }

        if (/\b[A-Z]?\d{10,20}\b/.test(line)) {
          return false;
        }

        if (/^\d{1,3}(,\d{3})*원$/.test(line)) {
          return false;
        }

        return line.length >= 2;
      }) ?? `Olive Young order ${sourceOrderNumber}`;

    const amountLine = lines.find((line) => /원/.test(line));
    const amount = parseMoney(amountLine);

    rawOrders.push({
      sourceOrderNumber,
      orderDate,
      productName,
      quantity: parseQuantity(normalized),
      amount,
      shippingStatus: mapOliveYoungStatus(normalized),
      rawText: normalized
    });
  }

  return rawOrders;
}

class OliveYoungExtractor extends BaseExtractor {
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
    // OliveYoung은 Cloudflare가 있어서 로그인 상태 확인 시 페이지 이동을 하지 않습니다.
    // 현재 열려 있는 페이지가 주문/배송조회처럼 보일 때만 로그인 상태로 판단합니다.
    if (page.isClosed()) {
      return false;
    }

    const currentUrl = page.url();

    const bodyText = await page
      .locator("body")
      .innerText({ timeout: 2000 })
      .catch(() => "");

    return (
      /oliveyoung\.co\.kr/i.test(currentUrl) &&
      /주문|배송|주문\/배송|주문내역|배송조회|주문상세/i.test(bodyText) &&
      !/비밀번호|아이디|로그인|CJ ONE 로그인|Cloudflare|captcha|보안|로봇/i.test(bodyText)
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
      message: "올리브영 주문 목록을 수집합니다."
    });

    const navigated = await navigateToOrderList(page);

    if (!navigated) {
      progress?.({
        runId: "",
        siteId: 0,
        siteCode: this.config.code,
        phase: "extracting",
        message: "올리브영 주문/배송조회 페이지에 접근하지 못했습니다."
      });

      return [];
    }

    await page.waitForTimeout(3000);

    const rawOrders = await collectRawOrders(page);
    const since = options.since;
    const until = options.until;

    const filtered = rawOrders.filter((order) => {
      return dateInRange(order.orderDate ?? todayIsoDate(), since, until);
    });

    progress?.({
      runId: "",
      siteId: 0,
      siteCode: this.config.code,
      phase: "extracting",
      message: `올리브영 주문 날짜 필터 적용: ${since || "전체"} ~ ${until || "전체"} / 수집 ${rawOrders.length}건 중 ${filtered.length}건 대상`
    });

    const maxOrders =
      options.maxPages && options.maxPages > 0
        ? Math.min(filtered.length, options.maxPages)
        : filtered.length;

    const targetOrders = filtered.slice(0, maxOrders);

    const orders: StandardOrder[] = targetOrders.map((order, index) => {
      const lineIndex = index + 1;

      return {
        orderNumber: makeOliveYoungOrderNumber(
          order.sourceOrderNumber,
          lineIndex
        ),
        orderDate: order.orderDate ?? todayIsoDate(),
        productName: order.productName,
        quantity: order.quantity,
        amount: order.amount,
        currency: "KRW",
        invoiceNumber: null,
        invoiceUrl: null,
        shippingStatus: order.shippingStatus ?? null,
        rawData: JSON.stringify(
          {
            source: "oliveyoung",
            sourceOrderNumber: order.sourceOrderNumber,
            rawText: order.rawText
          },
          null,
          2
        )
      };
    });

    progress?.({
      runId: "",
      siteId: 0,
      siteCode: this.config.code,
      phase: "extracting",
      message: `올리브영 주문 ${orders.length}건 추출 완료`,
      current: orders.length,
      total: orders.length
    });

    return orders;
  }
}

export default OliveYoungExtractor;
