/**
 * URL 페어링 — admin_order_items와 orders를 (siteCode, sourceOrderRef)로 묶어서
 * orders 측 송장을 admin_order_items의 domestic_tracking_number로 복사한다.
 *
 * 사용자 스펙 Step 1: Map Master Orders to Supplier Orders (Via URL).
 *
 * 이 함수는 autoMatch 직전에 호출되어, 페어링 결과가 admin_order_items에 반영된다.
 * 그 다음 inbound_scans ↔ orders 매칭(기존 로직)이 별개로 돌아간다.
 */

import type Database from "better-sqlite3";
import log from "electron-log";
import { extractOrderRef } from "./order-ref";

const logger = log.scope("url-pairing");

export interface PairingResult {
  /** 새로 송장이 채워진 admin_order_items 수 */
  paired: number;
  /** orders 쪽에 같은 (siteCode, ref)가 없어서 skip */
  noMatch: number;
  /** orders 쪽에 송장이 여러 개라 모호하여 skip */
  ambiguous: number;
  /** purchase_url 파싱 실패 (알 수 없는 도메인 등) */
  malformedUrl: number;
  /** 이번 호출로 새로 송장이 채워진 admin_order_items.id 목록 (admin push 대상) */
  pairedItemIds: number[];
}

interface AdminCandidateRow {
  id: number;
  purchase_url: string | null;
  source_order_ref: string;
}

interface OrderTrackingRow {
  tracking_number: string;
  site_code: string;
}

export function pairAdminWithSupplier(db: Database.Database): PairingResult {
  const now = new Date().toISOString();
  const result: PairingResult = {
    paired: 0,
    noMatch: 0,
    ambiguous: 0,
    malformedUrl: 0,
    pairedItemIds: []
  };

  const candidates = db
    .prepare(
      `
      SELECT id, purchase_url, source_order_ref
      FROM admin_order_items
      WHERE source_order_ref IS NOT NULL
        AND source_order_ref != ''
        AND (domestic_tracking_number IS NULL OR domestic_tracking_number = '')
      `
    )
    .all() as AdminCandidateRow[];

  if (candidates.length === 0) {
    return result;
  }

  const findOrdersByRef = db.prepare(
    `
    SELECT DISTINCT o.tracking_number, s.code AS site_code
    FROM orders o
    JOIN sites s ON s.id = o.site_id
    WHERE o.source_order_ref = ?
      AND o.tracking_number IS NOT NULL
      AND o.tracking_number != ''
    `
  );

  const update = db.prepare(
    `
    UPDATE admin_order_items
    SET domestic_tracking_number = ?,
        updated_at = ?
    WHERE id = ?
      AND (domestic_tracking_number IS NULL OR domestic_tracking_number = '')
    `
  );

  const tx = db.transaction(() => {
    for (const aoi of candidates) {
      const ref = extractOrderRef(aoi.purchase_url);
      if (!ref) {
        result.malformedUrl += 1;
        continue;
      }

      // siteCode가 일치하는 supplier 주문의 송장만 후보로 인정.
      // (다른 사이트에서 우연히 같은 숫자 ref를 갖는 충돌 방지)
      const rows = findOrdersByRef.all(aoi.source_order_ref) as OrderTrackingRow[];
      const matched = rows.filter((r) => r.site_code === ref.siteCode);

      if (matched.length === 0) {
        result.noMatch += 1;
        continue;
      }

      // 한 주문에 line이 여러 개여도 송장은 보통 1개. distinct가 2 이상이면 사람이 결정.
      const distinct = new Set(matched.map((r) => r.tracking_number));
      if (distinct.size > 1) {
        result.ambiguous += 1;
        logger.warn(
          `[pair] ambiguous tracking for aoi=${aoi.id} ref=${aoi.source_order_ref}: ${distinct.size} candidates`
        );
        continue;
      }

      const tracking = [...distinct][0];
      update.run(tracking, now, aoi.id);
      result.paired += 1;
      result.pairedItemIds.push(aoi.id);
    }
  });

  tx();

  if (result.paired > 0 || result.ambiguous > 0) {
    logger.info(
      `[pair] paired=${result.paired}, noMatch=${result.noMatch}, ambiguous=${result.ambiguous}, malformedUrl=${result.malformedUrl}`
    );
  }

  return result;
}
