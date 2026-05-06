import type { Page } from "playwright";
import type { StandardOrder } from "../_base/types";
import { SELECTORS } from "./selectors";

function parseAmount(value: string): number {
  const onlyNumber = value.replace(/[^\d.-]/g, "");
  return Number.parseInt(onlyNumber || "0", 10);
}

function parseQuantity(value: string): number {
  const onlyNumber = value.replace(/[^\d]/g, "");
  return Number.parseInt(onlyNumber || "1", 10);
}

export async function parseOrdersFromPage(page: Page): Promise<StandardOrder[]> {
  const rows = page.locator(SELECTORS.orders.row);
  const count = await rows.count();
  const orders: StandardOrder[] = [];

  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);

    const orderDate = await row.locator(SELECTORS.orders.date).innerText();
    const orderNumber = await row.locator(SELECTORS.orders.orderNumber).innerText();
    const productName = await row.locator(SELECTORS.orders.productName).innerText();
    const quantityText = await row.locator(SELECTORS.orders.quantity).innerText();
    const amountText = await row.locator(SELECTORS.orders.amount).innerText();

    const invoiceNumber = await row
      .locator(SELECTORS.orders.invoiceNumber)
      .innerText()
      .catch(() => "");

    const invoiceUrl = await row
      .locator(SELECTORS.orders.invoiceUrl)
      .getAttribute("href")
      .catch(() => null);

    const shippingStatus = await row
      .locator(SELECTORS.orders.shippingStatus)
      .innerText()
      .catch(() => "");

    const rawData = await row.evaluate((element) => element.outerHTML);

    orders.push({
      orderDate: orderDate.trim(),
      orderNumber: orderNumber.trim(),
      productName: productName.trim(),
      quantity: parseQuantity(quantityText),
      amount: parseAmount(amountText),
      currency: "KRW",
      invoiceNumber: invoiceNumber.trim() || null,
      invoiceUrl,
      shippingStatus: shippingStatus.trim() || null,
      rawData
    });
  }

  return orders;
}
