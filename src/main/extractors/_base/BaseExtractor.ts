import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { decrypt, encrypt, type EncryptedPayload } from "../../crypto/vault";
import type {
  Credentials,
  ExtractionOptions,
  ExtractorConfig,
  ProgressReporter,
  StandardOrder
} from "./types";

export abstract class BaseExtractor {
  protected browser: Browser | null = null;

  constructor(public readonly config: ExtractorConfig) {}

  abstract login(
    page: Page,
    credentials: Credentials,
    progress?: ProgressReporter
  ): Promise<void>;

  abstract isLoggedIn(page: Page): Promise<boolean>;

  abstract extractOrders(
    page: Page,
    options: ExtractionOptions,
    progress?: ProgressReporter
  ): Promise<StandardOrder[]>;

  protected getExtractorDataDir(): string {
    const dir = path.join(app.getPath("userData"), "extractors", this.config.code);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  protected getSessionFilePath(): string {
    return path.join(this.getExtractorDataDir(), "session.enc");
  }

  public async launchBrowser(): Promise<Browser> {
    if (this.browser) {
      return this.browser;
    }

    this.browser = await chromium.launch({
      headless: false,
      args: ["--disable-blink-features=AutomationControlled"]
    });

    return this.browser;
  }

  public async loadSession(context: BrowserContext): Promise<boolean> {
    const sessionPath = this.getSessionFilePath();

    if (!fs.existsSync(sessionPath)) {
      return false;
    }

    try {
      const encrypted = JSON.parse(
        fs.readFileSync(sessionPath, "utf8")
      ) as EncryptedPayload;

      const raw = await decrypt(encrypted);
      const cookies = JSON.parse(raw);

      if (Array.isArray(cookies) && cookies.length > 0) {
        await context.addCookies(cookies);
        return true;
      }

      return false;
    } catch (error) {
      console.warn(`[extractor:${this.config.code}] failed to load session`, error);
      return false;
    }
  }

  public async saveSession(context: BrowserContext): Promise<void> {
    const cookies = await context.cookies();
    const encrypted = await encrypt(JSON.stringify(cookies));
    fs.writeFileSync(
      this.getSessionFilePath(),
      JSON.stringify(encrypted, null, 2),
      "utf8"
    );
  }

  public async resetSession(): Promise<void> {
    const sessionPath = this.getSessionFilePath();

    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath);
    }
  }

  public async navigateWithRetry(
    page: Page,
    url: string,
    options?: {
      retries?: number;
      timeoutMs?: number;
      waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
    }
  ): Promise<void> {
    const retries = options?.retries ?? 3;
    const timeoutMs = options?.timeoutMs ?? 10000;
    const waitUntil = options?.waitUntil ?? "domcontentloaded";

    let lastError: unknown;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        await page.goto(url, {
          waitUntil,
          timeout: timeoutMs
        });
        return;
      } catch (error) {
        lastError = error;

        if (attempt < retries) {
          await page.waitForTimeout(1000 * attempt);
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Failed to navigate: ${url}`);
  }

  public async takeScreenshot(page: Page, label: string): Promise<string> {
    const screenshotDir = path.join(this.getExtractorDataDir(), "screenshots");
    fs.mkdirSync(screenshotDir, { recursive: true });

    const safeLabel = label.replace(/[^a-zA-Z0-9-_]/g, "_");
    const filePath = path.join(
      screenshotDir,
      `${Date.now()}-${safeLabel}.png`
    );

    await page.screenshot({
      path: filePath,
      fullPage: true
    });

    return filePath;
  }

  public async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

export default BaseExtractor;
