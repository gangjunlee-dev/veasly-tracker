import type { Page } from "playwright";
import { MUSINSA_SELECTORS } from "./selectors";
import { unique } from "./page-utils";
import { getBodyText } from "./page-utils";
import type { DetailLink } from "./date-filter";

export type TrackingTarget = {
  index: number;
  href?: string;
  text: string;
  containerText: string;
};

export async function collectDetailLinks(page: Page): Promise<DetailLink[]> {
  const anchorLinks = await page
    .locator(MUSINSA_SELECTORS.orderDetailLinks.join(","))
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
    html.matchAll(/https?:\/\/www\.musinsa\.com\/order\/order-detail\/\d+/g)
  ).map((match) => ({
    url: match[0],
    text: ""
  }));

  const relativeMatches = Array.from(
    html.matchAll(/\/order\/order-detail\/\d+/g)
  ).map((match) => ({
    url: `https://www.musinsa.com${match[0]}`,
    text: ""
  }));

  return unique(
    [...anchorLinks, ...absoluteMatches, ...relativeMatches]
      .filter((link) => link.url && link.url.includes("/order/order-detail/"))
      .map((link) => ({
        url: link.url,
        text: link.text.trim()
      })),
    (link) => link.url
  );
}

export function trackingLocator(page: Page) {
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

export async function collectTrackingTargets(
  page: Page
): Promise<TrackingTarget[]> {
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
    href: `https://www.musinsa.com${match[0].replace(/&amp;/g, "&")}`,
    text: "배송조회 URL",
    containerText: ""
  }));

  return unique(
    [...targets, ...absoluteTraceMatches, ...relativeTraceMatches],
    (target) =>
      target.href ||
      `${target.index}-${target.text}-${target.containerText.slice(0, 40)}`
  );
}

export async function openTrackingAndReadText(
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
