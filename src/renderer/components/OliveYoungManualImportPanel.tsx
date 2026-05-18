"use client";

import { useMemo, useState } from "react";
import type { OliveYoungSnapshot } from "../../shared/api";

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

const OLIVEYOUNG_CONSOLE_SCRIPT = "(async () => {\n  const normalize = (text) =>\n    String(text || \"\")\n      .replace(/\\s+/g, \" \")\n      .trim();\n\n  const visible = (el) =>\n    !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);\n\n  const parseAmount = (text) => {\n    const match = normalize(text).match(/([\\d,]+)\\s*원/);\n    return match ? Number(match[1].replace(/,/g, \"\")) : 0;\n  };\n\n  const parseOrderDate = (text) => {\n    const match = normalize(text).match(/(20\\d{2})[.]\\d{1,2}[.]\\d{1,2}\\s+Y\\d{10,20}/);\n    if (!match) return \"\";\n\n    const dateMatch = match[0].match(/(20\\d{2})[.](\\d{1,2})[.](\\d{1,2})/);\n    if (!dateMatch) return \"\";\n\n    return (\n      dateMatch[1] +\n      \"-\" +\n      String(dateMatch[2]).padStart(2, \"0\") +\n      \"-\" +\n      String(dateMatch[3]).padStart(2, \"0\")\n    );\n  };\n\n  const parseExpectedDeliveryDate = (text) => {\n    const match = normalize(text).match(/배송\\s*예정일\\s*(20\\d{2})[.\\-/년\\s]+(\\d{1,2})[.\\-/월\\s]+(\\d{1,2})/);\n    if (!match) return \"\";\n\n    return (\n      match[1] +\n      \"-\" +\n      String(match[2]).padStart(2, \"0\") +\n      \"-\" +\n      String(match[3]).padStart(2, \"0\")\n    );\n  };\n\n  const parseQuantity = (text) => {\n    const cleaned = normalize(text);\n    const match = cleaned.match(/\\s(\\d+)\\s+[\\d,]+\\s*원/);\n    return match ? Number(match[1]) : 1;\n  };\n\n  const parseStatus = (text) => {\n    const cleaned = normalize(text);\n    const match = cleaned.match(\n      /(배송완료|배송중|배송준비중|결제완료|주문접수|주문완료|취소완료|취소|반품완료|반품|교환완료|교환)/\n    );\n    return match ? match[1] : \"\";\n  };\n\n  const isValidInvoiceNumber = (value) => {\n    const text = String(value || \"\").trim();\n    return /^\\d{8,20}$/.test(text);\n  };\n\n  const mapCarrier = (carrierCode, invoiceNumber) => {\n    const code = String(carrierCode || \"\").trim();\n\n    const map = {\n      \"02\": \"CJ대한통운\",\n      \"04\": \"롯데택배\",\n      \"05\": \"한진택배\",\n      \"06\": \"우체국택배\",\n      \"08\": \"로젠택배\",\n      \"11\": \"일양로지스\"\n    };\n\n    if (map[code]) return map[code];\n\n    if (isValidInvoiceNumber(invoiceNumber) && String(invoiceNumber).startsWith(\"303\")) {\n      return \"CJ대한통운\";\n    }\n\n    return \"\";\n  };\n\n  const buildInvoiceUrl = (carrier, invoiceNumber) => {\n    const invoice = String(invoiceNumber || \"\").trim();\n\n    if (!isValidInvoiceNumber(invoice)) return \"\";\n\n    if (carrier === \"CJ대한통운\") {\n      return \"https://trace.cjlogistics.com/next/tracking.html?wblNo=\" + encodeURIComponent(invoice);\n    }\n\n    return \"\";\n  };\n\n  const cleanProductName = (text, orderNumber, orderDate, quantity, status) => {\n    let value = normalize(text);\n\n    value = value.replace(orderNumber, \"\");\n    value = value.replace(\"상세보기\", \"\");\n    value = value.replace(orderDate.replaceAll(\"-\", \".\"), \"\");\n    value = value.replace(orderDate, \"\");\n    value = value.replace(/20\\d{2}[.]\\d{1,2}[.]\\d{1,2}\\s+Y\\d{10,20}/, \"\");\n    value = value.replace(/Y\\d{10,20}/g, \"\");\n    value = value.replace(/배송조회/g, \"\");\n    value = value.replace(/리뷰작성/g, \"\");\n    value = value.replace(/교환신청/g, \"\");\n    value = value.replace(/반품신청/g, \"\");\n    value = value.replace(/주문취소/g, \"\");\n    value = value.replace(/오늘드림/g, \"\");\n    value = value.replace(/판매종료/g, \"\");\n    value = value.replace(/일시품절/g, \"\");\n    value = value.replace(/배송\\s*예정일\\s*20\\d{2}[.]\\d{1,2}[.]\\d{1,2}/g, \"\");\n    value = value.replace(/배송 예정일/g, \"\");\n    value = value.replace(/배송예정일/g, \"\");\n\n    if (status) value = value.replace(status, \"\");\n\n    value = value.replace(new RegExp(quantity + \"\\\\s+[\\\\d,]+\\\\s*원\"), \"\");\n    value = value.replace(/[\\d,]+\\s*원/g, \"\");\n    value = value.replace(/\\s+/g, \" \").trim();\n\n    return value;\n  };\n\n  const rows = [...document.querySelectorAll(\"tr\")]\n    .filter(visible)\n    .map((tr, index) => {\n      const text = normalize(tr.innerText || tr.textContent || \"\");\n      const deliveryButton = tr.querySelector(\n        \"button[data-inv-no], button[onclick*='searchTrackingPop']\"\n      );\n\n      return {\n        tr,\n        index,\n        text,\n        deliveryButton\n      };\n    })\n    .filter((row) => /Y\\d{10,20}|배송|원|상세보기|주문/i.test(row.text));\n\n  let currentOrderNumber = \"\";\n  let currentOrderDate = \"\";\n\n  const orders = [];\n\n  for (const row of rows) {\n    const text = row.text;\n    const dataset = row.deliveryButton ? row.deliveryButton.dataset : {};\n\n    const orderNumberMatch = text.match(/Y\\d{10,20}/);\n    const rowOrderNumber = orderNumberMatch\n      ? orderNumberMatch[0]\n      : dataset && dataset.ordNo\n        ? String(dataset.ordNo).trim()\n        : \"\";\n\n    const rowOrderDate = rowOrderNumber && orderNumberMatch ? parseOrderDate(text) : \"\";\n\n    if (rowOrderNumber) {\n      currentOrderNumber = rowOrderNumber;\n    }\n\n    if (rowOrderDate) {\n      currentOrderDate = rowOrderDate;\n    }\n\n    const hasProductSignal =\n      /원/.test(text) &&\n      /(배송완료|배송중|배송준비중|결제완료|주문접수|취소|반품|교환)/.test(text);\n\n    if (!currentOrderNumber || !currentOrderDate || !hasProductSignal) {\n      continue;\n    }\n\n    const amount = parseAmount(text);\n    const quantity = parseQuantity(text);\n    const status = parseStatus(text);\n    const expectedDeliveryDate = parseExpectedDeliveryDate(text);\n\n    const invoiceRaw = dataset && dataset.invNo ? String(dataset.invNo).trim() : \"\";\n    const invoiceNumber = isValidInvoiceNumber(invoiceRaw) ? invoiceRaw : \"\";\n    const carrierCode = dataset && dataset.hdcCd ? String(dataset.hdcCd).trim() : \"\";\n    const carrier = mapCarrier(carrierCode, invoiceNumber);\n    const invoiceUrl = buildInvoiceUrl(carrier, invoiceNumber);\n\n    const productName = cleanProductName(\n      text,\n      currentOrderNumber,\n      currentOrderDate,\n      quantity,\n      status\n    );\n\n    if (!productName || productName.length < 3) {\n      continue;\n    }\n\n    orders.push({\n      orderNumber: currentOrderNumber,\n      orderDate: currentOrderDate,\n      productName,\n      quantity,\n      amount,\n      currency: \"KRW\",\n      shippingStatus: status,\n      invoiceNumber: invoiceNumber || null,\n      invoiceUrl: invoiceUrl || null,\n      carrier: carrier || null,\n      carrierCode: carrierCode || null,\n      trackingNumber: invoiceNumber || null,\n      expectedDeliveryDate: expectedDeliveryDate || null,\n      tradeShipCode: dataset && dataset.tradeShpCd ? dataset.tradeShpCd : null,\n      orderGoodsSeq: dataset && dataset.ordGoodsSeq ? dataset.ordGoodsSeq : null,\n      goodsNo: dataset && dataset.goodsNo ? dataset.goodsNo : null,\n      goodsName: dataset && dataset.goodsNm ? dataset.goodsNm : null,\n      rawText: text,\n      sourceRowIndex: row.index\n    });\n  }\n\n  const deduped = [];\n  const seen = new Set();\n\n  for (const order of orders) {\n    const key = [\n      order.orderNumber,\n      order.orderDate,\n      order.productName,\n      order.quantity,\n      order.amount,\n      order.shippingStatus,\n      order.invoiceNumber || \"\",\n      order.sourceRowIndex\n    ].join(\"|\");\n\n    if (seen.has(key)) continue;\n\n    seen.add(key);\n    deduped.push(order);\n  }\n\n  const result = {\n    url: location.href,\n    title: document.title,\n    capturedAt: new Date().toISOString(),\n    totalItems: deduped.length,\n    orderNumbers: [...new Set(deduped.map((x) => x.orderNumber))],\n    items: deduped\n  };\n\n  console.table(\n    deduped.map((x) => ({\n      orderNumber: x.orderNumber,\n      orderDate: x.orderDate,\n      expectedDeliveryDate: x.expectedDeliveryDate,\n      productName: x.productName.slice(0, 50),\n      quantity: x.quantity,\n      amount: x.amount,\n      status: x.shippingStatus,\n      carrier: x.carrier,\n      invoiceNumber: x.invoiceNumber\n    }))\n  );\n\n  const json = JSON.stringify(result, null, 2);\n  console.log(json);\n\n  if (typeof copy === \"function\") {\n    copy(json);\n    console.log(\"[OK] OliveYoung JSON copied by DevTools copy().\");\n  } else if (navigator.clipboard && navigator.clipboard.writeText) {\n    await navigator.clipboard.writeText(json);\n    console.log(\"[OK] OliveYoung JSON copied by navigator.clipboard.\");\n  } else {\n    console.warn(\"[WARN] 자동 복사를 지원하지 않습니다. 위 JSON을 직접 복사해 주세요.\");\n  }\n\n  return result;\n})();";

