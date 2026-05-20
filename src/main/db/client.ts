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

  return db;
}

/**
 * Defensive last-resort: callable from hot paths (upserts) to make sure
 * the orders schema actually has every column the runtime expects, even
 * if some earlier migration step was silently skipped on this machine.
 */
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
