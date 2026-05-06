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

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIsoDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

class DemoExtractor extends BaseExtractor {
  constructor(extractorConfig: ExtractorConfig = config) {
    super(extractorConfig);
  }

  async login(
    page: Page,
    _credentials: Credentials,
    progress?: ProgressReporter
  ): Promise<void> {
    progress?.({
      runId: "",
      siteId: 0,
      siteCode: this.config.code,
      phase: "login",
      message: "Demo extractor does not require real login"
    });

    await page.goto("about:blank");
  }

  async isLoggedIn(page: Page): Promise<boolean> {
    await page.goto("about:blank");
    return true;
  }

  async extractOrders(
    _page: Page,
    options: ExtractionOptions,
    progress?: ProgressReporter
  ): Promise<StandardOrder[]> {
    progress?.({
      runId: "",
      siteId: 0,
      siteCode: this.config.code,
      phase: "extracting",
      message: "Generating demo orders",
      current: 1,
      total: 3
    });

    const orders: StandardOrder[] = [
      {
        orderNumber: `DEMO-${todayIsoDate()}-001`,
        orderDate: todayIsoDate(),
        productName: "Demo Korean Trend Product A",
        quantity: 1,
        amount: 19900,
        currency: "KRW",
        invoiceNumber: "DINV001",
        invoiceUrl: "https://example.com/tracking/DINV001",
        shippingStatus: "READY",
        rawData: JSON.stringify({
          source: "demo",
          sequence: 1
        })
      },
      {
        orderNumber: `DEMO-${todayIsoDate()}-002`,
        orderDate: todayIsoDate(),
        productName: "Demo Beauty Item B",
        quantity: 2,
        amount: 43800,
        currency: "KRW",
        invoiceNumber: "DINV002",
        invoiceUrl: "https://example.com/tracking/DINV002",
        shippingStatus: "SHIPPED",
        rawData: JSON.stringify({
          source: "demo",
          sequence: 2
        })
      },
      {
        orderNumber: `DEMO-${daysAgoIsoDate(1)}-003`,
        orderDate: daysAgoIsoDate(1),
        productName: "Demo Taiwan Cross-border SKU C",
        quantity: 1,
        amount: 28900,
        currency: "KRW",
        invoiceNumber: null,
        invoiceUrl: null,
        shippingStatus: "PENDING",
        rawData: JSON.stringify({
          source: "demo",
          sequence: 3
        })
      }
    ];

    const filtered = options.since
      ? orders.filter((order) => order.orderDate >= options.since!)
      : orders;

    progress?.({
      runId: "",
      siteId: 0,
      siteCode: this.config.code,
      phase: "extracting",
      message: `Generated ${filtered.length} demo orders`,
      current: filtered.length,
      total: orders.length,
      ordersFound: filtered.length
    });

    return filtered;
  }
}

export default DemoExtractor;
