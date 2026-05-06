import { app } from "electron";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

let db: Database.Database | null = null;

function getSchemaSql(): string {
  const candidates = [
    path.join(process.cwd(), "src", "main", "db", "schema.sql"),
    path.join(__dirname, "schema.sql"),
    path.join(process.resourcesPath ?? "", "db", "schema.sql")
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf8");
    }
  }

  throw new Error(
    `schema.sql not found. Checked: ${candidates.join(", ")}`
  );
}

function getMigrationsDir(): string {
  return path.join(process.cwd(), "src", "main", "db", "migrations");
}

function applySchema(database: Database.Database) {
  database.pragma("foreign_keys = ON");
  database.exec(getSchemaSql());
}

function applyMigrations(database: Database.Database) {
  const migrationsDir = getMigrationsDir();

  if (!fs.existsSync(migrationsDir)) {
    return;
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const hasMigration = database.prepare(
    "SELECT 1 FROM _migrations WHERE name = ?"
  );

  const insertMigration = database.prepare(
    "INSERT INTO _migrations (name) VALUES (?)"
  );

  const runMigration = database.transaction((file: string) => {
    const alreadyApplied = hasMigration.get(file);

    if (alreadyApplied) {
      return;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    database.exec(sql);
    insertMigration.run(file);
  });

  for (const file of files) {
    runMigration(file);
  }
}

export function getDbPath(): string {
  const userDataPath = app.getPath("userData");
  return path.join(userDataPath, "veasly.db");
}

export function getDb(): Database.Database {
  if (db) {
    return db;
  }

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  applySchema(db);
  applyMigrations(db);

  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
