import { app } from "electron";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { normalizeTrackingNumber } from "../utils/tracking";
import schemaSql from "./schema.sql?raw";

const migrationFiles = import.meta.glob<string>("./migrations/*.sql", {
  eager: true,
  query: "?raw",
  import: "default"
});

let db: Database.Database | null = null;

function applySchema(database: Database.Database) {
  database.pragma("foreign_keys = ON");
  database.exec(schemaSql);
}

function applyMigrations(database: Database.Database) {
  const entries = Object.entries(migrationFiles)
    .map(([modulePath, sql]) => ({
      name: path.basename(modulePath),
      sql
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (entries.length === 0) return;

  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const hasMigration = database.prepare(
    "SELECT 1 FROM _migrations WHERE name = ?"
  );
  const insertMigration = database.prepare(
    "INSERT INTO _migrations (name) VALUES (?)"
  );

  const runMigration = database.transaction(
    (entry: { name: string; sql: string }) => {
      if (hasMigration.get(entry.name)) return;
      database.exec(entry.sql);
      insertMigration.run(entry.name);
    }
  );

  for (const entry of entries) {
    runMigration(entry);
  }
}

function backfillNormalizedTrackingNumbers(database: Database.Database) {
  const rows = database
    .prepare(
      `
      SELECT id, tracking_number
      FROM orders
      WHERE tracking_number IS NOT NULL
        AND tracking_number != ''
        AND (normalized_tracking_number IS NULL OR normalized_tracking_number = '')
      `
    )
    .all() as Array<{ id: number; tracking_number: string }>;

  if (rows.length === 0) return;

  const update = database.prepare(
    "UPDATE orders SET normalized_tracking_number = ? WHERE id = ?"
  );

  const tx = database.transaction(
    (items: Array<{ id: number; tracking_number: string }>) => {
      for (const row of items) {
        const normalized = normalizeTrackingNumber(row.tracking_number);
        if (normalized) update.run(normalized, row.id);
      }
    }
  );

  tx(rows);
}

/**
 * ALTER TABLE ADD COLUMN, but treat "duplicate column" as a no-op.
 * SQLite does not have IF NOT EXISTS for column adds, so we lean on
 * the error message rather than PRAGMA reads (which can be stale across
 * weird WAL states).
 */
export function ensureOrdersColumn(
  database: Database.Database,
  columnName: string,
  definition: string
): boolean {
  try {
    database.exec(
      `ALTER TABLE orders ADD COLUMN ${columnName} ${definition}`
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("duplicate column name") ||
      message.includes("already exists")
    ) {
      return false;
    }
    throw error;
  }
}

function migrateLegacySchema(database: Database.Database) {
  ensureOrdersColumn(
    database,
    "warehouse_status",
    "TEXT NOT NULL DEFAULT 'NOT_ARRIVED'"
  );
  ensureOrdersColumn(database, "warehouse_arrived_at", "TEXT");
  ensureOrdersColumn(database, "warehouse_scan_id", "INTEGER");

  const trackingAdded = ensureOrdersColumn(database, "tracking_number", "TEXT");

  if (trackingAdded) {
    database.exec(`
      UPDATE orders
      SET tracking_number = COALESCE(
        NULLIF(json_extract(raw_data, '$.trackingNumber'), ''),
        NULLIF(invoice_number, '')
      )
      WHERE tracking_number IS NULL OR tracking_number = ''
    `);
  }

  const normalizedAdded = ensureOrdersColumn(
    database,
    "normalized_tracking_number",
    "TEXT"
  );

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_warehouse_status
      ON orders(warehouse_status);
    CREATE INDEX IF NOT EXISTS idx_orders_tracking_normalized
      ON orders(normalized_tracking_number);
    CREATE INDEX IF NOT EXISTS idx_orders_invoice_number
      ON orders(invoice_number);
  `);

  if (trackingAdded || normalizedAdded) {
    backfillNormalizedTrackingNumbers(database);
  }
}

export function getDbPath(): string {
  const userDataPath = app.getPath("userData");
  return path.join(userDataPath, "veasly.db");
}

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  try {
    applySchema(db);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[db] applySchema failed", error);
  }
  try {
    applyMigrations(db);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[db] applyMigrations failed", error);
  }
  migrateLegacySchema(db);
  ensureAdminTables(db);

  return db;
}

/**
 * Defensive last-resort: callable from hot paths (upserts) to make sure
 * the orders schema actually has every column the runtime expects, even
 * if some earlier migration step was silently skipped on this machine.
 */
/**
 * admin 테이블이 올바른 스키마로 존재하는지 보장합니다.
 * 잘못된 스키마로 생성된 테이블은 DROP 후 재생성합니다.
 */
function ensureAdminTables(database: Database.Database) {
  // kv 테이블
  database.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // admin_orders — order_number 컬럼이 있는지 확인
  const aoExists = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='admin_orders' LIMIT 1"
  ).get();

  if (aoExists) {
    const cols = database.prepare("PRAGMA table_info(admin_orders)").all() as Array<{ name: string }>;
    const colNames = new Set(cols.map(c => c.name));
    if (!colNames.has("order_number")) {
      // 잘못된 스키마 — DROP 후 재생성
      database.exec("DROP TABLE IF EXISTS admin_order_items");
      database.exec("DROP TABLE IF EXISTS admin_orders");
    }
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS admin_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      order_status TEXT NOT NULL,
      customer_name TEXT,
      customer_phone TEXT,
      customer_address TEXT,
      total_amount INTEGER,
      currency TEXT DEFAULT 'TWD',
      item_count INTEGER DEFAULT 0,
      synced_at TEXT NOT NULL,
      raw_data TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_admin_orders_status ON admin_orders(order_status);
    CREATE INDEX IF NOT EXISTS idx_admin_orders_synced ON admin_orders(synced_at);

    CREATE TABLE IF NOT EXISTS admin_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_order_id INTEGER NOT NULL REFERENCES admin_orders(id) ON DELETE CASCADE,
      order_item_id INTEGER NOT NULL,
      vy_code TEXT NOT NULL DEFAULT '',
      product_name TEXT,
      product_id INTEGER,
      item_status TEXT NOT NULL DEFAULT '',
      domestic_tracking_number TEXT,
      domestic_carrier TEXT,
      intl_tracking_number TEXT,
      intl_carrier TEXT,
      warehouse_status TEXT DEFAULT 'PENDING',
      warehouse_matched_at TEXT,
      warehouse_scan_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(admin_order_id, order_item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_aoi_vy_code ON admin_order_items(vy_code);
    CREATE INDEX IF NOT EXISTS idx_aoi_item_status ON admin_order_items(item_status);
    CREATE INDEX IF NOT EXISTS idx_aoi_domestic_tracking ON admin_order_items(domestic_tracking_number);
    CREATE INDEX IF NOT EXISTS idx_aoi_warehouse_status ON admin_order_items(warehouse_status);
    CREATE INDEX IF NOT EXISTS idx_aoi_order_id ON admin_order_items(admin_order_id);

    CREATE TABLE IF NOT EXISTS match_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      tracking_number TEXT,
      order_item_id INTEGER,
      vy_code TEXT,
      order_number TEXT,
      product_name TEXT,
      admin_synced INTEGER DEFAULT 0,
      admin_error TEXT,
      retry_count INTEGER DEFAULT 0,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_event ON match_audit_log(event_type);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON match_audit_log(created_at);
  `);
}

export function ensureOrdersRuntimeColumns(database: Database.Database) {
  ensureOrdersColumn(
    database,
    "warehouse_status",
    "TEXT NOT NULL DEFAULT 'NOT_ARRIVED'"
  );
  ensureOrdersColumn(database, "warehouse_arrived_at", "TEXT");
  ensureOrdersColumn(database, "warehouse_scan_id", "INTEGER");
  ensureOrdersColumn(database, "tracking_number", "TEXT");
  ensureOrdersColumn(database, "normalized_tracking_number", "TEXT");
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
