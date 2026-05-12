import { ipcMain } from "electron";
import { z } from "zod";
import crypto from "node:crypto";
import { getDb } from "../db/client";
import { decrypt } from "../crypto/vault";
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
      headless: z.boolean().optional()
    })
    .optional()
});

const CancelExtractorSchema = z.object({
  runId: z.string().min(1)
});

type RunningJob = {
  abortController: AbortController;
  extractor: BaseExtractor;
};

const runningJobs = new Map<string, RunningJob>();

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

function getSiteForExtraction(siteId: number) {
  const db = getDb();

  return db
    .prepare(
      `
      SELECT
        id,
        code,
        name,
        username,
        password_ciphertext,
        password_iv,
        password_auth_tag,
        enabled
      FROM sites
      WHERE id = ?
      `
    )
    .get(siteId) as
    | {
        id: number;
        code: string;
        name: string;
        username: string;
        password_ciphertext: string;
        password_iv: string;
        password_auth_tag: string;
        enabled: number;
      }
    | undefined;
}

function createLog(siteId: number): number {
  const db = getDb();

  const result = db
    .prepare(
      `
      INSERT INTO extraction_logs (
        site_id,
        status,
        message
      )
      VALUES (?, 'running', ?)
      `
    )
    .run(siteId, "Extraction started");

  return Number(result.lastInsertRowid);
}

function finishLog(input: {
  logId: number;
  status: "success" | "failed" | "cancelled";
  message?: string;
  totalOrders?: number;
  newOrders?: number;
  updatedOrders?: number;
  errorStack?: string;
}) {
  const db = getDb();

  db.prepare(
    `
    UPDATE extraction_logs
    SET
      status = ?,
      finished_at = datetime('now'),
      message = ?,
      total_orders = ?,
      new_orders = ?,
      updated_orders = ?,
      error_stack = ?
    WHERE id = ?
    `
  ).run(
    input.status,
    input.message ?? null,
    input.totalOrders ?? 0,
    input.newOrders ?? 0,
    input.updatedOrders ?? 0,
    input.errorStack ?? null,
    input.logId
  );
}

function upsertOrders(siteId: number, orders: StandardOrder[]) {
  const db = getDb();

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
      raw_data
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      raw_data = excluded.raw_data,
      updated_at = datetime('now')
    `
  );

  let newOrders = 0;
  let updatedOrders = 0;

  const tx = db.transaction((items: StandardOrder[]) => {
    for (const order of items) {
      const existing = checkExisting.get(siteId, order.orderNumber);

      upsert.run(
        siteId,
        order.orderNumber,
        order.orderDate,
        order.productName,
        order.quantity,
        order.amount,
        order.currency ?? "KRW",
        order.invoiceNumber ?? null,
        order.invoiceUrl ?? null,
        order.shippingStatus ?? null,
        order.rawData ?? null
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
  const site = getSiteForExtraction(input.siteId);

  if (!site) {
    throw new Error(`Site not found: ${input.siteId}`);
  }

  if (!site.enabled) {
    throw new Error(`Site is disabled: ${input.siteId}`);
  }

  const logId = createLog(site.id);
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
    abortController: input.abortController,
    extractor
  });

  const credentials = {
    username: site.username,
    password: await decrypt({
      ciphertext: site.password_ciphertext,
      iv: site.password_iv,
      authTag: site.password_auth_tag
    })
  };

  const report = (
    phase: ExtractionProgress["phase"],
    message: string,
    extra?: Partial<ExtractionProgress>
  ) => {
    input.sendProgress({
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
    report("browser", headless ? "Launching browser with persistent profile" : "Launching browser");
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

      await extractor.login(page, credentials, input.sendProgress);
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
      input.sendProgress
    );

    if (input.abortController.signal.aborted) {
      throw new Error("Extraction cancelled");
    }

    report("saving", `Saving ${orders.length} orders`, {
      ordersFound: orders.length
    });

    const result = upsertOrders(site.id, orders);

    getDb()
      .prepare(
        `
        UPDATE sites
        SET last_extracted_at = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
        `
      )
      .run(site.id);

    finishLog({
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

    finishLog({
      logId,
      status: isCancelled ? "cancelled" : "failed",
      message: error instanceof Error ? error.message : "Unknown extraction error",
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
  loadExtractors();

  ipcMain.handle("extractor:available", async () => {
    return listExtractors();
  });

  ipcMain.handle("extractor:run", async (event, rawInput) => {
    const input = RunExtractorSchema.parse(rawInput);
    const runId = crypto.randomUUID();
    const abortController = new AbortController();

    const sendProgress: ProgressReporter = (progress) => {
      event.sender.send("extractor:progress", normalizeProgress(progress));
    };

    void runExtraction({
      runId,
      siteId: input.siteId,
      options: input.options ?? {},
      sendProgress,
      abortController
    }).catch((error) => {
      console.error("[extractor] run failed", error);
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

    return {
      success: true
    };
  });
}
