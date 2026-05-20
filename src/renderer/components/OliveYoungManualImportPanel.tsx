"use client";

import { useMemo, useState } from "react";
import { ClipboardCopy, Upload } from "lucide-react";
import { toast } from "sonner";
import type { OliveYoungSnapshot } from "../../shared/api";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Field, Textarea } from "./ui/Input";

type ImportResult = {
  siteId: number;
  totalItems: number;
  newOrders: number;
  updatedOrders: number;
  savedOrders: number;
  sourceOrderNumbers: string[];
};

type OliveYoungManualImportPanelProps = {
  siteId: number;
  onImported?: () => Promise<void> | void;
};

const OLIVEYOUNG_CONSOLE_SCRIPT = `(async () => {
  const normalize = (text) =>
    String(text || "").replace(/\\s+/g, " ").trim();

  const visible = (el) =>
    !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

  const parseAmount = (text) => {
    const m = normalize(text).match(/([\\d,]+)\\s*원/);
    return m ? Number(m[1].replace(/,/g, "")) : 0;
  };

  const parseOrderDate = (text) => {
    const m = normalize(text).match(/(20\\d{2})[.]\\d{1,2}[.]\\d{1,2}\\s+Y\\d{10,20}/);
    if (!m) return "";
    const d = m[0].match(/(20\\d{2})[.](\\d{1,2})[.](\\d{1,2})/);
    if (!d) return "";
    return d[1] + "-" + String(d[2]).padStart(2, "0") + "-" + String(d[3]).padStart(2, "0");
  };

  const parseExpectedDeliveryDate = (text) => {
    const m = normalize(text).match(/배송\\s*예정일\\s*(20\\d{2})[.\\-/년\\s]+(\\d{1,2})[.\\-/월\\s]+(\\d{1,2})/);
    if (!m) return "";
    return m[1] + "-" + String(m[2]).padStart(2, "0") + "-" + String(m[3]).padStart(2, "0");
  };

  const parseQuantity = (text) => {
    const m = normalize(text).match(/\\s(\\d+)\\s+[\\d,]+\\s*원/);
    return m ? Number(m[1]) : 1;
  };

  const parseStatus = (text) => {
    const m = normalize(text).match(
      /(배송완료|배송중|배송준비중|결제완료|주문접수|주문완료|취소완료|취소|반품완료|반품|교환완료|교환)/
    );
    return m ? m[1] : "";
  };

  const isValidInvoiceNumber = (value) => /^\\d{8,20}$/.test(String(value || "").trim());

  const mapCarrier = (carrierCode, invoiceNumber) => {
    const code = String(carrierCode || "").trim();
    const map = {
      "02": "CJ대한통운",
      "04": "롯데택배",
      "05": "한진택배",
      "06": "우체국택배",
      "08": "로젠택배",
      "11": "일양로지스"
    };
    if (map[code]) return map[code];
    if (isValidInvoiceNumber(invoiceNumber) && String(invoiceNumber).startsWith("303")) {
      return "CJ대한통운";
    }
    return "";
  };

  const buildInvoiceUrl = (carrier, invoiceNumber) => {
    const inv = String(invoiceNumber || "").trim();
    if (!isValidInvoiceNumber(inv)) return "";
    if (carrier === "CJ대한통운") {
      return "https://trace.cjlogistics.com/next/tracking.html?wblNo=" + encodeURIComponent(inv);
    }
    return "";
  };

  const cleanProductName = (text, orderNumber, orderDate, quantity, status) => {
    let v = normalize(text);
    v = v.replace(orderNumber, "");
    v = v.replace("상세보기", "");
    if (orderDate) {
      v = v.replace(orderDate.replaceAll("-", "."), "");
      v = v.replace(orderDate, "");
    }
    v = v.replace(/20\\d{2}[.]\\d{1,2}[.]\\d{1,2}\\s+Y\\d{10,20}/, "");
    v = v.replace(/Y\\d{10,20}/g, "");
    v = v.replace(/배송조회|리뷰작성|교환신청|반품신청|주문취소|오늘드림|판매종료|일시품절/g, "");
    v = v.replace(/배송\\s*예정일\\s*20\\d{2}[.]\\d{1,2}[.]\\d{1,2}/g, "");
    v = v.replace(/배송 예정일|배송예정일/g, "");
    if (status) v = v.replace(status, "");
    v = v.replace(new RegExp(quantity + "\\\\s+[\\\\d,]+\\\\s*원"), "");
    v = v.replace(/[\\d,]+\\s*원/g, "");
    v = v.replace(/\\s+/g, " ").trim();
    return v;
  };

  const rows = [...document.querySelectorAll("tr")]
    .filter(visible)
    .map((tr, index) => {
      const text = normalize(tr.innerText || tr.textContent || "");
      const deliveryButton = tr.querySelector(
        "button[data-inv-no], button[onclick*='searchTrackingPop']"
      );
      return { tr, index, text, deliveryButton };
    })
    .filter((row) => /Y\\d{10,20}|배송|원|상세보기|주문/i.test(row.text));

  let currentOrderNumber = "";
  let currentOrderDate = "";
  const orders = [];

  for (const row of rows) {
    const text = row.text;
    const dataset = row.deliveryButton ? row.deliveryButton.dataset : {};
    const orderNumberMatch = text.match(/Y\\d{10,20}/);
    const rowOrderNumber = orderNumberMatch
      ? orderNumberMatch[0]
      : (dataset && dataset.ordNo ? String(dataset.ordNo).trim() : "");
    const rowOrderDate = rowOrderNumber && orderNumberMatch ? parseOrderDate(text) : "";
    if (rowOrderNumber) currentOrderNumber = rowOrderNumber;
    if (rowOrderDate) currentOrderDate = rowOrderDate;

    const hasProductSignal =
      /원/.test(text) &&
      /(배송완료|배송중|배송준비중|결제완료|주문접수|취소|반품|교환)/.test(text);
    if (!currentOrderNumber || !currentOrderDate || !hasProductSignal) continue;

    const amount = parseAmount(text);
    const quantity = parseQuantity(text);
    const status = parseStatus(text);
    const expectedDeliveryDate = parseExpectedDeliveryDate(text);
    const invoiceRaw = dataset && dataset.invNo ? String(dataset.invNo).trim() : "";
    const invoiceNumber = isValidInvoiceNumber(invoiceRaw) ? invoiceRaw : "";
    const carrierCode = dataset && dataset.hdcCd ? String(dataset.hdcCd).trim() : "";
    const carrier = mapCarrier(carrierCode, invoiceNumber);
    const invoiceUrl = buildInvoiceUrl(carrier, invoiceNumber);

    const productName = cleanProductName(text, currentOrderNumber, currentOrderDate, quantity, status);
    if (!productName || productName.length < 3) continue;

    orders.push({
      orderNumber: currentOrderNumber,
      orderDate: currentOrderDate,
      productName,
      quantity,
      amount,
      currency: "KRW",
      shippingStatus: status,
      invoiceNumber: invoiceNumber || null,
      invoiceUrl: invoiceUrl || null,
      carrier: carrier || null,
      carrierCode: carrierCode || null,
      trackingNumber: invoiceNumber || null,
      expectedDeliveryDate: expectedDeliveryDate || null,
      tradeShipCode: dataset && dataset.tradeShpCd ? dataset.tradeShpCd : null,
      orderGoodsSeq: dataset && dataset.ordGoodsSeq ? dataset.ordGoodsSeq : null,
      goodsNo: dataset && dataset.goodsNo ? dataset.goodsNo : null,
      goodsName: dataset && dataset.goodsNm ? dataset.goodsNm : null,
      rawText: text,
      sourceRowIndex: row.index
    });
  }

  const deduped = [];
  const seen = new Set();
  for (const o of orders) {
    const key = [
      o.orderNumber, o.orderDate, o.productName, o.quantity, o.amount,
      o.shippingStatus, o.invoiceNumber || "", o.sourceRowIndex
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(o);
  }

  const result = {
    url: location.href,
    title: document.title,
    capturedAt: new Date().toISOString(),
    totalItems: deduped.length,
    orderNumbers: [...new Set(deduped.map((x) => x.orderNumber))],
    items: deduped
  };

  console.table(
    deduped.map((x) => ({
      orderNumber: x.orderNumber,
      orderDate: x.orderDate,
      productName: x.productName.slice(0, 50),
      quantity: x.quantity,
      amount: x.amount,
      status: x.shippingStatus,
      carrier: x.carrier,
      invoiceNumber: x.invoiceNumber
    }))
  );

  const json = JSON.stringify(result, null, 2);
  console.log(json);

  if (typeof copy === "function") {
    copy(json);
    console.log("[OK] OliveYoung JSON copied via DevTools copy().");
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(json);
      console.log("[OK] OliveYoung JSON copied via navigator.clipboard.");
    } catch (e) {
      console.warn("[WARN] navigator.clipboard 실패 - 위 JSON을 직접 복사해 주세요.", e);
    }
  } else {
    console.warn("[WARN] 자동 복사를 지원하지 않습니다. 위 JSON을 직접 복사해 주세요.");
  }

  return result;
})();`;

