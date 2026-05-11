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

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export abstract class BaseExtractor {
  protected browser: Browser | null = null;
  protected persistentContext: BrowserContext | null = null;

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

  protected getPersistentProfileDir(): string {
    const dir = path.join(this.getExtractorDataDir(), "chrome-profile");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  protected getSessionFilePath(): string {
    return path.join(this.getExtractorDataDir(), "session.enc");
  }

  public async launchBrowser(options: ExtractionOptions = {}): Promise<Browser> {
    if (this.browser) {
      return this.browser;
    }

    const runInBackground = options.headless ?? false;

    this.browser = await chromium.launch({
      // Musinsa currently does not reliably keep login sessions in pure headless mode.
      // For operational stability, background mode uses a minimized headed browser.
      headless: false,
      args: [
        "--disable-blink-features=AutomationControlled",
        ...(runInBackground
          ? [


              "--window-size=1280,900"
            ]
          : [])
      ]
    });

    return this.browser;
  }

  public async launchPersistentContext(
    options: ExtractionOptions = {}
  ): Promise<BrowserContext> {
    if (this.persistentContext) {
      return this.persistentContext;
    }

    const runInBackground = options.headless ?? false;

    const persistentProfileDir = this.getPersistentProfileDir();
    console.log("[extractor] Persistent profile dir:", persistentProfileDir);

    this.persistentContext = await chromium.launchPersistentContext(
      persistentProfileDir,
      {
        // For Musinsa operational stability, background mode uses a persistent
        // headed browser profile instead of pure headless/incognito context.
        channel: "chrome",
        headless: false,
        locale: "ko-KR",
        timezoneId: "Asia/Seoul",
        viewport: {
          width: 1440,
          height: 1200
        },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        args: [
          "--disable-blink-features=AutomationControlled",
          ...(runInBackground
            ? [
  
  
                "--window-size=1280,900"
              ]
            : [])
        ]
      }
    );

    return this.persistentContext;
  }
  protected async readStoredSessionState(): Promise<StorageState | undefined> {
    const sessionPath = this.getSessionFilePath();

    if (!fs.existsSync(sessionPath)) {
      return undefined;
    }

    try {
      const encrypted = JSON.parse(
        fs.readFileSync(sessionPath, "utf8")
      ) as EncryptedPayload;

      const raw = await decrypt(encrypted);
      const parsed = JSON.parse(raw);

      // New format: Playwright storageState object.
      if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray(parsed.cookies)
      ) {
        return {
          cookies: parsed.cookies,
          origins: Array.isArray(parsed.origins) ? parsed.origins : []
        };
      }

      // Legacy format: cookies array only.
      if (Array.isArray(parsed)) {
        return {
          cookies: parsed,
          origins: []
        };
      }

      return undefined;
    } catch (error) {
      console.warn(`[extractor:${this.config.code}] failed to read stored session state`, error);
      return undefined;
    }
  }

  public async createContext(
    browser: Browser,
    _options: ExtractionOptions = {}
  ): Promise<BrowserContext> {
    const storageState = await this.readStoredSessionState();

    return browser.newContext({
      storageState,
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      viewport: {
        width: 1440,
        height: 1200
      },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    });
  }
  public async loadSession(context: BrowserContext): Promise<boolean> {
    const storageState = await this.readStoredSessionState();

    if (!storageState || storageState.cookies.length === 0) {
      return false;
    }

    try {
      // createContext() already applies storageState at context creation time.
      // This addCookies call keeps compatibility with older flow and legacy cookie sessions.
      await context.addCookies(storageState.cookies);
      return true;
    } catch (error) {
      console.warn(`[extractor:${this.config.code}] failed to load session`, error);
      return false;
    }
  }

  public async saveSession(context: BrowserContext): Promise<void> {
    const storageState = await context.storageState();
    const encrypted = await encrypt(JSON.stringify(storageState));

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
    if (this.persistentContext) {
      await this.persistentContext.close();
      this.persistentContext = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

export default BaseExtractor;
