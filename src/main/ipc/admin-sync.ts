/**
 * Admin 동기화 IPC 핸들러
 * - admin:login — Admin 로그인
 * - admin:sync — 주문 데이터 동기화
 * - admin:match — 매칭 실행
 * - admin:getMatches — 매칭 결과 조회
 * - admin:confirmMatch — 매칭 확인/거부
 */

import { ipcMain } from "electron";
import { getDb, ensureOrdersColumn } from "../db/client";
import {
  adminLogin,
  fetchOrders,
  fetchOrderDetail,
  fetchCombinedBase,
  type AdminSession,
  type AdminItemData,
} from "../services/admin-api";
import {
  matchAll,
  type TrackerOrder,
  type AdminItem,
} from "../services/matching-engine";

let currentSession: AdminSession | null = null;

export function registerAdminSyncHandlers() {
  // ── 로그인 ──
  ipcMain.handle(
    "admin:login",
    async (_e, username: string, password: string) => {
      try {
        currentSession = await adminLogin({ username, password });
        return { ok: true, user: currentSession.user };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  );

  // ── 토큰 상태 ──
  ipcMain.handle("admin:status", () => {
    if (!currentSession) return { ok: false, loggedIn: false };
    return {
      ok: true,
      loggedIn: true,
      user: currentSession.user,
      expires: currentSession.expires,
    };
  });

  // ── 주문 동기화 ──
  ipcMain.handle(
    "admin:sync",
    async (
      _e,
      opts: { statuses?: string[]; maxPages?: number } = {}
    ) => {
      if (!currentSession) return { ok: false, error: "로그인 필요" };

      const db = getDb();
      const token = currentSession.accessToken;
      const statuses = opts.statuses || [
        "PAYMENT_COMPLETED",
        "ORDER_PROCESSING",
        "SHIPPING_TO_BDJ",
        "SHIPPING_TO_HOME",
      ];
      const maxPages = opts.maxPages || 10;

      // DB 준비
      const upsertOrder = db.prepare(`
        INSERT INTO admin_orders (veasly_order_number, ordered_at, status, total_amount_local, currency, is_combined, has_free_shipping, customer_name, shipping_address_type, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(veasly_order_number) DO UPDATE SET
          status = excluded.status,
          total_amount_local = excluded.total_amount_local,
          is_combined = excluded.is_combined,
          has_free_shipping = excluded.has_free_shipping,
          updated_at = datetime('now')
      `);

      const getAdminOrderId = db.prepare(
        "SELECT id FROM admin_orders WHERE veasly_order_number = ?"
      );

      const upsertItem = db.prepare(`
        INSERT INTO admin_order_items (admin_order_id, order_item_number, product_name, brand, detail_url, price_local, price_krw, quantity, estimated_weight, status, is_free_shipping, is_cancelled, purchase_url, purchase_price, card_approval_code, card_provider, domestic_tracking, overseas_tracking, overseas_vendor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
      `);

      // 기존 아이템 삭제 (재동기화)
      const deleteItems = db.prepare(
        "DELETE FROM admin_order_items WHERE admin_order_id = ?"
      );

      let totalOrders = 0;
      let newOrders = 0;
      let updatedOrders = 0;

      // 동기화 로그 시작
      const logInsert = db.prepare(`
        INSERT INTO admin_sync_logs (status, total_orders) VALUES ('running', 0)
      `);
      const logResult = logInsert.run();
      const logId = logResult.lastInsertRowid;

      const CANCEL_STATUSES = ["CANCEL_COMPLETED", "CANCEL_REQUESTED"];

      try {
        for (const status of statuses) {
          for (let page = 0; page < maxPages; page++) {
            const listData = await fetchOrders(token, {
              page,
              take: 100,
              status,
            });
            if (!listData.data || listData.data.length === 0) break;

            for (const listOrder of listData.data) {
              const orderNumber = listOrder.orderNumber;
              totalOrders++;

              // 목록 데이터에서 기본 정보 추출 (추가 API 호출 불필요)
              const payment = listOrder.payment || {};
              const isCombined = (listOrder.children || []).length > 0;

              // detail API 1번만 호출 (아이템 정보 필요)
              let detailItems = await fetchOrderDetail(token, orderNumber);

              // detail 실패 시 combined-detail 시도
              if (detailItems.length === 0 && isCombined) {
                const combined = await fetchCombinedBase(token, orderNumber);
                if (combined) {
                  try {
                    const detRes = await fetch(
                      `https://api.veasly.com/admin/orders/${orderNumber}/combined-shipping-detail`,
                      { headers: { Authorization: `Bearer ${token}` } }
                    );
                    if (detRes.ok) {
                      const detData = await detRes.json() as any;
                      detailItems = (detData.data || []).flatMap(
                        (child: any) => child.items || []
                      );
                    }
                  } catch {}
                }
              }

              // 주문 upsert (목록 데이터 기반)
              const existingRow = getAdminOrderId.get(orderNumber) as
                | { id: number }
                | undefined;
              const isNew = !existingRow;
              const hasFreeShipping = listOrder.items?.some(
                (it: any) => it.isFreeShipping
              ) || false;

              upsertOrder.run(
                orderNumber,
                listOrder.orderedAt || "",
                listOrder.status || "",
                payment.totalAmountLocal || 0,
                payment.currency || "TWD",
                isCombined ? 1 : 0,
                hasFreeShipping ? 1 : 0,
                listOrder.customer?.name || "",
                listOrder.shippingAddress?.type || ""
              );

              const adminOrderRow = getAdminOrderId.get(orderNumber) as {
                id: number;
              };
              const adminOrderId = adminOrderRow.id;

              // 아이템 재동기화
              deleteItems.run(adminOrderId);
              for (const it of detailItems) {
                const ph = (it.purchaseHistory || [])[0];
                const domesticShip = (it.shippingInfo || []).find(
                  (s: any) => s.isDomestic
                );
                const overseasShip = (it.shippingInfo || []).find(
                  (s: any) => !s.isDomestic && s.vendor
                );

                upsertItem.run(
                  adminOrderId,
                  it.orderItemNumber || "",
                  it.product?.name || "",
                  it.product?.brand || "",
                  it.product?.detailUrl || "",
                  it.priceLocal || 0,
                  it.priceKRW || 0,
                  it.quantity || 1,
                  it.weight || it.product?.weight || 0,
                  it.status || "",
                  it.isFreeShipping ? 1 : 0,
                  CANCEL_STATUSES.includes(it.status || "") ? 1 : 0,
                  ph?.url || null,
                  ph?.purchasePrice || null,
                  ph?.cardProviderApprovalCode || null,
                  ph?.cardProviderName || null,
                  domesticShip?.trackingNumber || null,
                  overseasShip?.trackingNumber || null,
                  overseasShip?.vendor?.text || null
                );
              }

              if (isNew) newOrders++;
              else updatedOrders++;
            }

            if (listData.data.length < 100) break;
          }
        }

        // 동기화 로그 완료
        db.prepare(`
          UPDATE admin_sync_logs
          SET status = 'success', finished_at = datetime('now'),
              total_orders = ?, new_orders = ?, updated_orders = ?
          WHERE id = ?
        `).run(totalOrders, newOrders, updatedOrders, logId);

        return { ok: true, totalOrders, newOrders, updatedOrders };
      } catch (err) {
        db.prepare(`
          UPDATE admin_sync_logs
          SET status = 'failed', finished_at = datetime('now'), error_message = ?
          WHERE id = ?
        `).run(
          err instanceof Error ? err.message : String(err),
          logId
        );
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  );

  // ── 매칭 실행 ──
  ipcMain.handle("admin:match", async () => {
    const db = getDb();

    // 1) tracker 주문 로드 (미매칭 건)
    const trackerRows = db
      .prepare(
        `
      SELECT o.id, s.code as site_code, o.order_number, o.order_date,
             o.product_name, o.amount, o.tracking_number,
             o.normalized_tracking_number, o.invoice_number, o.raw_data
      FROM orders o
      JOIN sites s ON o.site_id = s.id
      WHERE o.id NOT IN (
        SELECT tracker_order_id FROM order_matches WHERE match_type != 'REJECTED'
      )
    `
      )
      .all() as any[];

    const trackerOrders: TrackerOrder[] = trackerRows.map((r) => ({
      id: r.id,
      siteCode: r.site_code,
      orderNumber: r.order_number,
      orderDate: r.order_date,
      productName: r.product_name,
      amount: r.amount,
      trackingNumber: r.tracking_number,
      normalizedTrackingNumber: r.normalized_tracking_number,
      invoiceNumber: r.invoice_number,
      rawData: r.raw_data ? JSON.parse(r.raw_data) : {},
    }));

    // 2) admin 아이템 로드 (미매칭 건)
    const adminRows = db
      .prepare(
        `
      SELECT ai.id, ai.admin_order_id, ao.veasly_order_number, ai.order_item_number,
             ai.product_name, ai.brand, ai.detail_url, ai.price_krw, ai.status,
             ai.purchase_url, ai.purchase_price, ai.card_approval_code,
             ai.domestic_tracking, ao.ordered_at
      FROM admin_order_items ai
      JOIN admin_orders ao ON ai.admin_order_id = ao.id
      WHERE ai.is_cancelled = 0
        AND ai.id NOT IN (
          SELECT admin_item_id FROM order_matches WHERE match_type != 'REJECTED'
        )
    `
      )
      .all() as any[];

    const adminItems: AdminItem[] = adminRows.map((r) => ({
      id: r.id,
      adminOrderId: r.admin_order_id,
      veaslyOrderNumber: r.veasly_order_number,
      orderItemNumber: r.order_item_number,
      productName: r.product_name,
      brand: r.brand,
      detailUrl: r.detail_url || "",
      priceKRW: r.price_krw,
      status: r.status,
      purchaseUrl: r.purchase_url,
      purchasePrice: r.purchase_price,
      cardApprovalCode: r.card_approval_code,
      domesticTracking: r.domestic_tracking,
      orderedAt: r.ordered_at || "",
    }));

    // 3) 매칭 실행
    const matches = matchAll(trackerOrders, adminItems);

    // 4) 결과 저장
    const insertMatch = db.prepare(`
      INSERT INTO order_matches (tracker_order_id, admin_item_id, match_score, match_reasons, match_type)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(tracker_order_id, admin_item_id) DO UPDATE SET
        match_score = excluded.match_score,
        match_reasons = excluded.match_reasons,
        match_type = excluded.match_type
    `);

    let autoCount = 0;
    let suggestCount = 0;

    const tx = db.transaction(() => {
      for (const m of matches) {
        insertMatch.run(
          m.trackerOrderId,
          m.adminItemId,
          m.score,
          JSON.stringify(m.reasons),
          m.type
        );
        if (m.type === "AUTO") autoCount++;
        else if (m.type === "SUGGEST") suggestCount++;
      }
    });
    tx();

    return {
      ok: true,
      total: matches.length,
      auto: autoCount,
      suggest: suggestCount,
      trackerTotal: trackerOrders.length,
      adminTotal: adminItems.length,
    };
  });

  // ── 매칭 결과 조회 ──
  ipcMain.handle(
    "admin:getMatches",
    async (_e, filter: { type?: string; confirmed?: boolean } = {}) => {
      const db = getDb();
      let where = "1=1";
      if (filter.type) where += ` AND om.match_type = '${filter.type}'`;
      if (filter.confirmed !== undefined)
        where += ` AND om.confirmed = ${filter.confirmed ? 1 : 0}`;

      const rows = db
        .prepare(
          `
        SELECT om.*,
               o.order_number as tracker_order_number,
               o.product_name as tracker_product_name,
               o.amount as tracker_amount,
               o.tracking_number as tracker_tracking,
               s.code as tracker_site_code,
               ai.order_item_number as admin_item_number,
               ai.product_name as admin_product_name,
               ai.purchase_url as admin_purchase_url,
               ai.price_krw as admin_price_krw,
               ao.veasly_order_number
        FROM order_matches om
        JOIN orders o ON om.tracker_order_id = o.id
        JOIN sites s ON o.site_id = s.id
        JOIN admin_order_items ai ON om.admin_item_id = ai.id
        JOIN admin_orders ao ON ai.admin_order_id = ao.id
        WHERE ${where}
        ORDER BY om.match_score DESC
      `
        )
        .all();

      return { ok: true, matches: rows };
    }
  );

  // ── 매칭 확인/거부 ──
  ipcMain.handle(
    "admin:confirmMatch",
    async (_e, matchId: number, confirmed: boolean) => {
      const db = getDb();
      db.prepare(`
        UPDATE order_matches
        SET confirmed = ?, confirmed_at = datetime('now'),
            match_type = CASE WHEN ? THEN match_type ELSE 'REJECTED' END
        WHERE id = ?
      `).run(confirmed ? 1 : 0, confirmed ? 1 : 0, matchId);
      return { ok: true };
    }
  );

  // ── Admin 동기화 통계 ──
  ipcMain.handle("admin:stats", () => {
    const db = getDb();
    try {
      const adminOrders =
        (
          db
            .prepare("SELECT COUNT(*) as c FROM admin_orders")
            .get() as any
        )?.c || 0;
      const adminItems =
        (
          db
            .prepare("SELECT COUNT(*) as c FROM admin_order_items")
            .get() as any
        )?.c || 0;
      const totalMatches =
        (
          db
            .prepare("SELECT COUNT(*) as c FROM order_matches")
            .get() as any
        )?.c || 0;
      const autoMatches =
        (
          db
            .prepare(
              "SELECT COUNT(*) as c FROM order_matches WHERE match_type = 'AUTO'"
            )
            .get() as any
        )?.c || 0;
      const suggestMatches =
        (
          db
            .prepare(
              "SELECT COUNT(*) as c FROM order_matches WHERE match_type = 'SUGGEST'"
            )
            .get() as any
        )?.c || 0;
      const lastSync = db
        .prepare(
          "SELECT * FROM admin_sync_logs ORDER BY id DESC LIMIT 1"
        )
        .get() as any;

      return {
        ok: true,
        adminOrders,
        adminItems,
        totalMatches,
        autoMatches,
        suggestMatches,
        lastSync,
      };
    } catch {
      return { ok: true, adminOrders: 0, adminItems: 0, totalMatches: 0, autoMatches: 0, suggestMatches: 0, lastSync: null };
    }
  });
}
