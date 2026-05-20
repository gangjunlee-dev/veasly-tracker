import type { Page } from "playwright";

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getBodyText(page: Page): Promise<string> {
  try {
    return await page.locator("body").innerText({ timeout: 5000 });
  } catch {
    return "";
  }
}

export function normalizeLines(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
}

export function unique<T>(items: T[], getKey: (item: T) => string): T[] {
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

export function orderDateFromSourceOrderNumber(sourceOrderNumber: string): string {
  const compact = sourceOrderNumber.slice(0, 8);

  if (!/^\d{8}$/.test(compact)) {
    return new Date().toISOString().slice(0, 10);
  }

  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}
