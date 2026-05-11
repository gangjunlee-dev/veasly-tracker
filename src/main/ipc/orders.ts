import { ipcMain } from "electron";
import { z } from "zod";
import { getDb } from "../db/client";

const PaginationSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(500).default(50)
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

export function registerOrdersIpc() {
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
}
