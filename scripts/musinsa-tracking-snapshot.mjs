import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "tmp", "musinsa-snapshot");
const USER_DATA_DIR = path.join(ROOT, "tmp", "musinsa-user-data");

const ORDER_LIST_URL = "https://www.musinsa.com/order/order-list";
const inputDetailUrl = process.argv[2] || "";

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(USER_DATA_DIR, { recursive: true });

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function saveSnapshot(page, label) {
  const stamp = nowStamp();
  const safeLabel = label.replace(/[^a-zA-Z0-9-_]/g, "-");

  const htmlPath = path.join(OUT_DIR, `${stamp}-${safeLabel}.html`);
  const screenshotPath = path.join(OUT_DIR, `${stamp}-${safeLabel}.png`);
  const textPath = path.join(OUT_DIR, `${stamp}-${safeLabel}.txt`);
  const urlPath = path.join(OUT_DIR, `${stamp}-${safeLabel}.url.txt`);

  const html = await page.content().catch(() => "");
  const text = await page.locator("body").innerText().catch(() => "");
  const url = page.url();

  fs.writeFileSync(htmlPath, html, "utf8");
  fs.writeFileSync(textPath, text, "utf8");
  fs.writeFileSync(urlPath, url, "utf8");

  await page
    .screenshot({
      path: screenshotPath,
      fullPage: true
    })
    .catch(() => null);

  console.log("[snapshot] label:", label);
  console.log("[snapshot] url:", url);
  console.log("[snapshot] html:", htmlPath);
  console.log("[snapshot] text:", textPath);
  console.log("[snapshot] screenshot:", screenshotPath);

  return {
    htmlPath,
    textPath,
    screenshotPath,
    url
  };
}

async function closePossibleModal(page) {
  const closeTexts = ["닫기", "확인", "취소"];

  for (const text of closeTexts) {
    const locator = page.getByText(text, { exact: true }).last();

    if (await locator.isVisible().catch(() => false)) {
      await locator.click().catch(() => null);
      await page.waitForTimeout(1000);
      return true;
    }
  }

  await page.keyboard.press("Escape").catch(() => null);
  await page.waitForTimeout(1000);

  return false;
}

async function waitForDetailPage(page, detailUrl) {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
  } catch {
    // ignore
  }

  await page.waitForTimeout(1500);

  const currentUrl = page.url();

  if (currentUrl !== detailUrl && detailUrl.includes("/order/order-detail/")) {
    console.log("[musinsa-tracking] not on detail page. navigating back to detail url...");
    await page.goto(detailUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await page.waitForTimeout(2000);
  }
}

