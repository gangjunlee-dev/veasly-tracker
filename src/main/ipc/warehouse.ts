import { ipcMain } from "electron";
import { z } from "zod";
import { getDb } from "../db/client";

const PaginationSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(300).default(50)
});

const ScanInboundSchema = z.object({
  trackingNumber: z.string().min(1),
  carrier: z.string().optional(),
  note: z.string().optional()
});

const ListInboundScansSchema = PaginationSchema.extend({
  status: z.string().optional(),
  search: z.string().optional()
});

const AutoMatchSchema = z
  .object({
    scanId: z.number().int().positive().optional()
  })
  .optional();

let warehouseSchemaEnsured = false;

function nowIso() {
  return new Date().toISOString();
}

function normalizeTrackingNumber(input: string) {
  return input
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^0-9A-Za-z-]/g, "")
    .toUpperCase();
}

function maskTrackingNumber(value: string) {
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function ensureWarehouseSchema() {
  if (warehouseSchemaEnsured) return;

  const db = getDb();

  const columns = db
    .prepare("PRAGMA table_info(orders)")
    .all() as Array<{ name: string }>;

  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("warehouse_status")) {
    db.prepare(
      "ALTER TABLE orders ADD COLUMN warehouse_status TEXT NOT NULL DEFAULT 'NOT_ARRIVED'"
    ).run();
  }

  if (!columnNames.has("warehouse_arrived_at")) {
    db.prepare("ALTER TABLE orders ADD COLUMN warehouse_arrived_at TEXT").run();
  }

  if (!columnNames.has("warehouse_scan_id")) {
    db.prepare("ALTER TABLE orders ADD COLUMN warehouse_scan_id INTEGER").run();
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_warehouse_status
      ON orders(warehouse_status);

    CREATE INDEX IF NOT EXISTS idx_orders_invoice_number
      ON orders(invoice_number);

    CREATE TABLE IF NOT EXISTS inbound_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tracking_number TEXT NOT NULL,
      normalized_tracking_number TEXT NOT NULL UNIQUE,
      carrier TEXT,
      raw_input TEXT,
      status TEXT NOT NULL DEFAULT 'SCANNED',
      matched_order_count INTEGER NOT NULL DEFAULT 0,
      scan_count INTEGER NOT NULL DEFAULT 1,
      scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_scanned_at TEXT,
      matched_at TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_inbound_scans_tracking
      ON inbound_scans(normalized_tracking_number);

    CREATE INDEX IF NOT EXISTS idx_inbound_scans_status
      ON inbound_scans(status);

    CREATE INDEX IF NOT EXISTS idx_inbound_scans_scanned_at
      ON inbound_scans(scanned_at);

    CREATE TABLE IF NOT EXISTS inbound_scan_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      match_type TEXT NOT NULL DEFAULT 'AUTO',
      matched_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (scan_id) REFERENCES inbound_scans(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      UNIQUE(scan_id, order_id)
    );

    CREATE INDEX IF NOT EXISTS idx_inbound_scan_matches_scan_id
      ON inbound_scan_matches(scan_id);

    CREATE INDEX IF NOT EXISTS idx_inbound_scan_matches_order_id
      ON inbound_scan_matches(order_id);
  `);

  warehouseSchemaEnsured = true;
}

function safeParseRawData(rawData: unknown): Record<string, unknown> {
  if (!rawData || typeof rawData !== "string") return {};

  try {
    const parsed = JSON.parse(rawData);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function mapInboundScanRow(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    trackingNumber: String(row.tracking_number),
    normalizedTrackingNumber: String(row.normalized_tracking_number),
    carrier: row.carrier ? String(row.carrier) : null,
    rawInput: row.raw_input ? String(row.raw_input) : null,
    status: String(row.status),
    matchedOrderCount: Number(row.matched_order_count ?? 0),
    scanCount: Number(row.scan_count ?? 0),
    scannedAt: String(row.scanned_at),
    lastScannedAt: row.last_scanned_at ? String(row.last_scanned_at) : null,
    matchedAt: row.matched_at ? String(row.matched_at) : null,
    note: row.note ? String(row.note) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapWarehouseOrderRow(row: Record<string, unknown>) {
  const raw = safeParseRawData(row.raw_data);

  return {
    id: Number(row.id),
    siteId: Number(row.site_id),
    siteName: row.site_name ? String(row.site_name) : undefined,
    siteCode: row.site_code ? String(row.site_code) : undefined,
    orderNumber: String(row.order_number),
    orderDate: String(row.order_date),
    productName: String(row.product_name),
    quantity: Number(row.quantity),
    amount: Number(row.amount),
    currency: String(row.currency),
    invoiceNumber: row.invoice_number ? String(row.invoice_number) : null,
    invoiceUrl: row.invoice_url ? String(row.invoice_url) : null,
    shippingStatus: row.shipping_status ? String(row.shipping_status) : null,
    warehouseStatus: row.warehouse_status
      ? String(row.warehouse_status)
      : "NOT_ARRIVED",
    warehouseArrivedAt: row.warehouse_arrived_at
      ? String(row.warehouse_arrived_at)
      : null,
    warehouseScanId: row.warehouse_scan_id
      ? Number(row.warehouse_scan_id)
      : null,
    carrier: typeof raw.carrier === "string" ? raw.carrier : null,
    trackingNumber:
      typeof raw.trackingNumber === "string"
        ? raw.trackingNumber
        : row.invoice_number
          ? String(row.invoice_number)
          : null,
    sourceOrderNumber:
      typeof raw.sourceOrderNumber === "string" ? raw.sourceOrderNumber : null,
    ordOptNo: typeof raw.ordOptNo === "string" ? raw.ordOptNo : null,
    brandName: typeof raw.brandName === "string" ? raw.brandName : null,
    optionName: typeof raw.optionName === "string" ? raw.optionName : null
  };
}

function getInboundScanById(scanId: number) {
  ensureWarehouseSchema();

  const db = getDb();

  const row = db
    .prepare("SELECT * FROM inbound_scans WHERE id = ?")
    .get(scanId) as Record<string, unknown> | undefined;

  return row ? mapInboundScanRow(row) : null;
}

function listMatchedOrdersForScan(scanId: number) {
  ensureWarehouseSchema();

  const db = getDb();

  const rows = db
    .prepare(
      `
      SELECT
        o.*,
        s.name AS site_name,
        s.code AS site_code
      FROM inbound_scan_matches m
      JOIN orders o ON o.id = m.order_id
      JOIN sites s ON s.id = o.site_id
      WHERE m.scan_id = ?
      ORDER BY o.order_date DESC, o.id DESC
      `
    )
    .all(scanId) as Record<string, unknown>[];

  return rows.map(mapWarehouseOrderRow);
}

function findOrdersByTracking(normalizedTrackingNumber: string) {
  ensureWarehouseSchema();

  const db = getDb();
  const like = `%${normalizedTrackingNumber}%`;

  const rows = db
    .prepare(
      `
      SELECT
        o.*,
        s.name AS site_name,
        s.code AS site_code
      FROM orders o
      JOIN sites s ON s.id = o.site_id
      WHERE IFNULL(o.invoice_number, '') = ?
         OR IFNULL(o.raw_data, '') LIKE ?
      ORDER BY o.order_date DESC, o.id DESC
      `
    )
    .all(normalizedTrackingNumber, like) as Record<string, unknown>[];

  return rows.map(mapWarehouseOrderRow);
}

export function registerWarehouseIpc() {
  ipcMain.handle("warehouse:scanInbound", async (_event, rawInput) => {
    ensureWarehouseSchema();

    const input = ScanInboundSchema.parse(rawInput);
    const db = getDb();

    const normalized = normalizeTrackingNumber(input.trackingNumber);

    if (!normalized) {
      throw new Error("송장번호를 인식하지 못했습니다. 바코드 값을 다시 확인해 주세요.");
    }

    const now = nowIso();
    const existing = db
      .prepare(
        `
        SELECT *
        FROM inbound_scans
        WHERE normalized_tracking_number = ?
        `
      )
      .get(normalized) as Record<string, unknown> | undefined;

    if (existing) {
      db.prepare(
        `
        UPDATE inbound_scans
        SET scan_count = scan_count + 1,
            last_scanned_at = ?,
            raw_input = ?,
            carrier = COALESCE(?, carrier),
            note = COALESCE(?, note),
            updated_at = ?
        WHERE id = ?
        `
      ).run(
        now,
        input.trackingNumber,
        input.carrier ?? null,
        input.note ?? null,
        now,
        Number(existing.id)
      );

      const scan = getInboundScanById(Number(existing.id));

      return {
        result: "DUPLICATE",
        message: `이미 스캔된 송장입니다: ${maskTrackingNumber(normalized)}`,
        scan,
        matchedOrders: scan ? listMatchedOrdersForScan(scan.id) : []
      };
    }

    const insert = db
      .prepare(
        `
        INSERT INTO inbound_scans (
          tracking_number,
          normalized_tracking_number,
          carrier,
          raw_input,
          status,
          matched_order_count,
          scan_count,
          scanned_at,
          last_scanned_at,
          note,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, 'SCANNED', 0, 1, ?, ?, ?, ?, ?)
        `
      )
      .run(
        normalized,
        normalized,
        input.carrier ?? null,
        input.trackingNumber,
        now,
        now,
        input.note ?? null,
        now,
        now
      );

    const scan = getInboundScanById(Number(insert.lastInsertRowid));

    return {
      result: "SCANNED",
      message: `송장을 스캔 풀에 저장했습니다: ${maskTrackingNumber(normalized)}`,
      scan,
      matchedOrders: []
    };
  });

  ipcMain.handle("warehouse:listInboundScans", async (_event, rawInput) => {
    ensureWarehouseSchema();

    const input = ListInboundScansSchema.parse(rawInput ?? {});
    const db = getDb();

    const where: string[] = [];
    const params: unknown[] = [];

    if (input.status && input.status !== "ALL") {
      where.push("status = ?");
      params.push(input.status);
    }

    if (input.search) {
      where.push(
        "(tracking_number LIKE ? OR normalized_tracking_number LIKE ? OR IFNULL(carrier, '') LIKE ? OR IFNULL(note, '') LIKE ?)"
      );
      const keyword = `%${input.search.trim()}%`;
      params.push(keyword, keyword, keyword, keyword);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const offset = (input.page - 1) * input.pageSize;

    const totalRow = db
      .prepare(
        `
        SELECT COUNT(*) AS total
        FROM inbound_scans
        ${whereSql}
        `
      )
      .get(...params) as { total: number };

    const rows = db
      .prepare(
        `
        SELECT *
        FROM inbound_scans
        ${whereSql}
        ORDER BY scanned_at DESC, id DESC
        LIMIT ? OFFSET ?
        `
      )
      .all(...params, input.pageSize, offset) as Record<string, unknown>[];

    const summaryRows = db
      .prepare(
        `
        SELECT status, COUNT(*) AS count
        FROM inbound_scans
        GROUP BY status
        `
      )
      .all() as Array<{ status: string; count: number }>;

    const summary = summaryRows.reduce<Record<string, number>>((acc, row) => {
      acc[String(row.status)] = Number(row.count ?? 0);
      return acc;
    }, {});

    return {
      items: rows.map(mapInboundScanRow),
      total: Number(totalRow.total ?? 0),
      page: input.page,
      pageSize: input.pageSize,
      summary
    };
  });

  ipcMain.handle("warehouse:autoMatch", async (_event, rawInput) => {
    ensureWarehouseSchema();

    const input = AutoMatchSchema.parse(rawInput ?? {});
    const db = getDb();
    const now = nowIso();

    const scanRows = db
      .prepare(
        `
        SELECT *
        FROM inbound_scans
        ${
          input?.scanId
            ? "WHERE id = ?"
            : "WHERE status IN ('SCANNED', 'UNMATCHED')"
        }
        ORDER BY scanned_at ASC, id ASC
        `
      )
      .all(...(input?.scanId ? [input.scanId] : [])) as Record<string, unknown>[];

    let matchedScanCount = 0;
    let unmatchedScanCount = 0;
    let matchedOrderCount = 0;

    const tx = db.transaction((scans: Record<string, unknown>[]) => {
      for (const scanRow of scans) {
        const scanId = Number(scanRow.id);
        const normalized = String(scanRow.normalized_tracking_number);

        const matchedOrders = findOrdersByTracking(normalized);

        if (matchedOrders.length === 0) {
          db.prepare(
            `
            UPDATE inbound_scans
            SET status = 'UNMATCHED',
                matched_order_count = 0,
                matched_at = NULL,
                updated_at = ?
            WHERE id = ?
            `
          ).run(now, scanId);

          unmatchedScanCount += 1;
          continue;
        }

        for (const order of matchedOrders) {
          db.prepare(
            `
            INSERT OR IGNORE INTO inbound_scan_matches (
              scan_id,
              order_id,
              match_type,
              matched_at,
              created_at
            )
            VALUES (?, ?, 'AUTO', ?, ?)
            `
          ).run(scanId, order.id, now, now);
        }

        db.prepare(
          `
          UPDATE orders
          SET warehouse_status = 'ARRIVED',
              warehouse_arrived_at = COALESCE(warehouse_arrived_at, ?),
              warehouse_scan_id = COALESCE(warehouse_scan_id, ?),
              updated_at = ?
          WHERE id IN (${matchedOrders.map(() => "?").join(", ")})
          `
        ).run(now, scanId, now, ...matchedOrders.map((order) => order.id));

        db.prepare(
          `
          UPDATE inbound_scans
          SET status = 'MATCHED',
              matched_order_count = ?,
              matched_at = ?,
              updated_at = ?
          WHERE id = ?
          `
        ).run(matchedOrders.length, now, now, scanId);

        matchedScanCount += 1;
        matchedOrderCount += matchedOrders.length;
      }
    });

    tx(scanRows);

    return {
      scannedCount: scanRows.length,
      matchedScanCount,
      unmatchedScanCount,
      matchedOrderCount
    };
  });

  ipcMain.handle("warehouse:findOrdersByTracking", async (_event, rawInput) => {
    ensureWarehouseSchema();

    const input = ScanInboundSchema.parse(rawInput);
    const normalized = normalizeTrackingNumber(input.trackingNumber);

    return {
      trackingNumber: normalized,
      items: findOrdersByTracking(normalized)
    };
  });
}