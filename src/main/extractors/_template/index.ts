import type { Page } from "playwright";
import { BaseExtractor } from "../_base/BaseExtractor";
import type {
  Credentials,
  ExtractionOptions,
  ProgressReporter,
  StandardOrder
} from "../_base/types";
import { performLogin } from "./login";
import { parseOrdersFromPage } from "./parser";
import config from "./config.json";

class TemplateExtractor extends BaseExtractor {
  constructor() {
    super(config);
  }

  async login(
    page: Page,
    credentials: Credentials,
    progress?: ProgressReporter
  ): Promise<void> {
    if (!this.config.loginUrl) {
      throw new Error("loginUrl is missing in config.json");
    }

    await this.navigateWithRetry(page, this.config.loginUrl);
    await performLogin(page, credentials, progress);
  }

  async isLoggedIn(page: Page): Promise<boolean> {
    if (!this.config.ordersUrl) {
      return false;
    }

    await this.navigateWithRetry(page, this.config.ordersUrl);

    return !page.url().includes("login");
  }

  async extractOrders(
    page: Page,
    options: ExtractionOptions,
    progress?: ProgressReporter
  ): Promise<StandardOrder[]> {
    if (!this.config.ordersUrl) {
      throw new Error("ordersUrl is missing in config.json");
    }

    progress?.({
      runId: "",
      siteId: 0,
      siteCode: this.config.code,
      phase: "extracting",
      message: "Opening orders page"
    });

    await this.navigateWithRetry(page, this.config.ordersUrl);

    const orders = await parseOrdersFromPage(page);

    if (options.since) {
      return orders.filter((order) => order.orderDate >= options.since!);
    }

    return orders;
  }
}

export default TemplateExtractor;
