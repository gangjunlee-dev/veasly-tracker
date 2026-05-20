import { ipcMain } from "electron";
import { z } from "zod";
import crypto from "node:crypto";
import { ensureOrdersRuntimeColumns, getDb } from "../db/client";
import { decrypt } from "../crypto/vault";
import { normalizeTrackingNumber } from "../utils/tracking";
import { createLogger } from "../utils/logger";
import {
  cleanupStaleRunningLogs as cleanupStaleRunningLogsFromRepo,
  createExtractionLog,
  finishExtractionLog
} from "../services/logs-repo";
import {
  getSiteWithCredentials,
  touchSiteExtractedAt
} from "../services/sites-repo";

const log = createLogger("extractor");
import {
  getExtractor,
  listExtractors,
  loadExtractors
} from "../extractors/_base/registry";
import type {
  ExtractionOptions,
  ExtractionProgress,
  ProgressReporter,
  StandardOrder
} from "../extractors/_base/types";
import type { BaseExtractor } from "../extractors/_base/BaseExtractor";

const RunExtractorSchema = z.object({
  siteId: z.number().int().positive(),
  options: z
    .object({
      since: z.string().optional(),
      until: z.string().optional(),
      maxPages: z.number().int().positive().optional(),
      lastOrderDate: z.string().optional(),
      includeNoTracking: z.boolean().optional(),
      headless: z.boolean().optional(),

      // Site-specific extractor options. Keep explicit keys for typing/validation,
      // and passthrough below so future extractor-specific options are not stripped.
      maxOrders: z.number().int().positive().optional(),
      limit: z.number().int().positive().optional(),
      maxItems: z.number().int().positive().optional(),
      take: z.number().int().positive().optional(),
      count: z.number().int().positive().optional(),

      trackingLimit: z.number().int().positive().optional(),
      maxTracking: z.number().int().positive().optional(),
      maxTrackingOrders: z.number().int().positive().optional(),
      trackingCount: z.number().int().positive().optional(),

      includeTracking: z.boolean().optional(),
      onlyTrackable: z.boolean().optional(),
      trackingOnly: z.boolean().optional(),
      debugShippingDiagnostic: z.boolean().optional(),
      diagnosticLimit: z.number().int().positive().optional(),

      naverpay: z.record(z.any()).optional(),
      naverPay: z.record(z.any()).optional(),
      extra: z.record(z.any()).optional()
    })
    .passthrough()
    .optional()
});

const CancelExtractorSchema = z.object({
  runId: z.string().min(1)
});

type RunningJob = {
  siteId: number;
  abortController: AbortController;
  extractor: BaseExtractor;
};


const runningJobs = new Map<string, RunningJob>();
const runningSiteJobs = new Map<number, string>();


function nowIso() {
  return new Date().toISOString();
}

function normalizeProgress(
  progress: Omit<ExtractionProgress, "createdAt">
): ExtractionProgress {
  return {
    ...progress,
    createdAt: nowIso()
  };
}

function cleanupStaleRunningLogs(): number {
  try {
    const changes = cleanupStaleRunningLogsFromRepo();
    if (changes > 0) {
      log.warn(`Cleaned up ${changes} stale running extraction log(s)`);
    }
    return changes;
  } catch (error) {
    log.warn("Failed to clean up stale running logs", error);
    return 0;
  }
}


function normalizeOrderRawDataForDb(rawData: unknown): string | null {
  if (rawData === undefined || rawData === null) return null;

  if (typeof rawData === "string") {
    return rawData;
  }

  try {
    return JSON.stringify(rawData);
  } catch {
    return String(rawData);
  }
}

