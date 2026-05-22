import { ipcMain } from "electron";
import { z } from "zod";
import crypto from "node:crypto";
import { ensureOrdersRuntimeColumns, getDb } from "../db/client";
import { normalizeTrackingNumber } from "../utils/tracking";
import { normalizeShippingStatus } from "../utils/shipping-status";

const PaginationSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(2000).default(50)
});

const DateFilterSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional()
});

const ListBySiteSchema = PaginationSchema.merge(DateFilterSchema).extend({
  siteId: z.number().int().positive(),
  search: z.string().optional()
});

const ListAllSchema = PaginationSchema.merge(DateFilterSchema).extend({
  siteIds: z.array(z.number().int().positive()).optional(),
  search: z.string().optional()
});

const ExportSchema = DateFilterSchema.extend({
  siteIds: z.array(z.number().int().positive()).optional(),
  siteId: z.number().int().positive().optional(),
  search: z.string().optional()
});

const ListUnshippedSchema = PaginationSchema.merge(DateFilterSchema).extend({
  siteIds: z.array(z.number().int().positive()).optional(),
  status: z.string().optional(),
  seller: z.string().optional(),
  search: z.string().optional(),
  minDaysSincePurchase: z.number().int().nonnegative().optional(),
  delayThresholdDays: z.number().int().positive().optional()
});


const OliveYoungSnapshotItemSchema = z.object({
  orderNumber: z.string().min(1),
  orderDate: z.string().min(1),
  productName: z.string().min(1),
  quantity: z.number().int().positive().default(1),
  amount: z.number().int().nonnegative().default(0),
  currency: z.string().optional().default("KRW"),
  invoiceNumber: z.string().nullable().optional(),
  invoiceUrl: z.string().nullable().optional(),
  shippingStatus: z.string().nullable().optional(),
  carrier: z.string().nullable().optional(),
  carrierCode: z.string().nullable().optional(),
  trackingNumber: z.string().nullable().optional(),
  expectedDeliveryDate: z.string().nullable().optional(),
  tradeShipCode: z.string().nullable().optional(),
  orderGoodsSeq: z.string().nullable().optional(),
  goodsNo: z.string().nullable().optional(),
  goodsName: z.string().nullable().optional(),
  rawText: z.string().optional(),
  sourceRowIndex: z.number().optional()
});

const OliveYoungSnapshotSchema = z.object({
  url: z.string().optional(),
  title: z.string().optional(),
  capturedAt: z.string().optional(),
  totalItems: z.number().optional(),
  orderNumbers: z.array(z.string()).optional(),
  items: z.array(OliveYoungSnapshotItemSchema)
});

const ImportOliveYoungSnapshotSchema = z.object({
  siteId: z.number().int().positive(),
  snapshot: OliveYoungSnapshotSchema
});

