import type { Page } from "playwright";
import type {
  Credentials,
  ProgressReporter
} from "../_base/types";
import { MUSINSA_SELECTORS, MUSINSA_URLS } from "./selectors";
import { collectDetailLinks } from "./links";
import { getBodyText, sleep } from "./page-utils";
import config from "./config.json";

function reportLogin(progress: ProgressReporter | undefined, message: string) {
  progress?.({
    runId: "",
    siteId: 0,
    siteCode: config.code,
    phase: "login",
    message
  });
}

async function looksLikeOrderAccess(page: Page): Promise<boolean> {
  const passwordInputs = await page
    .locator("input[type='password']")
    .count()
    .catch(() => 0);

  const bodyText = await getBodyText(page);
  const detailLinks = await collectDetailLinks(page).catch(() => []);

  return (
    passwordInputs === 0 &&
    (detailLinks.length > 0 ||
      /주문\s*내역|주문\s*상세|배송\s*조회|배송조회|주문번호|주문\s*상품|구매\s*내역|주문한\s*상품이\s*없습니다|주문\s*내역이\s*없습니다/.test(
        bodyText
      ))
  );
}

export async function waitForManualLogin(
  page: Page,
  progress?: ProgressReporter
): Promise<void> {
  reportLogin(
    progress,
    "무신사 주문내역 페이지로 이동합니다. 로그인 화면이 보이면 브라우저에서 수동 로그인해 주세요."
  );

  await page
    .goto(MUSINSA_URLS.orderList, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    })
    .catch(() => undefined);

  await page.waitForLoadState("domcontentloaded").catch(() => undefined);

  const maxWaitMs = 5 * 60 * 1000;
  const startedAt = Date.now();
  let lastOrderListNudgeAt = 0;

  while (Date.now() - startedAt < maxWaitMs) {
    const url = page.url();

    const passwordInputs = await page
      .locator("input[type='password']")
      .count()
      .catch(() => 0);

    const detailLinkCount = await page
      .locator(MUSINSA_SELECTORS.orderDetailLinks.join(","))
      .count()
      .catch(() => 0);

    const bodyText = await getBodyText(page);

    const looksLikeLogin =
      passwordInputs > 0 ||
      /login|signin|member\/login/i.test(url) ||
      (/로그인/.test(bodyText) && /아이디|비밀번호/.test(bodyText));

    const looksAccess =
      passwordInputs === 0 &&
      (detailLinkCount > 0 ||
        /주문\s*내역|주문\s*상세|배송\s*조회|배송조회|주문번호|주문\s*상품|구매\s*내역|주문한\s*상품이\s*없습니다|주문\s*내역이\s*없습니다/.test(
          bodyText
        ));

    if (looksAccess) {
      reportLogin(progress, "무신사 로그인/주문내역 접근 확인 완료");

      await page
        .goto(MUSINSA_URLS.orderList, {
          waitUntil: "domcontentloaded",
          timeout: 60000
        })
        .catch(() => undefined);

      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      return;
    }

    if (
      passwordInputs === 0 &&
      !looksLikeLogin &&
      Date.now() - lastOrderListNudgeAt > 15000
    ) {
      lastOrderListNudgeAt = Date.now();
      await page
        .goto(MUSINSA_URLS.orderList, {
          waitUntil: "domcontentloaded",
          timeout: 60000
        })
        .catch(() => undefined);
    }

    reportLogin(
      progress,
      "무신사 로그인 대기 중입니다. 브라우저에서 로그인을 완료해 주세요."
    );

    await sleep(3000);
  }

  throw new Error(
    "무신사 로그인 대기 시간이 초과되었습니다. 다시 실행 후 브라우저에서 로그인을 완료해 주세요."
  );
}

async function setInputValue(
  locator: ReturnType<Page["locator"]>,
  value: string
) {
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
}

export async function tryAutoLogin(
  page: Page,
  credentials: Credentials,
  progress?: ProgressReporter
): Promise<boolean> {
  const report = (message: string) => reportLogin(progress, message);

  try {
    report("무신사 자동 로그인을 시도합니다.");

    await page
      .goto(MUSINSA_URLS.orderList, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      })
      .catch(() => undefined);

    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await page.waitForTimeout(1500);

    if (await looksLikeOrderAccess(page)) {
      report("무신사 이미 로그인된 상태입니다.");
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
          ? "무신사 통합 로그인 입력창을 찾지 못해 수동 로그인으로 전환합니다."
          : "무신사 로그인 입력창을 찾지 못해 수동 로그인으로 전환합니다."
      );

      return false;
    }

    report("무신사 로그인 폼을 감지했습니다.");

    await setInputValue(usernameInput, credentials.username);
    await setInputValue(passwordInput, credentials.password);

    report("무신사 저장 계정 정보를 입력했습니다.");

    const autoLoginCheckbox = page
      .locator(
        [
          "input#login-v2-member__util__login-auto",
          'input[name="autologin"]'
        ].join(", ")
      )
      .first();

    const autoLoginExists = await autoLoginCheckbox
      .count()
      .then((count) => count > 0)
      .catch(() => false);

    if (autoLoginExists) {
      const checked = await autoLoginCheckbox.isChecked().catch(() => false);

      if (!checked) {
        await autoLoginCheckbox.check({ force: true }).catch(async () => {
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
      report("무신사 로그인 버튼을 찾지 못해 엔터키로 로그인을 시도합니다.");
      await passwordInput.press("Enter");
    } else {
      report("무신사 로그인 버튼을 클릭합니다.");
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
        report("무신사 추가 인증이 필요해 수동 로그인으로 전환합니다.");
        return false;
      }

      const loginFailed =
        passwordInputCount > 0 &&
        /일치하지|확인해\s*주세요|다시\s*입력|로그인\s*실패|비밀번호가\s*일치하지|아이디가\s*일치하지|계정\s*정보/i.test(
          bodyText
        );

      if (loginFailed) {
        report(
          "무신사 자동 로그인에 실패했습니다. 저장된 계정 정보를 확인하거나 브라우저에서 수동 로그인해 주세요."
        );
        return false;
      }

      if (/member\.one\.musinsa\.com\/login/i.test(currentUrl)) {
        continue;
      }

      await page
        .goto(MUSINSA_URLS.orderList, {
          waitUntil: "domcontentloaded",
          timeout: 60000
        })
        .catch(() => undefined);

      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await page.waitForTimeout(1500);

      if (await looksLikeOrderAccess(page)) {
        report("무신사 자동 로그인 완료");
        return true;
      }
    }

    await page
      .goto(MUSINSA_URLS.orderList, {
        waitUntil: "domcontentloaded",
        timeout: 60000
      })
      .catch(() => undefined);

    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await page.waitForTimeout(2000);

    if (await looksLikeOrderAccess(page)) {
      report("무신사 자동 로그인 완료");
      return true;
    }

    report("무신사 자동 로그인 확인에 실패해 수동 로그인으로 전환합니다.");
    return false;
  } catch {
    report("무신사 자동 로그인 중 오류가 발생해 수동 로그인으로 전환합니다.");
    return false;
  }
}
