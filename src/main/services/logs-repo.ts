import { getDb } from "../db/client";

export type ExtractionLogRow = {
  id: number;
  siteId: number;
  siteName?: string;
  siteCode?: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  message: string | null;
  totalOrders: number;
  newOrders: number;
  updatedOrders: number;
  savedOrders: number;
  errorStack: string | null;
  createdAt: string;
};

function mapExtractionLogRow(row: Record<string, unknown>): ExtractionLogRow {
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

export function listExtractionLogs(input: {
  page: number;
  pageSize: number;
  siteId?: number;
}): {
  items: ExtractionLogRow[];
  total: number;
  page: number;
  pageSize: number;
} {
  const db = getDb();
  const offset = (input.page - 1) * input.pageSize;

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
      SELECT COUNT(*) AS total
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
        s.name AS site_name,
        s.code AS site_code,
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
    .all(...params, input.pageSize, offset) as Record<string, unknown>[];

  return {
    items: rows.map(mapExtractionLogRow),
    total: Number(totalRow.total ?? 0),
    page: input.page,
    pageSize: input.pageSize
  };
}

export function createExtractionLog(siteId: number): number {
  const result = getDb()
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

export type FinishExtractionLogParams = {
  logId: number;
  status: "success" | "failed" | "cancelled";
  message?: string;
  totalOrders?: number;
  newOrders?: number;
  updatedOrders?: number;
  errorStack?: string;
};

export function finishExtractionLog(params: FinishExtractionLogParams): void {
  getDb()
    .prepare(
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
    )
    .run(
      params.status,
      params.message ?? null,
      params.totalOrders ?? 0,
      params.newOrders ?? 0,
      params.updatedOrders ?? 0,
      params.errorStack ?? null,
      params.logId
    );
}

export function cleanupStaleRunningLogs(staleMinutes = 30): number {
  const result = getDb()
    .prepare(
      `
      UPDATE extraction_logs
      SET
        status = 'failed',
        finished_at = datetime('now'),
        message = 'Extraction interrupted before completion'
      WHERE status = 'running'
        AND finished_at IS NULL
        AND started_at < datetime('now', ?)
      `
    )
    .run(`-${staleMinutes} minutes`);

  return Number(result.changes ?? 0);
}