function mapOrderRow(row: Record<string, unknown>) {
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
    warehouseStatus: row.warehouse_status ? String(row.warehouse_status) : "NOT_ARRIVED",
    warehouseArrivedAt: row.warehouse_arrived_at ? String(row.warehouse_arrived_at) : null,
    warehouseScanId: row.warehouse_scan_id ? Number(row.warehouse_scan_id) : null,
    purchaseSiteOrderId: row.purchase_site_order_id ? String(row.purchase_site_order_id) : null,
    sellerName: row.seller_name ? String(row.seller_name) : null,
    productOption: row.product_option ? String(row.product_option) : null,
    sku: row.sku ? String(row.sku) : null,
    recipientName: row.recipient_name ? String(row.recipient_name) : null,
    recipientPhone: row.recipient_phone ? String(row.recipient_phone) : null,
    carrier: row.carrier ? String(row.carrier) : null,
    carrierCode: row.carrier_code ? String(row.carrier_code) : null,
    shippingStatusNormalized: row.shipping_status_normalized
      ? String(row.shipping_status_normalized)
      : null,
    shippedAt: row.shipped_at ? String(row.shipped_at) : null,
    expectedShipDate: row.expected_ship_date ? String(row.expected_ship_date) : null,
    lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null,
    rawData: row.raw_data ? String(row.raw_data) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function appendCommonFilters(
  where: string[],
  params: unknown[],
  input: {
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  }
) {
  if (input.dateFrom) {
    where.push("o.order_date >= ?");
    params.push(input.dateFrom);
  }

  if (input.dateTo) {
    where.push("o.order_date <= ?");
    params.push(input.dateTo);
  }

  if (input.search) {
    where.push(
      "(o.order_number LIKE ? OR o.product_name LIKE ? OR IFNULL(o.invoice_number, '') LIKE ?)"
    );
    const keyword = `%${input.search}%`;
    params.push(keyword, keyword, keyword);
  }
}

function buildWhereClause(where: string[]) {
  return where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);

  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function toCsv(rows: ReturnType<typeof mapOrderRow>[]): string {
  const headers = [
    "siteId",
    "siteName",
    "siteCode",
    "orderDate",
    "orderNumber",
    "productName",
    "quantity",
    "amount",
    "currency",
    "invoiceNumber",
    "invoiceUrl",
    "shippingStatus"
  ];

  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.siteId,
        row.siteName ?? "",
        row.siteCode ?? "",
        row.orderDate,
        row.orderNumber,
        row.productName,
        row.quantity,
        row.amount,
        row.currency,
        row.invoiceNumber ?? "",
        row.invoiceUrl ?? "",
        row.shippingStatus ?? ""
      ]
        .map(csvEscape)
        .join(",")
    )
  ];

  return lines.join("\n");
}


function stableShortHash(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 8);
}

