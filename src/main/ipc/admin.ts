/**
 * Admin 연동 IPC 핸들러.
 *
 * Phase 1: 자격증명 저장, 로그인, 토큰 검증, 자동 로그인.
 * Phase 2: 주문 동기화 (admin → local SQLite).
 */

import { ipcMain } from "electron";
import { z } from "zod";
import { encrypt, decrypt } from "../crypto/vault";
import { getDb } from "../db/client";
import { loginToAdmin } from "../admin-api/auth";
import { AdminApiClient } from "../admin-api/client";
import { OrderSync } from "../sync/order-sync";
import { pushToOps } from "../sync/ops-push";
import log from "electron-log";

const logger = log.scope("ipc-admin");

/** DB kv 테이블에 값 저장 */
function kvPut(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, value);
}

/** DB kv 테이블에서 값 조회 */
function kvGet(key: string): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM kv WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/** DB kv 테이블에서 값 삭제 */
function kvDelete(key: string): void {
  const db = getDb();
  db.prepare("DELETE FROM kv WHERE key = ?").run(key);
}

export function registerAdminIpc(): void {
  // ── 자격증명 저장 (Settings에서 ID/PW 입력 시) ──
  ipcMain.handle("admin:saveCredentials", async (_event, rawInput) => {
    const input = z
      .object({
        username: z.string().min(1),
        password: z.string().min(1),
      })
      .parse(rawInput);

    // username은 평문 저장 (민감하지 않음)
    kvPut("admin_username", input.username);

    // password는 AES-256-GCM 암호화 후 저장
    const encrypted = await encrypt(input.password);
    kvPut("admin_password_encrypted", JSON.stringify(encrypted));

    // 기존 토큰 무효화
    kvDelete("admin_access_token");
    kvDelete("admin_token_expires");

    logger.info("Admin 자격증명 저장 완료");
    return { ok: true };
  });

  // ── 로그인 (수동 또는 자동) ──
  ipcMain.handle("admin:login", async () => {
    const username = kvGet("admin_username");
    const encryptedJson = kvGet("admin_password_encrypted");

    if (!username || !encryptedJson) {
      return { ok: false, error: "저장된 자격증명이 없습니다. 설정에서 먼저 입력해주세요." };
    }

    let password: string;
    try {
      const encrypted = JSON.parse(encryptedJson);
      password = await decrypt(encrypted);
    } catch (err) {
      logger.error("비밀번호 복호화 실패:", err);
      return { ok: false, error: "저장된 비밀번호를 복호화할 수 없습니다. 다시 입력해주세요." };
    }

    try {
      const tokens = await loginToAdmin(username, password);
      kvPut("admin_access_token", tokens.accessToken);
      if (tokens.expires) {
        kvPut("admin_token_expires", tokens.expires);
      }
      logger.info("Admin 로그인 성공");
      return { ok: true, expires: tokens.expires };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Admin 로그인 실패:", message);
      return { ok: false, error: message };
    }
  });

  // ── 토큰 상태 확인 ──
  ipcMain.handle("admin:status", async () => {
    const username = kvGet("admin_username");
    const hasCredentials = !!username && !!kvGet("admin_password_encrypted");
    const accessToken = kvGet("admin_access_token");
    const expires = kvGet("admin_token_expires");

    let tokenValid = false;
    if (accessToken) {
      try {
        const client = new AdminApiClient(accessToken);
        tokenValid = await client.verifyToken();
      } catch {
        tokenValid = false;
      }
    }

    return {
      hasCredentials,
      username: username ?? null,
      hasToken: !!accessToken,
      tokenValid,
      expires: expires ?? null,
    };
  });

  // ── 로그아웃 (토큰 + 자격증명 삭제) ──
  ipcMain.handle("admin:logout", async () => {
    kvDelete("admin_access_token");
    kvDelete("admin_token_expires");
    kvDelete("admin_username");
    kvDelete("admin_password_encrypted");
    logger.info("Admin 로그아웃 완료");
    return { ok: true };
  });

  // ── Ops 연동 설정 ──

  ipcMain.handle("admin:saveOpsConfig", async (_event, rawInput) => {
    const input = z
      .object({
        opsUrl: z.string().url(),
        opsApiKey: z.string().min(1),
      })
      .parse(rawInput);

    kvPut("ops_url", input.opsUrl.replace(/\/$/, "")); // trailing slash 제거
    kvPut("ops_api_key", input.opsApiKey);
    logger.info("Ops 연동 설정 저장:", input.opsUrl);
    return { ok: true };
  });

  ipcMain.handle("admin:getOpsConfig", async () => {
    return {
      opsUrl: kvGet("ops_url") ?? "",
      opsApiKey: kvGet("ops_api_key") ? "********" : "",
      hasConfig: !!kvGet("ops_url") && !!kvGet("ops_api_key"),
    };
  });

  // ── Ops에 수동 푸시 (기존 로컬 데이터 전송) ──

  ipcMain.handle("admin:pushToOps", async () => {
    const opsUrl = kvGet("ops_url");
    const opsApiKey = kvGet("ops_api_key");
    if (!opsUrl || !opsApiKey) {
      return { ok: false, error: "Ops 연동 설정이 필요합니다." };
    }

    const db = getDb();
    try {
      const result = await pushToOps(db, opsUrl, opsApiKey);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  });

  // ── 자동 로그인 (앱 시작 시 main에서 호출) ──
  ipcMain.handle("admin:autoLogin", async () => {
    const accessToken = kvGet("admin_access_token");

    // 기존 토큰이 있으면 먼저 유효성 확인
    if (accessToken) {
      try {
        const client = new AdminApiClient(accessToken);
        const valid = await client.verifyToken();
        if (valid) {
          logger.info("기존 토큰 유효 — 자동 로그인 생략");
          return { ok: true, method: "cached" };
        }
      } catch {
        // 토큰 만료 — 재로그인 시도
      }
    }

    // 저장된 자격증명으로 재로그인
    const username = kvGet("admin_username");
    const encryptedJson = kvGet("admin_password_encrypted");
    if (!username || !encryptedJson) {
      return { ok: false, reason: "no_credentials" };
    }

    let password: string;
    try {
      const encrypted = JSON.parse(encryptedJson);
      password = await decrypt(encrypted);
    } catch {
      return { ok: false, reason: "decrypt_failed" };
    }

    try {
      const tokens = await loginToAdmin(username, password);
      kvPut("admin_access_token", tokens.accessToken);
      if (tokens.expires) {
        kvPut("admin_token_expires", tokens.expires);
      }
      logger.info("자동 로그인 성공");
      return { ok: true, method: "login" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("자동 로그인 실패:", message);
      return { ok: false, reason: "login_failed", error: message };
    }
  });

  // ── Phase 2: 주문 동기화 (admin → local) ──

  ipcMain.handle("admin:sync", async () => {
    const accessToken = kvGet("admin_access_token");
    if (!accessToken) {
      return { ok: false, error: "Admin 로그인이 필요합니다." };
    }

    const db = getDb();
    const api = new AdminApiClient(accessToken);
    const sync = new OrderSync(db, api);

    try {
      const result = await sync.syncPendingOrders();

      // ops 푸시 (설정되어 있으면)
      const opsUrl = kvGet("ops_url");
      const opsApiKey = kvGet("ops_api_key");
      let opsPush = null;
      if (opsUrl && opsApiKey) {
        try {
          opsPush = await pushToOps(db, opsUrl, opsApiKey);
        } catch (pushErr) {
          logger.warn("Ops 푸시 실패:", pushErr);
          opsPush = { ok: false, error: String(pushErr) };
        }
      }

      return { ok: true, ...result, opsPush };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // 토큰 만료 시 자동 재로그인 후 재시도
      if (message.includes("토큰 만료")) {
        logger.info("토큰 만료 감지 — 재로그인 시도");
        const username = kvGet("admin_username");
        const encryptedJson = kvGet("admin_password_encrypted");
        if (username && encryptedJson) {
          try {
            const encrypted = JSON.parse(encryptedJson);
            const password = await decrypt(encrypted);
            const tokens = await loginToAdmin(username, password);
            kvPut("admin_access_token", tokens.accessToken);

            // 새 토큰으로 재시도
            const retryApi = new AdminApiClient(tokens.accessToken);
            const retrySync = new OrderSync(db, retryApi);
            const retryResult = await retrySync.syncPendingOrders();
            return { ok: true, ...retryResult };
          } catch (retryErr) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            return { ok: false, error: `재로그인 후 동기화 실패: ${retryMsg}` };
          }
        }
      }

      logger.error("주문 동기화 실패:", message);
      return { ok: false, error: message };
    }
  });

  // ── 동기화 현황 조회 ──

  ipcMain.handle("admin:syncStatus", async () => {
    const db = getDb();
    const empty = {
      totalOrders: 0,
      totalItems: 0,
      byStatus: {} as Record<string, number>,
      byWarehouse: {} as Record<string, number>,
      lastSyncedAt: null as string | null,
    };

    try {
      // 두 테이블 모두 존재하는지 확인
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('admin_orders', 'admin_order_items')"
        )
        .all() as Array<{ name: string }>;
      const tableNames = new Set(tables.map((t) => t.name));

      if (!tableNames.has("admin_orders")) return empty;

      const totalOrders = (
        db.prepare("SELECT COUNT(*) as c FROM admin_orders").get() as { c: number }
      ).c;

      const lastSyncRow = db
        .prepare("SELECT MAX(synced_at) as t FROM admin_orders")
        .get() as { t: string | null };

      if (!tableNames.has("admin_order_items")) {
        return { ...empty, totalOrders, lastSyncedAt: lastSyncRow.t };
      }

      const totalItems = (
        db.prepare("SELECT COUNT(*) as c FROM admin_order_items").get() as { c: number }
      ).c;

      // item_status 컬럼 존재 여부 확인
      const columns = db
        .prepare("PRAGMA table_info(admin_order_items)")
        .all() as Array<{ name: string }>;
      const colNames = new Set(columns.map((c) => c.name));

      const byStatus: Record<string, number> = {};
      if (colNames.has("item_status")) {
        const statusRows = db
          .prepare("SELECT item_status, COUNT(*) as c FROM admin_order_items GROUP BY item_status")
          .all() as Array<{ item_status: string; c: number }>;
        for (const row of statusRows) {
          byStatus[row.item_status || "UNKNOWN"] = row.c;
        }
      }

      const byWarehouse: Record<string, number> = {};
      if (colNames.has("warehouse_status")) {
        const warehouseRows = db
          .prepare("SELECT warehouse_status, COUNT(*) as c FROM admin_order_items GROUP BY warehouse_status")
          .all() as Array<{ warehouse_status: string; c: number }>;
        for (const row of warehouseRows) {
          byWarehouse[row.warehouse_status || "UNKNOWN"] = row.c;
        }
      }

      return { totalOrders, totalItems, byStatus, byWarehouse, lastSyncedAt: lastSyncRow.t };
    } catch (err) {
      logger.warn("syncStatus 조회 실패:", err);
      return empty;
    }
  });

  // ── 동기화 아이템 목록 조회 ──

  ipcMain.handle("admin:listItems", async (_event, rawInput) => {
    const input = z
      .object({
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().max(200).default(50),
        status: z.string().optional(),
        warehouseStatus: z.string().optional(),
        search: z.string().optional(),
      })
      .default({})
      .parse(rawInput ?? {});

    const db = getDb();

    // 테이블 존재 확인
    const tableExists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='admin_order_items' LIMIT 1")
      .get();
    if (!tableExists) {
      return { items: [], total: 0, page: input.page, pageSize: input.pageSize };
    }

    const conditions: string[] = [];
    const params: any[] = [];

    if (input.status) {
      conditions.push("aoi.item_status = ?");
      params.push(input.status);
    }
    if (input.warehouseStatus) {
      conditions.push("aoi.warehouse_status = ?");
      params.push(input.warehouseStatus);
    }
    if (input.search) {
      conditions.push(
        "(aoi.vy_code LIKE ? OR aoi.product_name LIKE ? OR ao.order_number LIKE ? OR ao.customer_name LIKE ? OR aoi.domestic_tracking_number LIKE ?)"
      );
      const pattern = `%${input.search}%`;
      params.push(pattern, pattern, pattern, pattern, pattern);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const offset = (input.page - 1) * input.pageSize;

    const total = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM admin_order_items aoi JOIN admin_orders ao ON ao.id = aoi.admin_order_id ${where}`
        )
        .get(...params) as { c: number }
    ).c;

    const rows = db
      .prepare(
        `SELECT aoi.*, ao.order_number, ao.customer_name, ao.order_status
         FROM admin_order_items aoi
         JOIN admin_orders ao ON ao.id = aoi.admin_order_id
         ${where}
         ORDER BY ao.order_number DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, input.pageSize, offset) as any[];

    return {
      items: rows.map(mapMatchedItem),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  });

  // ── Phase 3: 바코드 매칭 ──

  /**
   * 바코드(송장번호)로 admin_order_items 자동 매칭.
   * 국내 택배 송장번호(domestic_tracking_number)와 비교합니다.
   */
  ipcMain.handle("admin:matchBarcode", async (_event, rawInput) => {
    const { trackingNumber } = z
      .object({ trackingNumber: z.string().min(1) })
      .parse(rawInput);

    const db = getDb();
    const trimmed = trackingNumber.replace(/\s/g, "");

    // 1) domestic_tracking_number 정확 매칭
    const matched = db
      .prepare(
        `SELECT aoi.*, ao.order_number, ao.customer_name, ao.order_status
         FROM admin_order_items aoi
         JOIN admin_orders ao ON ao.id = aoi.admin_order_id
         WHERE aoi.domestic_tracking_number = ?
         ORDER BY ao.order_number DESC`
      )
      .all(trimmed) as any[];

    if (matched.length > 0) {
      auditLog(db, "SCAN_AUTO", trimmed, matched[0]);
      return {
        matchType: "AUTO" as const,
        items: matched.map(mapMatchedItem),
      };
    }

    // 2) VY코드 또는 주문번호로 매칭
    const byCode = db
      .prepare(
        `SELECT aoi.*, ao.order_number, ao.customer_name, ao.order_status
         FROM admin_order_items aoi
         JOIN admin_orders ao ON ao.id = aoi.admin_order_id
         WHERE aoi.vy_code = ? OR ao.order_number = ?
         ORDER BY ao.order_number DESC`
      )
      .all(trimmed, trimmed) as any[];

    if (byCode.length > 0) {
      auditLog(db, "SCAN_AUTO", trimmed, byCode[0]);
      return {
        matchType: "AUTO" as const,
        items: byCode.map(mapMatchedItem),
      };
    }

    // 3) 부분 매칭 (끝 자리 일치) — 바코드 스캐너가 앞자리를 생략하는 경우
    if (trimmed.length >= 8) {
      const partial = db
        .prepare(
          `SELECT aoi.*, ao.order_number, ao.customer_name, ao.order_status
           FROM admin_order_items aoi
           JOIN admin_orders ao ON ao.id = aoi.admin_order_id
           WHERE aoi.domestic_tracking_number LIKE ?
             AND aoi.warehouse_status = 'PENDING'
           ORDER BY ao.order_number DESC
           LIMIT 10`
        )
        .all(`%${trimmed.slice(-8)}`) as any[];

      if (partial.length > 0) {
        auditLog(db, "SCAN_PARTIAL", trimmed, partial[0]);
        return {
          matchType: "PARTIAL" as const,
          items: partial.map(mapMatchedItem),
        };
      }
    }

    // 4) LIKE 검색 (상품명, 고객명 등)
    const fuzzy = db
      .prepare(
        `SELECT aoi.*, ao.order_number, ao.customer_name, ao.order_status
         FROM admin_order_items aoi
         JOIN admin_orders ao ON ao.id = aoi.admin_order_id
         WHERE aoi.product_name LIKE ?
            OR aoi.vy_code LIKE ?
            OR ao.order_number LIKE ?
            OR ao.customer_name LIKE ?
         ORDER BY ao.order_number DESC
         LIMIT 20`
      )
      .all(`%${trimmed}%`, `%${trimmed}%`, `%${trimmed}%`, `%${trimmed}%`) as any[];

    if (fuzzy.length > 0) {
      auditLog(db, "SCAN_PARTIAL", trimmed, fuzzy[0]);
      return {
        matchType: "PARTIAL" as const,
        items: fuzzy.map(mapMatchedItem),
      };
    }

    auditLog(db, "SCAN_MISS", trimmed);
    return { matchType: "NONE" as const, items: [] };
  });

  /**
   * 매칭 확정: 로컬 warehouse_status 업데이트 + admin 국내 송장 등록.
   */
  ipcMain.handle("admin:confirmMatch", async (_event, rawInput) => {
    const { orderItemId, trackingNumber, vyCode } = z
      .object({
        orderItemId: z.number(),
        trackingNumber: z.string(),
        vyCode: z.string(),
      })
      .parse(rawInput);

    const db = getDb();

    // 로컬 상태 업데이트
    db.prepare(
      `UPDATE admin_order_items
       SET warehouse_status = 'ARRIVED',
           warehouse_matched_at = datetime('now'),
           domestic_tracking_number = COALESCE(NULLIF(?, ''), domestic_tracking_number)
       WHERE order_item_id = ?`
    ).run(trackingNumber, orderItemId);

    // 로컬 확정 감사 로그
    const auditCtx = { order_item_id: orderItemId, vy_code: vyCode, order_number: "" };
    auditLog(db, "CONFIRM_LOCAL", trackingNumber, auditCtx);

    // admin.veasly.com에 국내 송장 등록
    const accessToken = kvGet("admin_access_token");
    if (!accessToken) {
      auditLog(db, "CONFIRM_SYNC_FAILED", trackingNumber, auditCtx, { adminError: "토큰 없음" });
      return { ok: true, synced: false, reason: "토큰 없음" };
    }

    const api = new AdminApiClient(accessToken);
    const result = await api.registerDomesticTracking(vyCode, trackingNumber);

    if (!result.ok) {
      logger.warn(`Admin 송장 등록 실패: ${result.error}`);
      auditLog(db, "CONFIRM_SYNC_FAILED", trackingNumber, auditCtx, { adminError: result.error });
      return { ok: true, synced: false, reason: result.error };
    }

    logger.info(`매칭 확정: ${vyCode} ← ${trackingNumber}`);
    auditLog(db, "CONFIRM_SYNCED", trackingNumber, auditCtx, { adminSynced: 1 });
    return { ok: true, synced: true };
  });

  /**
   * 수동 검색: 고객명, 상품명, VY코드, 주문번호로 주문 검색.
   */
  ipcMain.handle("admin:searchOrders", async (_event, rawInput) => {
    const { query } = z
      .object({ query: z.string().min(1) })
      .parse(rawInput);

    const db = getDb();
    const pattern = `%${query}%`;

    const results = db
      .prepare(
        `SELECT aoi.*, ao.order_number, ao.customer_name, ao.order_status
         FROM admin_order_items aoi
         JOIN admin_orders ao ON ao.id = aoi.admin_order_id
         WHERE aoi.warehouse_status = 'PENDING'
           AND (
             aoi.product_name LIKE ?
             OR aoi.vy_code LIKE ?
             OR ao.order_number LIKE ?
             OR ao.customer_name LIKE ?
             OR aoi.domestic_tracking_number LIKE ?
           )
         ORDER BY ao.order_number DESC
         LIMIT 30`
      )
      .all(pattern, pattern, pattern, pattern, pattern) as any[];

    return { results: results.map(mapMatchedItem) };
  });

  /**
   * 최근 매칭 이력 조회.
   */
  ipcMain.handle("admin:recentMatches", async (_event, rawInput) => {
    const { limit } = z
      .object({ limit: z.number().int().positive().default(20) })
      .default({})
      .parse(rawInput ?? {});

    const db = getDb();

    const rows = db
      .prepare(
        `SELECT aoi.*, ao.order_number, ao.customer_name, ao.order_status
         FROM admin_order_items aoi
         JOIN admin_orders ao ON ao.id = aoi.admin_order_id
         WHERE aoi.warehouse_status = 'ARRIVED'
         ORDER BY aoi.warehouse_matched_at DESC
         LIMIT ?`
      )
      .all(limit) as any[];

    return { items: rows.map(mapMatchedItem) };
  });

  // ── Phase 4: 감사 로그 + 재시도 ──

  /**
   * 감사 로그 조회 (최근 이벤트).
   */
  ipcMain.handle("admin:auditLog", async (_event, rawInput) => {
    const { limit, eventType } = z
      .object({
        limit: z.number().int().positive().default(50),
        eventType: z.string().optional(),
      })
      .default({})
      .parse(rawInput ?? {});

    const db = getDb();

    // 테이블 존재 확인
    const tableExists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='match_audit_log' LIMIT 1")
      .get();
    if (!tableExists) return { entries: [], stats: {} };

    const entries = eventType
      ? db
          .prepare(
            "SELECT * FROM match_audit_log WHERE event_type = ? ORDER BY created_at DESC LIMIT ?"
          )
          .all(eventType, limit) as any[]
      : db
          .prepare(
            "SELECT * FROM match_audit_log ORDER BY created_at DESC LIMIT ?"
          )
          .all(limit) as any[];

    // 통계
    const statsRows = db
      .prepare(
        "SELECT event_type, COUNT(*) as c FROM match_audit_log GROUP BY event_type"
      )
      .all() as Array<{ event_type: string; c: number }>;

    const stats: Record<string, number> = {};
    for (const row of statsRows) {
      stats[row.event_type] = row.c;
    }

    return {
      entries: entries.map(mapAuditEntry),
      stats,
    };
  });

  /**
   * Admin 전송 실패한 항목 재시도.
   */
  ipcMain.handle("admin:retryPending", async () => {
    const db = getDb();

    const tableExists = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='match_audit_log' LIMIT 1")
      .get();
    if (!tableExists) return { retried: 0, succeeded: 0, failed: 0 };

    // 전송 실패한 CONFIRM 이벤트 조회
    const pending = db
      .prepare(
        `SELECT DISTINCT vy_code, tracking_number, order_item_id
         FROM match_audit_log
         WHERE event_type IN ('CONFIRM_SYNC_FAILED', 'RETRY_FAILED')
           AND vy_code IS NOT NULL
           AND tracking_number IS NOT NULL
           AND vy_code NOT IN (
             SELECT vy_code FROM match_audit_log
             WHERE event_type IN ('CONFIRM_SYNCED', 'RETRY_SUCCESS')
               AND vy_code IS NOT NULL
           )
         ORDER BY created_at DESC
         LIMIT 50`
      )
      .all() as Array<{ vy_code: string; tracking_number: string; order_item_id: number }>;

    if (pending.length === 0) {
      return { retried: 0, succeeded: 0, failed: 0 };
    }

    const accessToken = kvGet("admin_access_token");
    if (!accessToken) {
      return { retried: 0, succeeded: 0, failed: 0, error: "토큰 없음" };
    }

    const api = new AdminApiClient(accessToken);
    let succeeded = 0;
    let failed = 0;

    for (const item of pending) {
      const result = await api.registerDomesticTracking(
        item.vy_code,
        item.tracking_number
      );

      if (result.ok) {
        auditLog(db, "RETRY_SUCCESS", item.tracking_number, item, { adminSynced: 1 });
        succeeded++;
      } else {
        auditLog(db, "RETRY_FAILED", item.tracking_number, item, { adminError: result.error });
        failed++;
      }
    }

    logger.info(`재시도 완료: ${succeeded} 성공, ${failed} 실패 / 총 ${pending.length}건`);
    return { retried: pending.length, succeeded, failed };
  });
}

function mapAuditEntry(row: any) {
  return {
    id: row.id,
    eventType: row.event_type,
    trackingNumber: row.tracking_number,
    orderItemId: row.order_item_id,
    vyCode: row.vy_code,
    orderNumber: row.order_number,
    productName: row.product_name,
    adminSynced: row.admin_synced === 1,
    adminError: row.admin_error,
    retryCount: row.retry_count,
    createdAt: row.created_at,
  };
}

/** 감사 로그 기록 헬퍼 */
function auditLog(
  db: ReturnType<typeof getDb>,
  eventType: string,
  trackingNumber: string,
  row?: any,
  extra?: { adminSynced?: number; adminError?: string }
): void {
  try {
    db.prepare(
      `INSERT INTO match_audit_log
        (event_type, tracking_number, order_item_id, vy_code, order_number, product_name, admin_synced, admin_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      eventType,
      trackingNumber,
      row?.order_item_id ?? row?.orderItemId ?? null,
      row?.vy_code ?? row?.vyCode ?? null,
      row?.order_number ?? row?.orderNumber ?? null,
      row?.product_name ?? row?.productName ?? null,
      extra?.adminSynced ?? 0,
      extra?.adminError ?? null
    );
  } catch {
    // 감사 로그 실패는 치명적이지 않음 — 무시
  }
}

function mapMatchedItem(row: any) {
  return {
    orderItemId: row.order_item_id,
    vyCode: row.vy_code,
    productName: row.product_name,
    itemStatus: row.item_status,
    warehouseStatus: row.warehouse_status,
    warehouseMatchedAt: row.warehouse_matched_at,
    domesticTrackingNumber: row.domestic_tracking_number,
    domesticCarrier: row.domestic_carrier,
    orderNumber: row.order_number,
    customerName: row.customer_name,
    orderStatus: row.order_status,
  };
}