async function returnToDetailPage(page, detailUrl) {
  const currentUrl = page.url();

  if (currentUrl === detailUrl) {
    await closePossibleModal(page);
    return;
  }

  console.log("[musinsa-tracking] returning to detail page");
  console.log("[musinsa-tracking] current:", currentUrl);
  console.log("[musinsa-tracking] detail :", detailUrl);

  // 1차: 브라우저 뒤로가기
  try {
    await page.goBack({
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    await page.waitForTimeout(2000);

    if (page.url() === detailUrl || page.url().includes("/order/order-detail/")) {
      console.log("[musinsa-tracking] returned by goBack:", page.url());
      return;
    }
  } catch (error) {
    console.warn("[musinsa-tracking] goBack failed:", error.message);
  }

  // 2차: 상세 URL로 직접 복귀
  try {
    console.log("[musinsa-tracking] fallback goto detail url");
    await page.goto(detailUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await page.waitForTimeout(2000);
  } catch (error) {
    console.warn("[musinsa-tracking] fallback goto failed:", error.message);
  }
}

async function clickTrackingButtonAndCapture({ context, page, index, detailUrl }) {
  const indexLabel = String(index + 1).padStart(2, "0");

  console.log("");
  console.log(`[musinsa-tracking] handling 배송 조회 #${indexLabel}`);

  await waitForDetailPage(page, detailUrl);

  // 뒤로가기/재진입 이후 DOM이 바뀌므로 매번 locator를 다시 생성
  const deliveryButtons = page.getByText("배송 조회", { exact: true });
  const count = await deliveryButtons.count();

  console.log("[musinsa-tracking] buttons currently found:", count);

  if (index >= count) {
    console.warn(`[musinsa-tracking] button #${indexLabel} not found after returning.`);
    return false;
  }

  const beforeUrl = page.url();
  const button = deliveryButtons.nth(index);

  await button.scrollIntoViewIfNeeded().catch(() => null);
  await page.waitForTimeout(500);

  const popupPromise = context
    .waitForEvent("page", { timeout: 5000 })
    .catch(() => null);

  await button
    .click({
      timeout: 10000
    })
    .catch(async (error) => {
      console.warn("[musinsa-tracking] direct click failed:", error.message);

      await button.click({ force: true }).catch((forceError) => {
        console.warn("[musinsa-tracking] force click failed:", forceError.message);
      });
    });

  const popup = await popupPromise;

  // Case A: 새 팝업/탭
  if (popup) {
    console.log(`[musinsa-tracking] popup opened for #${indexLabel}`);

    await popup.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => null);
    await popup.waitForTimeout(3000);

    await saveSnapshot(popup, `tracking-popup-${indexLabel}`);

    await popup.close().catch(() => null);
    await page.bringToFront().catch(() => null);
    await returnToDetailPage(page, detailUrl);

    return true;
  }

  // Case B/C: 같은 탭 모달 또는 같은 탭 페이지 이동
  await page.waitForTimeout(3000);

  const afterUrl = page.url();

  if (afterUrl !== beforeUrl) {
    // Case B: 같은 탭에서 배송조회 페이지로 이동
    console.log(`[musinsa-tracking] same-tab navigation detected for #${indexLabel}`);
    console.log("[musinsa-tracking] before:", beforeUrl);
    console.log("[musinsa-tracking] after :", afterUrl);

    await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(2000);

    await saveSnapshot(page, `tracking-same-tab-${indexLabel}`);

    await returnToDetailPage(page, detailUrl);

    return true;
  }

  // Case C: URL 변화 없음. 모달/레이어일 가능성
  console.log(`[musinsa-tracking] no popup/no url change. capturing current page or modal #${indexLabel}`);

  await saveSnapshot(page, `tracking-current-or-modal-${indexLabel}`);

  await closePossibleModal(page);
  await returnToDetailPage(page, detailUrl);

  return true;
}

async function main() {
  console.log("[musinsa-tracking] launching persistent browser");
  console.log("[musinsa-tracking] userData:", USER_DATA_DIR);

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    slowMo: 100,
    viewport: {
      width: 1440,
      height: 1000
    },
    locale: "ko-KR"
  });

  const page = context.pages()[0] || (await context.newPage());

  const startUrl = inputDetailUrl || ORDER_LIST_URL;

  console.log("[musinsa-tracking] opening:", startUrl);

  await page.goto(startUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  console.log("");
  console.log("============================================================");
  console.log("무신사 배송조회 스냅샷 v2");
  console.log("1) 로그인이 필요하면 직접 로그인해 주세요.");
  console.log("2) 주문 상세 페이지로 이동해 주세요.");
  console.log("3) 화면에 상품별 [배송 조회] 버튼이 보이면 PowerShell로 돌아와 Enter.");
  console.log("4) 스크립트가 배송 조회 버튼을 순서대로 클릭합니다.");
  console.log("5) 같은 탭 이동이면 스냅샷 저장 후 자동 뒤로가기/상세URL 복귀합니다.");
  console.log("============================================================");
  console.log("");

  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", resolve);
  });

  const detailUrl = page.url();

  console.log("[musinsa-tracking] detail url:", detailUrl);

  await page.waitForTimeout(2000);
  await saveSnapshot(page, "before-tracking-click");

  let initialCount = await page.getByText("배송 조회", { exact: true }).count();

  console.log("[musinsa-tracking] initial delivery tracking buttons:", initialCount);

  if (initialCount === 0) {
    console.log("[musinsa-tracking] No 배송 조회 buttons found.");
    console.log("[musinsa-tracking] Please confirm the detail page has 배송 조회 buttons.");
    await context.close();
    return;
  }

  for (let i = 0; i < initialCount; i += 1) {
    await clickTrackingButtonAndCapture({
      context,
      page,
      index: i,
      detailUrl
    });

    // 복귀 후 버튼 수가 변할 수 있으므로 다시 확인
    await waitForDetailPage(page, detailUrl);

    const currentCount = await page.getByText("배송 조회", { exact: true }).count();
    console.log("[musinsa-tracking] buttons after return:", currentCount);

    if (currentCount > initialCount) {
      initialCount = currentCount;
    }
  }

  console.log("");
  console.log("[musinsa-tracking] complete");
  console.log("[musinsa-tracking] output dir:", OUT_DIR);

  await context.close();
}

main().catch((error) => {
  console.error("[musinsa-tracking] failed:", error);
  process.exit(1);
});