import { getDb } from "../db/client";
import { encrypt, type EncryptedPayload } from "../crypto/vault";

export type SiteRow = {
  id: number;
  code: string;
  name: string;
  username: string;
  enabled: boolean;
  lastExtractedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateSiteParams = {
  code: string;
  name: string;
  username: string;
  password: string;
  enabled?: boolean;
};

export type UpdateSiteParams = {
  id: number;
  code?: string;
  name?: string;
  username?: string;
  password?: string;
  enabled?: boolean;
};

function toBoolean(value: unknown): boolean {
  return value === 1 || value === true;
}

function mapSiteRow(row: Record<string, unknown>): SiteRow {
  return {
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    username: String(row.username),
    enabled: toBoolean(row.enabled),
    lastExtractedAt: row.last_extracted_at
      ? String(row.last_extracted_at)
      : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function listSites(): SiteRow[] {
  const rows = getDb()
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
}

export function getSiteById(id: number): SiteRow | null {
  const row = getDb()
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
    .get(id) as Record<string, unknown> | undefined;

  return row ? mapSiteRow(row) : null;
}

export type SiteCredentialsRow = SiteRow & {
  passwordCiphertext: string;
  passwordIv: string;
  passwordAuthTag: string;
};

export function getSiteWithCredentials(
  id: number
): SiteCredentialsRow | null {
  const row = getDb()
    .prepare(
      `
      SELECT
        id,
        code,
        name,
        username,
        password_ciphertext,
        password_iv,
        password_auth_tag,
        enabled,
        last_extracted_at,
        created_at,
        updated_at
      FROM sites
      WHERE id = ?
      `
    )
    .get(id) as Record<string, unknown> | undefined;

  if (!row) return null;

  return {
    ...mapSiteRow(row),
    passwordCiphertext: String(row.password_ciphertext),
    passwordIv: String(row.password_iv),
    passwordAuthTag: String(row.password_auth_tag)
  };
}

export async function createSite(params: CreateSiteParams): Promise<SiteRow> {
  const db = getDb();
  const encrypted = await encrypt(params.password);

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
      params.code,
      params.name,
      params.username,
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      params.enabled === false ? 0 : 1
    );

  const created = getSiteById(Number(result.lastInsertRowid));

  if (!created) {
    throw new Error("사이트 생성 직후 다시 조회에 실패했습니다.");
  }

  return created;
}

export async function updateSite(params: UpdateSiteParams): Promise<SiteRow> {
  const existing = getSiteById(params.id);

  if (!existing) {
    throw new Error(`사이트를 찾을 수 없습니다 (id=${params.id}).`);
  }

  const sets: string[] = [];
  const values: unknown[] = [];

  if (params.code !== undefined) {
    sets.push("code = ?");
    values.push(params.code);
  }
  if (params.name !== undefined) {
    sets.push("name = ?");
    values.push(params.name);
  }
  if (params.username !== undefined) {
    sets.push("username = ?");
    values.push(params.username);
  }
  if (params.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(params.enabled ? 1 : 0);
  }

  if (params.password !== undefined) {
    const encrypted: EncryptedPayload = await encrypt(params.password);
    sets.push("password_ciphertext = ?");
    values.push(encrypted.ciphertext);
    sets.push("password_iv = ?");
    values.push(encrypted.iv);
    sets.push("password_auth_tag = ?");
    values.push(encrypted.authTag);
  }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    values.push(params.id);

    getDb()
      .prepare(
        `
        UPDATE sites
        SET ${sets.join(", ")}
        WHERE id = ?
        `
      )
      .run(...values);
  }

  const updated = getSiteById(params.id);

  if (!updated) {
    throw new Error(`업데이트된 사이트를 조회할 수 없습니다 (id=${params.id}).`);
  }

  return updated;
}

export function deleteSite(id: number): { success: boolean; deletedId: number } {
  const db = getDb();

  const deleteSiteTx = db.transaction((siteId: number) => {
    db.prepare("DELETE FROM orders WHERE site_id = ?").run(siteId);
    db.prepare("DELETE FROM extraction_logs WHERE site_id = ?").run(siteId);
    const result = db.prepare("DELETE FROM sites WHERE id = ?").run(siteId);

    return {
      success: result.changes > 0,
      deletedId: siteId
    };
  });

  return deleteSiteTx(id);
}

export function touchSiteExtractedAt(id: number): void {
  getDb()
    .prepare(
      `
      UPDATE sites
      SET last_extracted_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
      `
    )
    .run(id);
}
