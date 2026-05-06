import type { Page } from "playwright";
import type { Credentials, ProgressReporter } from "../_base/types";
import { SELECTORS } from "./selectors";

export async function performLogin(
  page: Page,
  credentials: Credentials,
  progress?: ProgressReporter
) {
  progress?.({
    runId: "",
    siteId: 0,
    siteCode: "template",
    phase: "login",
    message: "Filling login form"
  });

  await page.fill(SELECTORS.login.usernameInput, credentials.username, {
    timeout: 10000
  });

  await page.fill(SELECTORS.login.passwordInput, credentials.password, {
    timeout: 10000
  });

  const captcha = await page.locator(SELECTORS.login.captcha).first();

  if (await captcha.isVisible({ timeout: 1000 }).catch(() => false)) {
    progress?.({
      runId: "",
      siteId: 0,
      siteCode: "template",
      phase: "login",
      message: "CAPTCHA or OTP detected. Please solve it in the browser."
    });

    await page.pause();
  }

  await page.click(SELECTORS.login.submitButton, {
    timeout: 10000
  });

  await page.waitForLoadState("domcontentloaded", {
    timeout: 10000
  });
}