function normalizeOliveYoungDate(value: string): string {
  const text = String(value || "").trim();

  const isoMatch = text.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return [
      isoMatch[1],
      isoMatch[2].padStart(2, "0"),
      isoMatch[3].padStart(2, "0")
    ].join("-");
  }

  const koreanMatch = text.match(/(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (koreanMatch) {
    return [
      koreanMatch[1],
      koreanMatch[2].padStart(2, "0"),
      koreanMatch[3].padStart(2, "0")
    ].join("-");
  }

  return text;
}

function makeOliveYoungLineOrderNumber(input: {
  sourceOrderNumber: string;
  sourceRowIndex?: number;
  index: number;
  productName: string;
  quantity: number;
  amount: number;
}): string {
  const rowPart =
    typeof input.sourceRowIndex === "number"
      ? String(input.sourceRowIndex).padStart(3, "0")
      : String(input.index + 1).padStart(3, "0");

  const hash = stableShortHash(
    [
      input.sourceOrderNumber,
      input.productName,
      input.quantity,
      input.amount,
      rowPart
    ].join("|")
  );

  return `${input.sourceOrderNumber}#${rowPart}-${hash}`;
}

function importOliveYoungSnapshotToOrders(input: z.infer<typeof ImportOliveYoungSnapshotSchema>) {
  const db = getDb();

  // Belt-and-suspenders: ensure tracking columns exist even if startup
  // migration was skipped on this machine.
  ensureOrdersRuntimeColumns(db);

  const site = db
    .prepare("SELECT id, code, enabled FROM sites WHERE id = ?")
    .get(input.siteId) as { id: number; code: string; enabled: number } | undefined;

  if (!site) {
    throw new Error(`사이트를 찾을 수 없습니다 (id=${input.siteId}).`);
  }

  if (!site.enabled) {
    throw new Error(`비활성화된 사이트입니다 (id=${input.siteId}).`);
  }

  if (site.code !== "oliveyoung") {
    throw new Error(
      `이 가져오기는 올리브영 사이트에서만 가능합니다 (현재 code=${site.code}).`
    );
  }

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
      purchase_site_order_id,
      seller_name,
      product_option,
      sku,
      recipient_name,
      recipient_phone,
      carrier,
      carrier_code,
      shipping_status_normalized,
      shipped_at,
      expected_ship_date,
      last_synced_at,
      raw_data
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      purchase_site_order_id = excluded.purchase_site_order_id,
      seller_name = excluded.seller_name,
      product_option = excluded.product_option,
      sku = excluded.sku,
      recipient_name = excluded.recipient_name,
      recipient_phone = excluded.recipient_phone,
      carrier = excluded.carrier,
      carrier_code = excluded.carrier_code,
      shipping_status_normalized = excluded.shipping_status_normalized,
      shipped_at = excluded.shipped_at,
      expected_ship_date = excluded.expected_ship_date,
      last_synced_at = excluded.last_synced_at,
      raw_data = excluded.raw_data,
      updated_at = datetime('now')
    `
  );

  const insertLog = db.prepare(
    `
    INSERT INTO extraction_logs (
      site_id,
      status,
      started_at,
      finished_at,
      message,
      total_orders,
      new_orders,
      updated_orders
    )
    VALUES (?, 'success', datetime('now'), datetime('now'), ?, ?, ?, ?)
    `
  );

  const touchSite = db.prepare(
    `
    UPDATE sites
    SET last_extracted_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
    `
  );

  let newOrders = 0;
  let updatedOrders = 0;
  const syncedAt = new Date().toISOString();

  const tx = db.transaction(() => {
    input.snapshot.items.forEach((item, index) => {
      const sourceOrderNumber = item.orderNumber.trim();

      const orderNumber = makeOliveYoungLineOrderNumber({
        sourceOrderNumber,
        sourceRowIndex: item.sourceRowIndex,
        index,
        productName: item.productName,
        quantity: item.quantity,
        amount: item.amount
      });

      const rawData = JSON.stringify({
        source: "oliveyoung_manual_snapshot",
        sourceOrderNumber,
        carrier: item.carrier ?? null,
        carrierCode: item.carrierCode ?? null,
        trackingNumber: item.trackingNumber ?? item.invoiceNumber ?? null,
        expectedDeliveryDate: item.expectedDeliveryDate ?? null,
        tradeShipCode: item.tradeShipCode ?? null,
        orderGoodsSeq: item.orderGoodsSeq ?? null,
        goodsNo: item.goodsNo ?? null,
        goodsName: item.goodsName ?? null,
        snapshotUrl: input.snapshot.url ?? null,
        snapshotTitle: input.snapshot.title ?? null,
        capturedAt: input.snapshot.capturedAt ?? null,
        item
      });

      const existing = checkExisting.get(input.siteId, orderNumber);

      const trackingNumber = item.trackingNumber ?? item.invoiceNumber ?? null;
      const normalizedTracking = trackingNumber
        ? normalizeTrackingNumber(trackingNumber) || null
        : null;

      const shippingStatusNormalized = normalizeShippingStatus(
        item.shippingStatus ?? null,
        { hasTracking: Boolean(trackingNumber) }
      );

      upsert.run(
        input.siteId,
        orderNumber,
        normalizeOliveYoungDate(item.orderDate),
        item.productName.trim(),
        item.quantity,
        item.amount,
        item.currency ?? "KRW",
        item.invoiceNumber ?? null,
        item.invoiceUrl ?? null,
        item.shippingStatus ?? null,
        trackingNumber,
        normalizedTracking,
        // 구매사이트 모니터링 필드 — 스냅샷에 실제로 있는 값만 채운다(없으면 null).
        sourceOrderNumber,
        null, // seller_name: 올리브영 스냅샷 미제공
        null, // product_option: 올리브영 스냅샷 미제공
        item.goodsNo ?? null,
        null, // recipient_name: 올리브영 스냅샷 미제공
        null, // recipient_phone: 올리브영 스냅샷 미제공
        item.carrier ?? null,
        item.carrierCode ?? null,
        shippingStatusNormalized,
        null, // shipped_at: 올리브영 스냅샷 미제공
        null, // expected_ship_date: expectedDeliveryDate는 '도착 예정'이라 의미가 달라 매핑 안 함
        syncedAt,
        rawData
      );

      if (existing) {
        updatedOrders += 1;
      } else {
        newOrders += 1;
      }
    });

    touchSite.run(input.siteId);

    insertLog.run(
      input.siteId,
      "OliveYoung manual snapshot import completed",
      input.snapshot.items.length,
      newOrders,
      updatedOrders
    );
  });

  tx();

  return {
    siteId: input.siteId,
    totalItems: input.snapshot.items.length,
    newOrders,
    updatedOrders,
    savedOrders: input.snapshot.items.length,
    sourceOrderNumbers: Array.from(
      new Set(input.snapshot.items.map((item) => item.orderNumber))
    )
  };
}

export function registerOrdersIpc() {

  ipcMain.handle("orders:importOliveYoungSnapshot", async (_event, rawInput) => {
    const input = ImportOliveYoungSnapshotSchema.parse(rawInput);
    return importOliveYoungSnapshotToOrders(input);
  });


  ipcMain.handle("orders:listBySite", async (_event, rawInput) => {
    const input = ListBySiteSchema.parse(rawInput);
    const db = getDb();

    const where = ["o.site_id = ?"];
    const params: unknown[] = [input.siteId];

    appendCommonFilters(where, params, input);

    const whereSql = buildWhereClause(where);
    const offset = (input.page - 1) * input.pageSize;

    const totalRow = db
      .prepare(
        `
        SELECT COUNT(*) AS total
        FROM orders o
        ${whereSql}
        `
      )
      .get(...params) as { total: number };

    const rows = db
      .prepare(
        `
        SELECT
          o.*,
          s.name AS site_name,
          s.code AS site_code
        FROM orders o
        JOIN sites s ON s.id = o.site_id
        ${whereSql}
        ORDER BY o.order_date DESC, o.id DESC
        LIMIT ? OFFSET ?
        `
      )
      .all(...params, input.pageSize, offset) as Record<string, unknown>[];

    return {
      items: rows.map(mapOrderRow),
      total: Number(totalRow.total),
      page: input.page,
      pageSize: input.pageSize
    };
  });

  ipcMain.handle("orders:listAll", async (_event, rawInput) => {
    const input = ListAllSchema.parse(rawInput);
    const db = getDb();

    const where: string[] = [];
    const params: unknown[] = [];

    if (input.siteIds && input.siteIds.length > 0) {
      where.push(`o.site_id IN (${input.siteIds.map(() => "?").join(", ")})`);
      params.push(...input.siteIds);
    }

    appendCommonFilters(where, params, input);

    const whereSql = buildWhereClause(where);
    const offset = (input.page - 1) * input.pageSize;

    const totalRow = db
      .prepare(
        `
        SELECT COUNT(*) AS total
        FROM orders o
        ${whereSql}
        `
      )
      .get(...params) as { total: number };

    const rows = db
      .prepare(
        `
        SELECT
          o.*,
          s.name AS site_name,
          s.code AS site_code
        FROM orders o
        JOIN sites s ON s.id = o.site_id
        ${whereSql}
        ORDER BY o.order_date DESC, o.id DESC
        LIMIT ? OFFSET ?
        `
      )
      .all(...params, input.pageSize, offset) as Record<string, unknown>[];

    return {
      items: rows.map(mapOrderRow),
      total: Number(totalRow.total),
      page: input.page,
      pageSize: input.pageSize
    };
  });

  ipcMain.handle("orders:export", async (_event, rawInput) => {
    const input = ExportSchema.parse(rawInput);
    const db = getDb();

    const where: string[] = [];
    const params: unknown[] = [];

    if (input.siteId) {
      where.push("o.site_id = ?");
      params.push(input.siteId);
    }

    if (input.siteIds && input.siteIds.length > 0) {
      where.push(`o.site_id IN (${input.siteIds.map(() => "?").join(", ")})`);
      params.push(...input.siteIds);
    }

    appendCommonFilters(where, params, input);

    const whereSql = buildWhereClause(where);

    const rows = db
      .prepare(
        `
        SELECT
          o.*,
          s.name AS site_name,
          s.code AS site_code
        FROM orders o
        JOIN sites s ON s.id = o.site_id
        ${whereSql}
        ORDER BY o.order_date DESC, o.id DESC
        `
      )
      .all(...params) as Record<string, unknown>[];

    return toCsv(rows.map(mapOrderRow));
  });

  // 미발송(구매했지만 아직 발송 전) 주문 목록 + 지연 요약.
  // "미발송" 정의: 송장번호·택배사 정보가 모두 없고, 정규 배송상태가
  // 발송 전 단계(purchased/awaiting_shipment/preparing_shipment/unknown).
  ipcMain.handle("orders:listUnshipped", async (_event, rawInput) => {
    const input = ListUnshippedSchema.parse(rawInput ?? {});
    const db = getDb();
    ensureOrdersRuntimeColumns(db);

    const where: string[] = [
      "(o.tracking_number IS NULL OR o.tracking_number = '')",
      "(o.carrier IS NULL OR o.carrier = '')",
      "IFNULL(o.shipping_status_normalized, 'unknown') IN ('purchased', 'awaiting_shipment', 'preparing_shipment', 'unknown')"
    ];
    const params: unknown[] = [];

    if (input.siteIds && input.siteIds.length > 0) {
      where.push(`o.site_id IN (${input.siteIds.map(() => "?").join(", ")})`);
      params.push(...input.siteIds);
    }

    if (input.dateFrom) {
      where.push("o.order_date >= ?");
      params.push(input.dateFrom);
    }

    if (input.dateTo) {
      where.push("o.order_date <= ?");
      params.push(input.dateTo);
    }

    if (input.status) {
      where.push("IFNULL(o.shipping_status_normalized, 'unknown') = ?");
      params.push(input.status);
    }

    if (input.seller) {
      where.push("IFNULL(o.seller_name, '') LIKE ?");
      params.push(`%${input.seller.trim()}%`);
    }

    if (input.search) {
      where.push("o.product_name LIKE ?");
      params.push(`%${input.search.trim()}%`);
    }

    if (typeof input.minDaysSincePurchase === "number") {
      where.push("substr(o.order_date, 1, 10) <= date('now', ?)");
      params.push(`-${input.minDaysSincePurchase} days`);
    }

    const whereSql = `WHERE ${where.join(" AND ")}`;
    const offset = (input.page - 1) * input.pageSize;

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS total FROM orders o ${whereSql}`)
      .get(...params) as { total: number };

    const delayThresholdDays = input.delayThresholdDays ?? 3;
    const delayedRow = db
      .prepare(
        `
        SELECT COUNT(*) AS delayed
        FROM orders o
        ${whereSql}
        AND substr(o.order_date, 1, 10) <= date('now', ?)
        `
      )
      .get(...params, `-${delayThresholdDays} days`) as { delayed: number };

    const rows = db
      .prepare(
        `
        SELECT
          o.*,
          s.name AS site_name,
          s.code AS site_code
        FROM orders o
        JOIN sites s ON s.id = o.site_id
        ${whereSql}
        ORDER BY o.order_date ASC, o.id ASC
        LIMIT ? OFFSET ?
        `
      )
      .all(...params, input.pageSize, offset) as Record<string, unknown>[];

    return {
      items: rows.map(mapOrderRow),
      total: Number(totalRow.total),
      page: input.page,
      pageSize: input.pageSize,
      summary: {
        total: Number(totalRow.total),
        delayed: Number(delayedRow.delayed),
        delayThresholdDays
      }
    };
  });
}
