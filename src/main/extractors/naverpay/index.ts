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
    _options: ExtractionOptions,
    progress?: ProgressReporter
  ): Promise<StandardOrder[]> {
    report(
      progress,
      "extracting",
      "Naver Pay v0: 로그인 검증 전용 모드입니다. 주문 파싱은 아직 수행하지 않습니다."
    );

    if (!(await detectNaverPayLoggedIn(page))) {
      await page.goto(NAVERPAY_HISTORY_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      await page.waitForTimeout(2000);
    }

    if (!(await detectNaverPayLoggedIn(page))) {
      throw new Error("Naver Pay history page is not accessible after login");
    }

    report(
      progress,
      "extracting",
      "Naver Pay 결제내역 페이지 접근 확인 완료. v0에서는 0건을 반환합니다."
    );

    return [];
  }
}

export default NaverPayExtractor;
