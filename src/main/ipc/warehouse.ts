import { ipcMain } from "electron";
import { z } from "zod";
import { ensureOrdersRuntimeColumns, getDb } from "../db/client";
import { normalizeTrackingNumber } from "../utils/tracking";
import { pairAdminWithSupplier } from "../services/url-pairing";
import { pushTrackingsForItems } from "../services/admin-push";

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

const DeleteInboundScanSchema = z.object({
  scanId: z.number().int().positive()
});

function nowIso() {
  return new Date().toISOString();
}

function maskTrackingNumber(value: string) {
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
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
      row.tracking_number
        ? String(row.tracking_number)
        : typeof raw.trackingNumber === "string"
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
  const db = getDb();

  const row = db
    .prepare("SELECT * FROM inbound_scans WHERE id = ?")
    .get(scanId) as Record<string, unknown> | undefined;

  return row ? mapInboundScanRow(row) : null;
}

function listMatchedOrdersForScan(scanId: number) {
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

function findOrdersByTracking(normalized: string) {
  if (!normalized) return [];

  const db = getDb();
  ensureOrdersRuntimeColumns(db);

  const rows = db
    .prepare(
      `
      SELECT
        o.*,
        s.name AS site_name,
        s.code AS site_code
      FROM orders o
      JOIN sites s ON s.id = o.site_id
      WHERE o.normalized_tracking_number = ?
         OR (
              o.normalized_tracking_number IS NULL
              AND IFNULL(o.invoice_number, '') = ?
            )
      ORDER BY o.order_date DESC, o.id DESC
      `
    )
    .all(normalized, normalized) as Record<string, unknown>[];

  return rows.map(mapWarehouseOrderRow);
}

export function registerWarehouseIpc() {
  ipcMain.handle("warehouse:scanInbound", async (_event, rawInput) => {
    const input = ScanInboundSchema.parse(rawInput);
    const db = getDb();

    const normalized = normalizeTrackingNumber(input.trackingNumber);

    if (!normalized) {
      throw new Error(
        "송장번호를 인식하지 못했습니다. 바코드 값을 다시 확인해 주세요."
      );
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
    const input = AutoMatchSchema.parse(rawInput ?? {});
    const db = getDb();
    const now = nowIso();

    // Step 1 (URL 페어링): admin_order_items 중 송장이 비어있는 행에 대해
    // 같은 (siteCode, source_order_ref)의 supplier 주문에서 송장을 복사한다.
    const pairing = pairAdminWithSupplier(db);

    // Step 2 (Server Write-Back): 새로 송장이 채워진 항목들을 admin API로 push.
    // 토큰 없으면 noToken=true로 반환되어 UI에서 안내 가능.
    const push = await pushTrackingsForItems(db, pairing.pairedItemIds);

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
      .all(...(input?.scanId ? [input.scanId] : [])) as Record<
      string,
      unknown
    >[];

    let matchedScanCount = 0;
    let unmatchedScanCount = 0;
    let matchedOrderCount = 0;

    type MatchedScanDetail = {
      scan: ReturnType<typeof mapInboundScanRow>;
      matchedOrders: ReturnType<typeof mapWarehouseOrderRow>[];
    };

    const matchedScanDetails: MatchedScanDetail[] = [];
    const unmatchedScans: ReturnType<typeof mapInboundScanRow>[] = [];

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

          const refreshedRow = db
            .prepare("SELECT * FROM inbound_scans WHERE id = ?")
            .get(scanId) as Record<string, unknown> | undefined;

          if (refreshedRow) {
            unmatchedScans.push(mapInboundScanRow(refreshedRow));
          }

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

        const refreshedRow = db
          .prepare("SELECT * FROM inbound_scans WHERE id = ?")
          .get(scanId) as Record<string, unknown> | undefined;

        if (refreshedRow) {
          matchedScanDetails.push({
            scan: mapInboundScanRow(refreshedRow),
            matchedOrders
          });
        }

        matchedScanCount += 1;
        matchedOrderCount += matchedOrders.length;
      }
    });

    tx(scanRows);

    return {
      scannedCount: scanRows.length,
      matchedScanCount,
      unmatchedScanCount,
      matchedOrderCount,
      matchedScans: matchedScanDetails,
      unmatchedScans,
      pairing,
      adminPush: push
    };
  });

  ipcMain.handle("warehouse:findOrdersByTracking", async (_event, rawInput) => {
    const input = ScanInboundSchema.parse(rawInput);
    const normalized = normalizeTrackingNumber(input.trackingNumber);

    return {
      trackingNumber: normalized,
      items: findOrdersByTracking(normalized)
    };
  });

  // 잘못 스캔한 송장을 사용자 화면에서 제거. inbound_scans 행만 삭제하고
  // 연결된 inbound_scan_matches는 FK CASCADE로 자동 정리된다.
  // orders.warehouse_scan_id, warehouse_status는 그대로 둔다 (이미 확정된 정보).
  ipcMain.handle("warehouse:deleteInboundScan", async (_event, rawInput) => {
    const input = DeleteInboundScanSchema.parse(rawInput);
    const db = getDb();

    const result = db
      .prepare("DELETE FROM inbound_scans WHERE id = ?")
      .run(input.scanId);

    return { ok: true, deleted: result.changes };
  });

  // 통합 입고 페이지 좌측 데이터: 오늘(KST 자정 이후) 스캔된 모든 송장 +
  // 어제 이전 미매칭 누적분. 각 송장에 매칭된 admin_order_items 정보 join.
  ipcMain.handle("warehouse:listTodayAndPending", async () => {
    const db = getDb();

    const kstMidnightUtcIso = (() => {
      const now = new Date();
      const kstNow = new Date(now.getTime() + 9 * 3600 * 1000);
      const y = kstNow.getUTCFullYear();
      const m = kstNow.getUTCMonth();
      const d = kstNow.getUTCDate();
      return new Date(Date.UTC(y, m, d) - 9 * 3600 * 1000).toISOString();
    })();

    // 테이블 존재 확인 (admin 동기화 안 했을 때 안전)
    const hasAdminTable = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='admin_order_items' LIMIT 1"
      )
      .get();

    if (!hasAdminTable) {
      const scansOnly = db
        .prepare(
          `SELECT * FROM inbound_scans
           WHERE scanned_at >= ? OR status = 'UNMATCHED'
           ORDER BY scanned_at DESC, id DESC
           LIMIT 200`
        )
        .all(kstMidnightUtcIso) as Record<string, unknown>[];

      return {
        entries: scansOnly.map((row) => ({
          scan: mapInboundScanRow(row),
          matchedItems: [] as Array<Record<string, unknown>>,
          isToday: String(row.scanned_at) >= kstMidnightUtcIso,
        })),
      };
    }

    // 송장 + 매칭된 admin_order_items 평탄화 (LEFT JOIN)
    const rows = db
      .prepare(
        `SELECT
           s.id AS scan_id,
           s.tracking_number, s.normalized_tracking_number, s.carrier, s.raw_input,
           s.status AS scan_status, s.matched_order_count, s.scan_count,
           s.scanned_at, s.last_scanned_at, s.matched_at AS scan_matched_at,
           s.note, s.created_at AS scan_created_at, s.updated_at AS scan_updated_at,
           aoi.order_item_id, aoi.vy_code, aoi.product_name, aoi.item_status,
           aoi.warehouse_status AS aoi_warehouse_status,
           aoi.warehouse_matched_at, aoi.domestic_tracking_number, aoi.domestic_carrier,
           ao.order_number, ao.customer_name, ao.order_status
         FROM inbound_scans s
         LEFT JOIN admin_order_items aoi
           ON aoi.domestic_tracking_number = s.normalized_tracking_number
           OR aoi.domestic_tracking_number = s.tracking_number
         LEFT JOIN admin_orders ao ON ao.id = aoi.admin_order_id
         WHERE s.scanned_at >= ? OR s.status = 'UNMATCHED'
         ORDER BY s.scanned_at DESC, s.id DESC`
      )
      .all(kstMidnightUtcIso) as Record<string, unknown>[];

    type Entry = {
      scan: ReturnType<typeof mapInboundScanRow>;
      matchedItems: Array<{
        orderItemId: number;
        vyCode: string;
        productName: string;
        itemStatus: string;
        warehouseStatus: string;
        warehouseMatchedAt: string | null;
        domesticTrackingNumber: string | null;
        domesticCarrier: string | null;
        orderNumber: string;
        customerName: string | null;
        orderStatus: string;
      }>;
      isToday: boolean;
    };

    const groups = new Map<number, Entry>();
    for (const row of rows) {
      const scanId = Number(row.scan_id);
      let entry = groups.get(scanId);
      if (!entry) {
        // mapInboundScanRow가 기대하는 키 형태로 정규화
        const scanRow: Record<string, unknown> = {
          id: row.scan_id,
          tracking_number: row.tracking_number,
          normalized_tracking_number: row.normalized_tracking_number,
          carrier: row.carrier,
          raw_input: row.raw_input,
          status: row.scan_status,
          matched_order_count: row.matched_order_count,
          scan_count: row.scan_count,
          scanned_at: row.scanned_at,
          last_scanned_at: row.last_scanned_at,
          matched_at: row.scan_matched_at,
          note: row.note,
          created_at: row.scan_created_at,
          updated_at: row.scan_updated_at,
        };
        entry = {
          scan: mapInboundScanRow(scanRow),
          matchedItems: [],
          isToday: String(row.scanned_at) >= kstMidnightUtcIso,
        };
        groups.set(scanId, entry);
      }

      if (row.order_item_id != null) {
        entry.matchedItems.push({
          orderItemId: Number(row.order_item_id),
          vyCode: row.vy_code ? String(row.vy_code) : "",
          productName: row.product_name ? String(row.product_name) : "",
          itemStatus: row.item_status ? String(row.item_status) : "",
          warehouseStatus: row.aoi_warehouse_status
            ? String(row.aoi_warehouse_status)
            : "PENDING",
          warehouseMatchedAt: row.warehouse_matched_at
            ? String(row.warehouse_matched_at)
            : null,
          domesticTrackingNumber: row.domestic_tracking_number
            ? String(row.domestic_tracking_number)
            : null,
          domesticCarrier: row.domestic_carrier ? String(row.domestic_carrier) : null,
          orderNumber: row.order_number ? String(row.order_number) : "",
          customerName: row.customer_name ? String(row.customer_name) : null,
          orderStatus: row.order_status ? String(row.order_status) : "",
        });
      }
    }

    // 정책: "오늘 매칭 완료된 건만" + "오늘 미매칭" + "이전 미매칭 누적"
    // → 어제 이전 매칭 완료된 송장(잘 들어가 있던 것)은 제외
    const entries = Array.from(groups.values()).filter((e) => {
      if (e.isToday) return true;
      // 어제 이전이면 미매칭일 때만 포함
      return e.scan.status === "UNMATCHED";
    });

    return { entries: entries.slice(0, 300) };
  });
}
