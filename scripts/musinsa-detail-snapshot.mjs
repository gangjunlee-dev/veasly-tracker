import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "tmp", "musinsa-snapshot");

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

  await page.goto(ORDER_LIST_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  console.log("");
  console.log("============================================================");
  console.log("무신사 주문 상세 스냅샷");
  console.log("1) 로그인해 주세요.");
  console.log("2) 주문내역 페이지에서 아무 주문의 [주문 상세]를 직접 클릭해 주세요.");
  console.log("3) 주문 상세 페이지/모달이 보이면 PowerShell로 돌아와 Enter를 누르세요.");
  console.log("============================================================");
  console.log("");

  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", resolve);
  });

  console.log("[musinsa-detail] current url:", page.url());

  await page.waitForTimeout(3000);
  await saveSnapshot(page, "order-detail");

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const preview = bodyText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 160);

  console.log("");
  console.log("========== DETAIL BODY TEXT PREVIEW ==========");
  console.log(preview.join("\n"));
  console.log("==============================================");
  console.log("");

  await browser.close();
}

main().catch((error) => {
  console.error("[musinsa-detail] failed:", error);
  process.exit(1);
});