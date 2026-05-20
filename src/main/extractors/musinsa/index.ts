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
import { MUSINSA_URLS } from "./selectors";
import { tryAutoLogin, waitForManualLogin } from "./login";
import {
  filterDetailLinksByDateRange,
  normalizeExtractionDateInput
} from "./date-filter";
import { collectDetailLinks } from "./links";
import { extractOrdersFromDetailPage } from "./detail-extractor";
import { getBodyText } from "./page-utils";

class MusinsaExtractor extends BaseExtractor {
  constructor(extractorConfig: ExtractorConfig = config) {
    super(extractorConfig);
  }

  async login(
    page: Page,
    credentials: Credentials,
    progress?: ProgressReporter
  ): Promise<void> {
    const autoLoginSucceeded = await tryAutoLogin(page, credentials, progress);

    if (autoLoginSucceeded) {
      return;
    }

    await waitForManualLogin(page, progress);
  }

  async isLoggedIn(page: Page): Promise<boolean> {
    await page.goto(MUSINSA_URLS.orderList, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForLoadState("domcontentloaded").catch(() => undefined);

    const maxWaitMs = 10000;
    const startedAt = Date.now();

    while (Date.now() - startedAt < maxWaitMs) {
      const url = page.url();

      const passwordInputs = await page
        .locator("input[type='password']")
        .count()
        .catch(() => 0);

      const bodyText = await getBodyText(page);
      const detailLinks = await collectDetailLinks(page).catch(() => []);

      const looksLoggedIn =
        passwordInputs === 0 &&
        (detailLinks.length > 0 ||
          /주문\s*상세|배송\s*조회|배송조회|주문번호|주문\s*상품|주문\s*내역/.test(
            bodyText
          ));

      if (looksLoggedIn) {
        return true;
      }

      const looksLikeLogin =
        passwordInputs > 0 ||
        /login|signin|member\/login/i.test(url) ||
        /로그인|아이디|비밀번호/.test(bodyText);

      if (looksLikeLogin && Date.now() - startedAt > 3000) {
        return false;
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
      message: "무신사 주문 목록을 수집합니다."
    });

    await page.goto(MUSINSA_URLS.orderList, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(3000);

    const detailLinks = await collectDetailLinks(page);
    const since = normalizeExtractionDateInput(options.since);
    const until = normalizeExtractionDateInput(options.until);
    const dateFiltered = filterDetailLinksByDateRange(detailLinks, since, until);

    if (since || until) {
      progress?.({
        runId: "",
        siteId: 0,
        siteCode: this.config.code,
        phase: "extracting",
        message: `무신사 주문 날짜 필터 적용: ${since || "전체"} ~ ${until || "전체"} / 수집 ${detailLinks.length}건 중 ${dateFiltered.links.length}건 대상, ${dateFiltered.skipped}건 제외`
      });
    }

    const requestedMaxDetails =
      options.maxPages && options.maxPages > 0 ? options.maxPages : 10;
    const maxDetails = Math.min(dateFiltered.links.length, requestedMaxDetails);
    const targetLinks = dateFiltered.links.slice(0, maxDetails);
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
