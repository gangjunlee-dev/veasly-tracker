import { ipcMain } from "electron";
import { z } from "zod";
import { getDb } from "../db/client";

const PaginationSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(200).default(50)
});

const ListBySiteSchema = PaginationSchema.extend({
  siteId: z.number().int().positive()
});

function mapExtractionLogRow(row: Record<string, unknown>) {
  const newOrders = Number(row.new_orders ?? 0);
  const updatedOrders = Number(row.updated_orders ?? 0);

  return {
    id: Number(row.id),
    siteId: Number(row.site_id),
    siteName: row.site_name ? String(row.site_name) : undefined,
    siteCode: row.site_code ? String(row.site_code) : undefined,
    status: String(row.status),
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    message: row.message ? String(row.message) : null,
    totalOrders: Number(row.total_orders ?? 0),
    newOrders,
    updatedOrders,
    savedOrders: newOrders + updatedOrders,
    errorStack: row.error_stack ? String(row.error_stack) : null,
    createdAt: String(row.created_at)
  };
}

function listLogs(input: {
  page: number;
  pageSize: number;
  siteId?: number;
}) {
  const db = getDb();
  const page = input.page;
  const pageSize = input.pageSize;
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  const params: unknown[] = [];

  if (input.siteId) {
    where.push("l.site_id = ?");
    params.push(input.siteId);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const totalRow = db
    .prepare(
      `
      SELECT COUNT(*) as total
      FROM extraction_logs l
      ${whereSql}
      `
    )
    .get(...params) as { total: number };

  const rows = db
    .prepare(
      `
      SELECT
        l.id,
        l.site_id,
        s.name as site_name,
        s.code as site_code,
        l.status,
        l.started_at,
        l.finished_at,
        l.message,
        l.total_orders,
        l.new_orders,
        l.updated_orders,
        l.error_stack,
        l.created_at
      FROM extraction_logs l
      LEFT JOIN sites s ON s.id = l.site_id
      ${whereSql}
      ORDER BY l.started_at DESC, l.id DESC
      LIMIT ? OFFSET ?
      `
    )
    .all(...params, pageSize, offset) as Record<string, unknown>[];

  return {
    items: rows.map(mapExtractionLogRow),
    total: Number(totalRow.total ?? 0),
    page,
    pageSize
  };
}

export function registerLogsIpc() {
  ipcMain.handle("logs:list", async (_event, rawInput) => {
    const input = PaginationSchema.parse(rawInput ?? {});
    return listLogs(input);
  });

  ipcMain.handle("logs:listBySite", async (_event, rawInput) => {
    const input = ListBySiteSchema.parse(rawInput);
    return listLogs(input);
  });
}