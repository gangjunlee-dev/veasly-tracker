import fs from "node:fs";
import path from "node:path";

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: node scripts/musinsa-parse-snapshot.mjs <order-list.txt>");
  process.exit(1);
}

const absInputPath = path.resolve(inputPath);
const rawText = fs.readFileSync(absInputPath, "utf8");

const lines = rawText
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

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
  ].includes(line);
}

function isAmountLine(line) {
  return /^[\d,]+원$/.test(line);
}

function parseAmount(line) {
  return Number(line.replace(/[^\d]/g, ""));
}

function parseOptionAndQuantity(line) {
  const match = line.match(/^(.*?)\s*\/\s*(\d+)개$/);

  if (!match) {
    return {
      optionName: line,
      quantity: 1
    };
  }

  return {
    optionName: match[1].trim(),
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

function parseMusinsaText(lines) {
  let currentDate = "";
  let sequence = 0;
  const orders = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (isDateLine(line)) {
      currentDate = parseDate(line);
      continue;
    }

    if (!isStatusLine(line)) {
      continue;
    }

    const originalStatus = line;
    let cursor = i + 1;

    let shippingMessage = "";
    if (
      lines[cursor] &&
      (lines[cursor].includes("출고 예정") ||
        lines[cursor].includes("배송") ||
        lines[cursor].includes("도착"))
    ) {
      shippingMessage = lines[cursor];
      cursor += 1;
    }

    while (lines[cursor] && isActionLine(lines[cursor])) {
      cursor += 1;
    }

    const brandName = lines[cursor];
    const productName = lines[cursor + 1];
    const optionQuantityLine = lines[cursor + 2];
    const amountLine = lines[cursor + 3];

    if (!brandName || !productName || !optionQuantityLine || !amountLine) {
      continue;
    }

    if (!isAmountLine(amountLine)) {
      continue;
    }

    sequence += 1;

    const { optionName, quantity } = parseOptionAndQuantity(optionQuantityLine);
    const amount = parseAmount(amountLine);
    const orderDate = currentDate || new Date().toISOString().slice(0, 10);
    const lineNo = String(sequence).padStart(3, "0");

    orders.push({
      orderNumber: `MUSINSA-${compactDate(orderDate)}-${lineNo}`,
      sourceOrderNumber: null,
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
      carrier: null,
      trackingNumber: null,
      invoiceNumber: null,
      invoiceUrl: null,
      rawData: {
        source: "musinsa-order-list-text",
        originalStatus,
        shippingMessage,
        brandName,
        optionName
      }
    });
  }

  return orders;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(orders) {
  const header = [
    "orderNumber",
    "orderDate",
    "brandName",
    "productName",
    "optionName",
    "quantity",
    "amount",
    "shippingStatus",
    "shippingMessage",
    "carrier",
    "trackingNumber"
  ];

  const rows = orders.map((order) => [
    order.orderNumber,
    order.orderDate,
    order.brandName,
    order.productName,
    order.optionName,
    order.quantity,
    order.amount,
    order.shippingStatus,
    order.shippingMessage,
    order.carrier ?? "",
    order.trackingNumber ?? ""
  ]);

  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

const orders = parseMusinsaText(lines);

const outDir = path.dirname(absInputPath);
const baseName = path.basename(absInputPath, ".txt");
const jsonPath = path.join(outDir, `${baseName}-parsed.json`);
const csvPath = path.join(outDir, `${baseName}-parsed.csv`);

fs.writeFileSync(jsonPath, JSON.stringify(orders, null, 2), "utf8");
fs.writeFileSync(csvPath, toCsv(orders), "utf8");

console.log("[musinsa-parser] input:", absInputPath);
console.log("[musinsa-parser] parsed items:", orders.length);
console.log("[musinsa-parser] json:", jsonPath);
console.log("[musinsa-parser] csv:", csvPath);

console.table(
  orders.slice(0, 20).map((order) => ({
    orderNumber: order.orderNumber,
    date: order.orderDate,
    brand: order.brandName,
    product: order.productName.slice(0, 40),
    qty: order.quantity,
    amount: order.amount,
    status: order.shippingStatus
  }))
);