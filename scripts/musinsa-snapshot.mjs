import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "tmp", "musinsa-snapshot");

const LOGIN_URL = "https://www.musinsa.com/auth/login";
const ORDER_LIST_URL = "https://www.musinsa.com/order/order-list";

fs.mkdirSync(OUT_DIR, { recursive: true });

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function saveSnapshot(page, label) {
  const stamp = nowStamp();
  const htmlPath = path.join(OUT_DIR, `${stamp}-${label}.html`);
  const screenshotPath = path.join(OUT_DIR, `${stamp}-${label}.png`);
  const textPath = path.join(OUT_DIR, `${stamp}-${label}.txt`);

  const html = await page.content();
  const text = await page.locator("body").innerText().catch(() => "");

  fs.writeFileSync(htmlPath, html, "utf8");
  fs.writeFileSync(textPath, text, "utf8");

  await page.screenshot({
    path: screenshotPath,
    fullPage: true
  });

  console.log("[snapshot] html:", htmlPath);
  console.log("[snapshot] text:", textPath);
  console.log("[snapshot] screenshot:", screenshotPath);
}

async function main() {
  console.log("[musinsa] launching browser");

  const browser = await chromium.launch({
    headless: false,
    slowMo: 100
  });

  const context = await browser.newContext({
    viewport: {
      width: 1440,
      height: 1000
    },
    locale: "ko-KR"
  });

  const page = await context.newPage();

  console.log("[musinsa] opening order list:", ORDER_LIST_URL);
  await page.goto(ORDER_LIST_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  console.log("");
  console.log("============================================================");
  console.log("무신사 로그인/주문내역 확인 단계");
  console.log("1) 브라우저가 열렸습니다.");
  console.log("2) 로그인이 필요하면 직접 로그인해 주세요.");
  console.log("3) 2차 인증/CAPTCHA가 나오면 직접 완료해 주세요.");
  console.log("4) 최종적으로 주문내역 페이지가 보이면 PowerShell로 돌아와 Enter를 누르세요.");
  console.log("대상 URL:", ORDER_LIST_URL);
  console.log("============================================================");
  console.log("");

  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", resolve);
  });

  console.log("[musinsa] current url:", page.url());

  try {
    await page.goto(ORDER_LIST_URL, {
      waitUntil: "networkidle",
      timeout: 60000
    });
  } catch (error) {
    console.warn("[musinsa] networkidle timeout or navigation warning:", error.message);
  }

  await page.waitForTimeout(3000);

  await saveSnapshot(page, "order-list");

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const preview = bodyText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 120);

  console.log("");
  console.log("========== BODY TEXT PREVIEW ==========");
  console.log(preview.join("\n"));
  console.log("=======================================");
  console.log("");

  console.log("[musinsa] snapshot complete");
  console.log("[musinsa] output dir:", OUT_DIR);
  console.log("");
  console.log("확인할 파일:");
  console.log("- tmp/musinsa-snapshot/*order-list.png");
  console.log("- tmp/musinsa-snapshot/*order-list.txt");
  console.log("- tmp/musinsa-snapshot/*order-list.html");

  await browser.close();
}

main().catch((error) => {
  console.error("[musinsa] failed:", error);
  process.exit(1);
});