async function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function OliveYoungManualImportPanel({
  siteId,
  onImported
}: OliveYoungManualImportPanelProps) {
  const [snapshotText, setSnapshotText] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
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
        url?: string;
      };

      return {
        title: parsed.title ?? "-",
        totalItems: parsed.totalItems ?? parsed.items?.length ?? 0,
        orderNumberCount: parsed.orderNumbers?.length ?? 0,
        url: parsed.url ?? "-"
      };
    } catch {
      return null;
    }
  }, [snapshotText]);

  const handleCopyScript = async () => {
    setErrorMessage("");
    setStatusMessage("");

    try {
      await copyToClipboard(OLIVEYOUNG_CONSOLE_SCRIPT);
      setStatusMessage(
        "올리브영 추출 스크립트를 복사했습니다. 일반 Chrome의 올리브영 주문/배송조회 페이지 Console에 붙여넣으세요."
      );
    } catch (error) {
      console.error(error);
      setErrorMessage(
        error instanceof Error ? error.message : "스크립트 복사에 실패했습니다."
      );
    }
  };

  const handleImport = async () => {
    setErrorMessage("");
    setStatusMessage("");
    setResult(null);

    try {
      if (!snapshotText.trim()) {
        throw new Error("올리브영 JSON을 붙여넣어 주세요.");
      }

      const parsedSnapshot = JSON.parse(snapshotText) as Partial<OliveYoungSnapshot>;

      if (!parsedSnapshot || !Array.isArray(parsedSnapshot.items)) {
        throw new Error("올리브영 snapshot 형식이 아닙니다. items 배열이 필요합니다.");
      }

      if (parsedSnapshot.items.length === 0) {
        throw new Error("저장할 주문 item이 없습니다.");
      }

      const snapshot = parsedSnapshot as OliveYoungSnapshot;

      setImporting(true);

      const importResult = (await window.api.orders.importOliveYoungSnapshot({
        siteId,
        snapshot
      })) as ImportResult;

      setResult(importResult);
      setStatusMessage(
        `저장 완료: 신규 ${importResult.newOrders}건 / 업데이트 ${importResult.updatedOrders}건 / 총 ${importResult.savedOrders}건`
      );

      await onImported?.();
    } catch (error) {
      console.error(error);
      setErrorMessage(
        error instanceof Error ? error.message : "올리브영 JSON import에 실패했습니다."
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-emerald-950">
            Olive Young Manual Import
          </h3>
          <p className="mt-1 text-sm text-emerald-800">
            Cloudflare 때문에 올리브영은 일반 Chrome에서 로그인한 뒤 JSON snapshot을 가져와 저장합니다.
          </p>
        </div>

        <button
          type="button"
          onClick={handleCopyScript}
          className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-600"
        >
          추출 스크립트 복사
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-emerald-100 bg-white p-4 text-sm text-slate-700">
        <ol className="list-decimal space-y-1 pl-5">
          <li>일반 Chrome에서 올리브영 로그인</li>
          <li>마이페이지 &gt; 주문/배송조회 이동</li>
          <li>위 버튼으로 복사한 스크립트를 Chrome DevTools Console에 붙여넣기</li>
          <li>자동 복사된 JSON을 아래 입력창에 붙여넣기</li>
          <li>업로드 버튼 클릭</li>
        </ol>
      </div>

      <div className="mt-4">
        <label className="text-xs font-bold uppercase tracking-wide text-emerald-900">
          Olive Young JSON Snapshot
        </label>
        <textarea
          value={snapshotText}
          onChange={(event) => setSnapshotText(event.target.value)}
          placeholder="일반 Chrome에서 복사된 OliveYoung JSON을 여기에 붙여넣으세요."
          className="mt-2 h-64 w-full rounded-xl border border-emerald-200 bg-white px-4 py-3 font-mono text-xs text-slate-900 outline-none ring-emerald-100 focus:ring-4"
        />
      </div>

      {parsedPreview ? (
        <div className="mt-3 grid gap-2 rounded-xl bg-white p-4 text-sm text-slate-700 md:grid-cols-3">
          <div>
            <span className="font-bold text-slate-900">Items:</span>{" "}
            {parsedPreview.totalItems}
          </div>
          <div>
            <span className="font-bold text-slate-900">Orders:</span>{" "}
            {parsedPreview.orderNumberCount}
          </div>
          <div className="truncate">
            <span className="font-bold text-slate-900">Title:</span>{" "}
            {parsedPreview.title}
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={importing}
          onClick={handleImport}
          className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          {importing ? "저장 중..." : "올리브영 주문 저장"}
        </button>

        <button
          type="button"
          disabled={importing || !snapshotText}
          onClick={() => {
            setSnapshotText("");
            setResult(null);
            setStatusMessage("");
            setErrorMessage("");
          }}
          className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
        >
          Clear
        </button>
      </div>

      {statusMessage ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm font-bold text-emerald-800">
          {statusMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {errorMessage}
        </div>
      ) : null}

      {result ? (
        <div className="mt-4 rounded-xl bg-white p-4 text-sm text-slate-700">
          <div className="grid gap-2 md:grid-cols-4">
            <div>
              <span className="font-bold text-slate-900">신규:</span>{" "}
              {result.newOrders}
            </div>
            <div>
              <span className="font-bold text-slate-900">업데이트:</span>{" "}
              {result.updatedOrders}
            </div>
            <div>
              <span className="font-bold text-slate-900">저장:</span>{" "}
              {result.savedOrders}
            </div>
            <div>
              <span className="font-bold text-slate-900">원본 주문번호:</span>{" "}
              {result.sourceOrderNumbers.length}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