function parseOrderRawDataForDb(rawData: unknown): Record<string, unknown> {
  if (!rawData) return {};

  if (typeof rawData === "string") {
    try {
      const parsed = JSON.parse(rawData);
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }

  if (typeof rawData === "object") {
    return rawData as Record<string, unknown>;
  }

  return {};
}

function dbRequiredTextForOrder(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  const text = String(value);
  return text.length > 0 ? text : fallback;
}

function dbNullableTextForOrder(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function dbNumberForOrder(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function upsertOrders(siteId: number, orders: StandardOrder[]) {
  const db = getDb();

  // Belt-and-suspenders: even if the startup migration was skipped on this
  // machine for any reason, guarantee the columns exist before INSERT.
  ensureOrdersRuntimeColumns(db);

  const checkExisting = db.prepare(
    "SELECT id FROM orders WHERE site_id = ? AND order_number = ?"
  );

  const upsert = db.prepare(
    `
    INSERT INTO orders (
      site_id,
      order_number,
      order_date,
      product_name,
      quantity,
      amount,
      currency,
      invoice_number,
      invoice_url,
      shipping_status,
      tracking_number,
      normalized_tracking_number,
      raw_data
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(site_id, order_number)
    DO UPDATE SET
      order_date = excluded.order_date,
      product_name = excluded.product_name,
      quantity = excluded.quantity,
      amount = excluded.amount,
      currency = excluded.currency,
      invoice_number = excluded.invoice_number,
      invoice_url = excluded.invoice_url,
      shipping_status = excluded.shipping_status,
      tracking_number = excluded.tracking_number,
      normalized_tracking_number = excluded.normalized_tracking_number,
      raw_data = excluded.raw_data,
      updated_at = datetime('now')
    `
  );

  let newOrders = 0;
  let updatedOrders = 0;

  const tx = db.transaction((items: StandardOrder[]) => {
    for (const order of items) {
      const existing = checkExisting.get(siteId, order.orderNumber);

      const rawDataForDb = normalizeOrderRawDataForDb(order.rawData);
      const rawObjectForDb = parseOrderRawDataForDb(order.rawData);

      const invoiceNumberForDb =
        dbNullableTextForOrder(order.invoiceNumber) ??
        dbNullableTextForOrder(rawObjectForDb.trackingNumber);

      const invoiceUrlForDb =
        dbNullableTextForOrder(order.invoiceUrl) ??
        dbNullableTextForOrder(rawObjectForDb.trackingUrl);

      const trackingNumberForDb =
        dbNullableTextForOrder(rawObjectForDb.trackingNumber) ??
        invoiceNumberForDb;

      const normalizedTrackingForDb = trackingNumberForDb
        ? normalizeTrackingNumber(trackingNumberForDb) || null
        : null;

      upsert.run(
        siteId,
        dbRequiredTextForOrder(order.orderNumber),
        dbRequiredTextForOrder(order.orderDate),
        dbRequiredTextForOrder(order.productName),
        dbNumberForOrder(order.quantity, 1),
        dbNumberForOrder(order.amount, 0),
        dbRequiredTextForOrder(order.currency, "KRW"),
        invoiceNumberForDb,
        invoiceUrlForDb,
        dbNullableTextForOrder(order.shippingStatus),
        trackingNumberForDb,
        normalizedTrackingForDb,
        rawDataForDb
      );

      if (existing) {
        updatedOrders += 1;
      } else {
        newOrders += 1;
      }
    }
  });

  tx(orders);

  return {
    totalOrders: orders.length,
    newOrders,
    updatedOrders
  };
}

async function runExtraction(input: {
  runId: string;
  siteId: number;
  options: ExtractionOptions;
  sendProgress: ProgressReporter;
  abortController: AbortController;
}) {
  const site = getSiteWithCredentials(input.siteId);

  if (!site) {
    throw new Error(`사이트를 찾을 수 없습니다 (id=${input.siteId}).`);
  }

  if (!site.enabled) {
    throw new Error(`비활성화된 사이트입니다 (id=${input.siteId}).`);
  }

  const logId = createExtractionLog(site.id);
  const extractor = getExtractor(site.code);

  // Musinsa does not reliably support pure headless/background login checks.
  // Treat background mode as a persistent headed-browser automation mode.
  const requestedBackground = input.options.headless === true;

  const effectiveOptions = {
    ...input.options,
    headless: false
  };

  let extractionSucceeded = false;

  runningJobs.set(input.runId, {
  siteId: site.id,
  abortController: input.abortController,
  extractor
});


  const credentials = {
    username: site.username,
    password: await decrypt({
      ciphertext: site.passwordCiphertext,
      iv: site.passwordIv,
      authTag: site.passwordAuthTag
    })
  };

  // Single source of truth: any progress event flowing through this run is stamped
  // with the orchestrator's runId/siteId/siteCode, even if the extractor passed
  // placeholders ("", 0).
  const sendProgress: ProgressReporter = (progress) => {
    input.sendProgress({
      ...progress,
      runId: input.runId,
      siteId: site.id,
      siteCode: site.code
    });
  };

  const report = (
    phase: ExtractionProgress["phase"],
    message: string,
    extra?: Partial<ExtractionProgress>
  ) => {
    sendProgress({
      runId: input.runId,
      siteId: site.id,
      siteCode: site.code,
      phase,
      message,
      ...extra
    });
  };

  try {
    report("starting", "Extraction job started");

    if (input.abortController.signal.aborted) {
      throw new Error("Extraction cancelled");
    }

    const headless = effectiveOptions.headless ?? false;
    report(
      "browser",
      headless
        ? "Launching browser with persistent profile"
        : "Launching browser"
    );

    const context = await extractor.launchPersistentContext(effectiveOptions);

    report("session", "Using persistent browser profile");

    const existingPages = context.pages();
    const page =
      requestedBackground && existingPages.length > 0
        ? existingPages[0]
        : await context.newPage();

    report("login", "Checking login status");
    const loggedIn = await extractor.isLoggedIn(page).catch(() => false);

    if (!loggedIn) {
      report("login", "Login required");
      report("login", "Opening browser for login with persistent profile");

      await extractor.login(page, credentials, sendProgress);
      await extractor.saveSession(context);
      report("session", "Session saved");
    } else {
      report("login", "Already logged in");
      await extractor.saveSession(context);
      report("session", "Session refreshed");
    }

    if (input.abortController.signal.aborted) {
      throw new Error("Extraction cancelled");
    }

    report("extracting", "Extracting orders");
    const orders = await extractor.extractOrders(
      page,
      effectiveOptions,
      sendProgress
    );

    if (input.abortController.signal.aborted) {
      throw new Error("Extraction cancelled");
    }

    report("saving", `Saving ${orders.length} orders`, {
      ordersFound: orders.length
    });

    const result = upsertOrders(site.id, orders);

    touchSiteExtractedAt(site.id);

    finishExtractionLog({
      logId,
      status: "success",
      message: "Extraction completed",
      ...result
    });

    report("success", "Extraction completed", {
      ordersFound: result.totalOrders
    });

    extractionSucceeded = true;
  } catch (error) {
    const isCancelled =
      input.abortController.signal.aborted ||
      (error instanceof Error && error.message.includes("cancelled"));

    finishExtractionLog({
      logId,
      status: isCancelled ? "cancelled" : "failed",
      message:
        error instanceof Error ? error.message : "Unknown extraction error",
      errorStack: error instanceof Error ? error.stack : undefined
    });

    report(
      isCancelled ? "cancelled" : "failed",
      error instanceof Error ? error.message : "Unknown extraction error"
    );

    if (!isCancelled) {
      throw error;
    }
  } finally {
    runningJobs.delete(input.runId);

    if (requestedBackground && extractionSucceeded) {
      report("browser", "Keeping persistent browser open for session reuse");
    } else {
      await extractor.close();
    }
  }
}

export function registerExtractorIpc() {
  cleanupStaleRunningLogs();

  loadExtractors();

  ipcMain.handle("extractor:available", async () => {
    return listExtractors();
  });

  ipcMain.handle("extractor:run", async (event, rawInput) => {
  const input = RunExtractorSchema.parse(rawInput);

  const existingRunId = runningSiteJobs.get(input.siteId);

  if (existingRunId) {
    return {
      runId: existingRunId,
      alreadyRunning: true
    };
  }

  const runId = crypto.randomUUID();
  const abortController = new AbortController();

  runningSiteJobs.set(input.siteId, runId);


    const sendProgress: ProgressReporter = (progress) => {
      event.sender.send("extractor:progress", normalizeProgress(progress));
    };

    void runExtraction({
  runId,
  siteId: input.siteId,
  options: input.options ?? {},
  sendProgress,
  abortController
})
  .catch((error) => {
    log.error("run failed", error);
  })
  .finally(() => {
    if (runningSiteJobs.get(input.siteId) === runId) {
      runningSiteJobs.delete(input.siteId);
    }
  });


    return {
      runId
    };
  });

  ipcMain.handle("extractor:cancel", async (_event, rawInput) => {
    const input = CancelExtractorSchema.parse(rawInput);
    const job = runningJobs.get(input.runId);

    if (!job) {
      return {
        success: false,
        message: "Job not found"
      };
    }

    job.abortController.abort();
await job.extractor.close();

if (runningSiteJobs.get(job.siteId) === input.runId) {
  runningSiteJobs.delete(job.siteId);
}

return {
  success: true
};

  });
}
