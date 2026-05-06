import fs from "node:fs";
import path from "node:path";

const detailPath = process.argv[2];
const trackingPaths = process.argv.slice(3);

if (!detailPath || trackingPaths.length === 0) {
  console.error("Usage:");
  console.error("node scripts/musinsa-parse-detail-tracking.mjs <order-detail.txt> <tracking-01.txt> <tracking-02.txt> ...");
  process.exit(1);
}

function readLines(filePath) {
  return fs
    .readFileSync(path.resolve(filePath), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isDateLine(line) {
  return /^\d{2}\.\d{2}\.\d{2}\(.+\)$/.test(line);
}

function parseDate(line) {
  const match = line.match(/^(\d{2})\.(\d{2})\.(\d{2})/);
  if (!match) return "";

  const year = Number(match[1]);
  const fullYear = year >= 70 ? 1900 + year : 2000 + year;

  return `${fullYear}-${match[2]}-${match[3]}`;
}

function isStatusLine(line) {
  return [
    "결제 완료",
    "상품 준비 중",
    "결제오류",
    "배송 중",
    "배송중",
    "배송 완료",
    "배송완료",
    "구매 확정",
    "주문 취소",
    "취소 완료",
    "취소 요청",
    "반품 요청",
    "교환 요청"
  ].includes(line);
}

function isActionLine(line) {
  return [
    "판매자 정보",
    "주문 상세",
    "주문 취소",
    "옵션 변경",
    "스냅 보기",
    "취소 요청",
    "배송 조회",
    "배송조회",
    "구매 확정",
    "리뷰 작성",
    "교환 요청",
    "반품 요청"
  ].includes(line) || line.startsWith("구매 확정");
}

function isAmountLine(line) {
  return /^[\d,]+원$/.test(line);
}

function parseAmount(line) {
  return Number(line.replace(/[^\d]/g, ""));
}

function parseOptionAndQuantity(line) {
  const normalized = line.replace(/\s+\/\s+/g, " / ");
  const match = normalized.match(/^(.*?)\s*\/\s*(\d+)\s*개$/);

  if (!match) {
    return {
      optionName: line.replace(/\s+/g, " ").trim(),
      quantity: 1
    };
  }

  return {
    optionName: match[1].replace(/\s+/g, " ").trim(),
    quantity: Number(match[2])
  };
}

function mapStatus(status) {
  if (status.includes("배송 완료") || status.includes("배송완료")) return "DELIVERED";
  if (status.includes("배송 중") || status.includes("배송중")) return "SHIPPED";
  if (status.includes("상품 준비")) return "READY";
  if (status.includes("결제 완료")) return "PAID";
  if (status.includes("결제오류")) return "PAYMENT_ERROR";
  if (status.includes("취소")) return "CANCELLED";
  return "PENDING";
}

function compactDate(date) {
  return date.replaceAll("-", "");
}

function extractNextValue(lines, label) {
  const index = lines.findIndex((line) => line === label);
  if (index < 0) return "";

  for (let i = index + 1; i < lines.length; i += 1) {
    const value = lines[i]?.trim();
    if (value) return value;
  }

  return "";
}

function parseTrackingText(filePath) {
  const lines = readLines(filePath);
  const text = lines.join("\n");

  const carrier = extractNextValue(lines, "택배사");
  const trackingNumber = extractNextValue(lines, "송장 번호");

  let productName = "";
  let optionQuantityLine = "";
  let amountLine = "";
  let statusMessage = "";

  const orderDetailIndex = lines.findIndex((line) => line === "주문 상세");

  if (orderDetailIndex >= 0) {
    for (let i = orderDetailIndex + 1; i < lines.length; i += 1) {
      if (isAmountLine(lines[i])) {
        amountLine = lines[i];
        optionQuantityLine = lines[i - 1] ?? "";
        productName = lines[i - 2] ?? "";
        break;
      }
    }
  }

  const deliveryMessageIndex = lines.findIndex((line) => line === "배송 조회");
  if (deliveryMessageIndex >= 0) {
    statusMessage = lines[deliveryMessageIndex + 1] ?? "";
  }

  const urlPath = filePath.replace(/\.txt$/, ".url.txt");
  const invoiceUrl = fs.existsSync(urlPath)
    ? fs.readFileSync(urlPath, "utf8").trim()
    : "";

  return {
    filePath,
    carrier,
    trackingNumber,
    invoiceNumber: trackingNumber,
    invoiceUrl,
    productName,
    optionQuantityLine,
    amountLine,
    statusMessage,
    rawText: text
  };
}

function parseDetailText(filePath) {
  const lines = readLines(filePath);

  const orderNumberLine = lines.find((line) => line.startsWith("주문번호 "));
  const sourceOrderNumber = orderNumberLine
    ? orderNumberLine.replace("주문번호", "").trim()
    : "";

  const dateLine = lines.find(isDateLine);
  const orderDate = dateLine ? parseDate(dateLine) : new Date().toISOString().slice(0, 10);

  const stopIndex = lines.findIndex((line) => line === "결제 정보");
  const scanLines = stopIndex >= 0 ? lines.slice(0, stopIndex) : lines;

  const items = [];
  let sequence = 0;

  for (let i = 0; i < scanLines.length; i += 1) {
    const line = scanLines[i];

    if (!isStatusLine(line)) continue;

    const originalStatus = line;
    let cursor = i + 1;

    let shippingMessage = "";
    if (
      scanLines[cursor] &&
      (scanLines[cursor].includes("도착") ||
        scanLines[cursor].includes("출고 예정") ||
        scanLines[cursor].includes("배송"))
    ) {
      shippingMessage = scanLines[cursor];
      cursor += 1;
    }

    while (scanLines[cursor] && isActionLine(scanLines[cursor])) {
      cursor += 1;
    }

    const brandName = scanLines[cursor];

    if (scanLines[cursor + 1] === "판매자 정보") {
      cursor += 1;
    }

    const productName = scanLines[cursor + 1];
    const optionQuantityLine = scanLines[cursor + 2];
    const amountLine = scanLines[cursor + 3];

    if (!brandName || !productName || !optionQuantityLine || !amountLine) {
      continue;
    }

    if (!isAmountLine(amountLine)) {
      continue;
    }

    sequence += 1;

    const { optionName, quantity } = parseOptionAndQuantity(optionQuantityLine);
    const amount = parseAmount(amountLine);
    const lineNo = String(sequence).padStart(3, "0");

    items.push({
      orderNumber: `MUSINSA-${sourceOrderNumber || compactDate(orderDate)}-${lineNo}`,
      sourceOrderNumber,
      sourceLineIndex: sequence,
      orderDate,
      brandName,
      productName,
      optionName,
      quantity,
      amount,
      currency: "KRW",
      originalStatus,
      shippingStatus: mapStatus(originalStatus),
      shippingMessage,
      carrier: "",
      trackingNumber: "",
      invoiceNumber: "",
      invoiceUrl: "",
      rawData: {
        source: "musinsa-order-detail-text",
        originalStatus,
        shippingMessage,
        brandName,
        optionName
      }
    });
  }

  return {
    sourceOrderNumber,
    orderDate,
    items
  };
}

function normalizeProductName(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function attachTracking(items, trackingList) {
  const used = new Set();

  return items.map((item, index) => {
    const itemName = normalizeProductName(item.productName);

    let trackingIndex = trackingList.findIndex((tracking, candidateIndex) => {
      if (used.has(candidateIndex)) return false;

      const trackingName = normalizeProductName(tracking.productName);

      return trackingName && (trackingName === itemName || trackingName.includes(itemName) || itemName.includes(trackingName));
    });

    if (trackingIndex < 0 && trackingList[index] && !used.has(index)) {
      trackingIndex = index;
    }

    if (trackingIndex < 0) return item;

    used.add(trackingIndex);

    const tracking = trackingList[trackingIndex];

    return {
      ...item,
      carrier: tracking.carrier,
      trackingNumber: tracking.trackingNumber,
      invoiceNumber: tracking.invoiceNumber,
      invoiceUrl: tracking.invoiceUrl,
      rawData: {
        ...item.rawData,
        trackingStatusMessage: tracking.statusMessage,
        trackingFile: path.basename(tracking.filePath)
      }
    };
  });
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(items) {
  const header = [
    "orderNumber",
    "sourceOrderNumber",
    "orderDate",
    "brandName",
    "productName",
    "optionName",
    "quantity",
    "amount",
    "shippingStatus",
    "shippingMessage",
    "carrier",
    "trackingNumber",
    "invoiceUrl"
  ];

  const rows = items.map((item) => [
    item.orderNumber,
    item.sourceOrderNumber,
    item.orderDate,
    item.brandName,
    item.productName,
    item.optionName,
    item.quantity,
    item.amount,
    item.shippingStatus,
    item.shippingMessage,
    item.carrier,
    item.trackingNumber,
    item.invoiceUrl
  ]);

  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

const detail = parseDetailText(detailPath);
const trackingList = trackingPaths.map(parseTrackingText);
const mergedItems = attachTracking(detail.items, trackingList);

const outDir = path.dirname(path.resolve(detailPath));
const baseName = path.basename(detailPath, ".txt");

const jsonPath = path.join(outDir, `${baseName}-merged-tracking.json`);
const csvPath = path.join(outDir, `${baseName}-merged-tracking.csv`);

fs.writeFileSync(jsonPath, JSON.stringify(mergedItems, null, 2), "utf8");
fs.writeFileSync(csvPath, toCsv(mergedItems), "utf8");

console.log("[musinsa-detail-tracking-parser] detail:", path.resolve(detailPath));
console.log("[musinsa-detail-tracking-parser] tracking files:", trackingPaths.length);
console.log("[musinsa-detail-tracking-parser] source order:", detail.sourceOrderNumber);
console.log("[musinsa-detail-tracking-parser] parsed items:", mergedItems.length);
console.log("[musinsa-detail-tracking-parser] json:", jsonPath);
console.log("[musinsa-detail-tracking-parser] csv:", csvPath);

console.table(
  mergedItems.map((item) => ({
    orderNumber: item.orderNumber,
    product: item.productName.slice(0, 36),
    status: item.shippingStatus,
    carrier: item.carrier,
    tracking: item.trackingNumber ? `${item.trackingNumber.slice(0, 4)}****${item.trackingNumber.slice(-4)}` : "",
    amount: item.amount
  }))
);