async function copyToClipboard(text: string) {
  // Prefer Electron's native clipboard via IPC — bypasses browser focus checks
  // ("Document is not focused" errors when DevTools or another window steals focus).
  if (window.api?.app?.copyToClipboard) {
    try {
      await window.api.app.copyToClipboard(text);
      return;
    } catch {
      // fall through to web APIs
    }
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fall through to legacy execCommand
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    const ok = document.execCommand("copy");
    if (!ok) {
      throw new Error("클립보드 복사에 실패했습니다.");
    }
  } finally {
    textarea.remove();
  }
}

export function OliveYoungManualImportPanel({
  siteId,
  onImported
}: OliveYoungManualImportPanelProps) {
  const [snapshotText, setSnapshotText] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const parsedPreview = useMemo(() => {
    if (!snapshotText.trim()) return null;
    try {
      const parsed = JSON.parse(snapshotText) as {
        totalItems?: number;
        orderNumbers?: string[];
        items?: unknown[];
        title?: string;
      };
      return {
        title: parsed.title ?? "-",
        totalItems: parsed.totalItems ?? parsed.items?.length ?? 0,
        orderNumberCount: parsed.orderNumbers?.length ?? 0
      };
    } catch {
      return null;
    }
  }, [snapshotText]);

  const handleCopyScript = async () => {
    try {
      await copyToClipboard(OLIVEYOUNG_CONSOLE_SCRIPT);
      toast.success("추출 스크립트를 클립보드에 복사했습니다.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "복사에 실패했습니다.");
    }
  };

  const handleImport = async () => {
    try {
      if (!snapshotText.trim()) {
        toast.error("올리브영 JSON을 붙여넣어 주세요.");
        return;
      }
      const parsedSnapshot = JSON.parse(snapshotText) as Partial<OliveYoungSnapshot>;
      if (!parsedSnapshot || !Array.isArray(parsedSnapshot.items)) {
        toast.error("올리브영 snapshot 형식이 아닙니다. items 배열이 필요합니다.");
        return;
      }
      if (parsedSnapshot.items.length === 0) {
        toast.error("저장할 주문 데이터가 없습니다.");
        return;
      }

      setImporting(true);
      const importResult = (await window.api.orders.importOliveYoungSnapshot({
        siteId,
        snapshot: parsedSnapshot as OliveYoungSnapshot
      })) as ImportResult;

      setResult(importResult);
      toast.success(
        `저장 완료: 신규 ${importResult.newOrders}건 · 업데이트 ${importResult.updatedOrders}건`
      );
      await onImported?.();
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error
          ? error.message
          : "올리브영 데이터 저장에 실패했습니다."
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            올리브영 수동 가져오기
          </h3>
          <p className="mt-0.5 text-sm text-foreground-muted">
            올리브영은 Cloudflare 차단으로 자동화가 어렵습니다. 일반 Chrome에서 로그인 후 스크립트로 JSON을 가져옵니다.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={handleCopyScript}>
          <ClipboardCopy className="h-3.5 w-3.5" />
          스크립트 복사
        </Button>
      </div>

      <div className="space-y-5 p-6">
        <ol className="grid gap-2.5 rounded-2xl border border-border bg-surface-2 px-5 py-4 text-sm leading-6 text-foreground-muted">
          <li>
            <span className="font-semibold text-foreground">1.</span> 일반 Chrome 브라우저에서 올리브영에 로그인합니다.
          </li>
          <li>
            <span className="font-semibold text-foreground">2.</span> 마이페이지 → 주문/배송 조회로 이동합니다.
          </li>
          <li>
            <span className="font-semibold text-foreground">3.</span> 위 버튼으로 복사한 스크립트를 DevTools 콘솔에 붙여넣고 실행합니다.
          </li>
          <li>
            <span className="font-semibold text-foreground">4.</span> 자동 복사된 JSON을 아래 입력창에 붙여넣고 저장 버튼을 누릅니다.
          </li>
        </ol>

        <Field
          label="올리브영 JSON 스냅샷"
          hint="DevTools 콘솔에서 자동 복사된 JSON을 그대로 붙여넣어 주세요."
        >
          <Textarea
            value={snapshotText}
            onChange={(event) => setSnapshotText(event.target.value)}
            placeholder='{"items": [...]}'
            className="h-56 font-mono text-xs"
          />
        </Field>

        {parsedPreview && (
          <div className="grid gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm md:grid-cols-3">
            <div>
              <span className="text-foreground-muted">상품: </span>
              <span className="font-semibold text-foreground">
                {parsedPreview.totalItems}
              </span>
            </div>
            <div>
              <span className="text-foreground-muted">주문번호: </span>
              <span className="font-semibold text-foreground">
                {parsedPreview.orderNumberCount}
              </span>
            </div>
            <div className="truncate">
              <span className="text-foreground-muted">제목: </span>
              <span className="font-semibold text-foreground">
                {parsedPreview.title}
              </span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={handleImport}
            loading={importing}
            disabled={importing || !snapshotText.trim()}
          >
            <Upload className="h-4 w-4" />
            저장하기
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setSnapshotText("");
              setResult(null);
            }}
            disabled={importing || !snapshotText}
          >
            지우기
          </Button>
        </div>

        {result && (
          <div className="grid gap-2 rounded-xl border border-success/20 bg-success-soft px-4 py-3 text-sm text-success-soft-foreground md:grid-cols-4">
            <div>신규 <span className="font-bold">{result.newOrders}</span></div>
            <div>업데이트 <span className="font-bold">{result.updatedOrders}</span></div>
            <div>저장 <span className="font-bold">{result.savedOrders}</span></div>
            <div>원본 주문 <span className="font-bold">{result.sourceOrderNumbers.length}</span></div>
          </div>
        )}
      </div>
    </Card>
  );
}
