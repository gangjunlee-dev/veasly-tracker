import { ipcMain } from "electron";
import { z } from "zod";
import { getDb } from "../db/client";
import { encrypt } from "../crypto/vault";

const CreateSiteSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  enabled: z.boolean().optional()
});

const UpdateSiteSchema = z.object({
  id: z.number().int().positive(),
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  enabled: z.boolean().optional()
});

const DeleteSiteSchema = z.object({
  id: z.number().int().positive()
});

function toBoolean(value: unknown): boolean {
  return value === 1 || value === true;
}

function mapSiteRow(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    username: String(row.username),
    enabled: toBoolean(row.enabled),
    lastExtractedAt: row.last_extracted_at ? String(row.last_extracted_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function registerSitesIpc() {
  ipcMain.handle("sites:list", async () => {
    const db = getDb();

    const rows = db
      .prepare(
        `
        SELECT
          id,
          code,
          name,
          username,
          enabled,
          last_extracted_at,
          created_at,
          updated_at
        FROM sites
        ORDER BY created_at DESC, id DESC
        `
      )
      .all() as Record<string, unknown>[];

    return rows.map(mapSiteRow);
  });

  ipcMain.handle("sites:create", async (_event, rawInput) => {
    const input = CreateSiteSchema.parse(rawInput);
    const db = getDb();
    const encrypted = await encrypt(input.password);

    const result = db
      .prepare(
        `
        INSERT INTO sites (
          code,
          name,
          username,
          password_ciphertext,
          password_iv,
          password_auth_tag,
          enabled
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        input.code,
        input.name,
        input.username,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        input.enabled === false ? 0 : 1
      );

    const row = db
      .prepare(
        `
        SELECT
          id,
          code,
          name,
          username,
          enabled,
          last_extracted_at,
          created_at,
          updated_at
        FROM sites
        WHERE id = ?
        `
      )
      .get(result.lastInsertRowid) as Record<string, unknown>;

    return mapSiteRow(row);
  });

  ipcMain.handle("sites:update", async (_event, rawInput) => {
    const input = UpdateSiteSchema.parse(rawInput);
    const db = getDb();

    const existing = db
      .prepare("SELECT id FROM sites WHERE id = ?")
      .get(input.id);

    if (!existing) {
      throw new Error(`Site not found: ${input.id}`);
    }

    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.code !== undefined) {
      sets.push("code = ?");
      values.push(input.code);
    }

    if (input.name !== undefined) {
      sets.push("name = ?");
      values.push(input.name);
    }

    if (input.username !== undefined) {
      sets.push("username = ?");
      values.push(input.username);
    }

    if (input.enabled !== undefined) {
      sets.push("enabled = ?");
      values.push(input.enabled ? 1 : 0);
    }

    if (input.password !== undefined) {
      const encrypted = await encrypt(input.password);
      sets.push("password_ciphertext = ?");
      values.push(encrypted.ciphertext);
      sets.push("password_iv = ?");
      values.push(encrypted.iv);
      sets.push("password_auth_tag = ?");
      values.push(encrypted.authTag);
    }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      values.push(input.id);

      db.prepare(
        `
        UPDATE sites
        SET ${sets.join(", ")}
        WHERE id = ?
        `
      ).run(...values);
    }

    const row = db
      .prepare(
        `
        SELECT
          id,
          code,
          name,
          username,
          enabled,
          last_extracted_at,
          created_at,
          updated_at
        FROM sites
        WHERE id = ?
        `
      )
      .get(input.id) as Record<string, unknown>;

    return mapSiteRow(row);
  });

  ipcMain.handle("sites:delete", async (_event, rawInput) => {
    const input = DeleteSiteSchema.parse(rawInput);
    const db = getDb();

    const deleteSite = db.transaction((siteId: number) => {
      db.prepare("DELETE FROM orders WHERE site_id = ?").run(siteId);
      db.prepare("DELETE FROM extraction_logs WHERE site_id = ?").run(siteId);
      const result = db.prepare("DELETE FROM sites WHERE id = ?").run(siteId);

      return {
        success: result.changes > 0,
        deletedId: siteId
      };
    });

    return deleteSite(input.id);
  });
}
