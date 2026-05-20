import type { Page } from "playwright";
import type {
  ProgressReporter,
  StandardOrder
} from "../_base/types";
import config from "./config.json";
import {
  buildInvoiceUrl,
  extractOrdOptNoFromUrl,
  extractSourceOrderNumberFromUrl,
  makeMusinsaOrderNumber,
  mapMusinsaStatus,
  parseTrackingText
} from "./parser";
import { getBodyText, orderDateFromSourceOrderNumber } from "./page-utils";
import {
  parseDetailItemFromText,
  parseDetailItemsFromBodyText
} from "./text-parser";
import {
  collectTrackingTargets,
  openTrackingAndReadText
} from "./links";

function reportExtracting(
  progress: ProgressReporter | undefined,
  message: string,
  extra?: { current?: number; total?: number }
) {
  progress?.({
    runId: "",
    siteId: 0,
    siteCode: config.code,
    phase: "extracting",
    message,
    ...extra
  });
}

export async function extractOrdersFromDetailPage(
  page: Page,
  detailUrl: string,
  detailIndex: number,
  includeNoTracking: boolean,
  progress?: ProgressReporter
): Promise<StandardOrder[]> {
  await page.goto(detailUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(1500);

  const currentUrl = page.url();
  const bodyText = await getBodyText(page);
  const sourceOrderNumber =
    extractSourceOrderNumberFromUrl(currentUrl) ||
    bodyText.match(/\b20\d{12,}\b/)?.[0] ||
    `UNKNOWN-${detailIndex}`;

  const orderDate = orderDateFromSourceOrderNumber(sourceOrderNumber);
  const detailItems = parseDetailItemsFromBodyText(bodyText);

  reportExtracting(progress, `무신사 주문 상세 분석 중: ${sourceOrderNumber}`);

  const firstTargets = await collectTrackingTargets(page);

  reportExtracting(
    progress,
    `배송조회 버튼/URL 수집 결과: ${sourceOrderNumber} / ${firstTargets.length}건`
  );

  if (firstTargets.length === 0) {
    if (includeNoTracking && detailItems.length > 0) {
      reportExtracting(
        progress,
        `배송조회 없음: ${sourceOrderNumber} / 상품 ${detailItems.length}건을 송장 없이 저장합니다.`
      );

      return detailItems.map((item, index) => {
        const lineIndex = index + 1;

        return {
          orderNumber: makeMusinsaOrderNumber(sourceOrderNumber, lineIndex),
          orderDate,
          productName: item.productName,
          quantity: item.quantity,
          amount: item.amount,
          currency: "KRW",
          invoiceNumber: undefined,
          invoiceUrl: undefined,
          shippingStatus: item.shippingStatus,
          rawData: JSON.stringify({
            source: "musinsa",
            sourceOrderNumber,
            lineIndex,
            brandName: item.brandName,
            optionName: item.optionName,
            carrier: undefined,
            trackingNumber: undefined,
            shippingMessage: item.shippingMessage,
            detailUrl,
            trackingUrl: undefined,
            noTracking: true
          })
        };
      });
    }

    reportExtracting(
      progress,
      `배송조회 버튼/URL과 상품 row를 모두 찾지 못했습니다: ${sourceOrderNumber}`
    );

    return [];
  }

  const orders: StandardOrder[] = [];

  for (let i = 0; i < firstTargets.length; i += 1) {
    await page.goto(detailUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(1000);

    const currentTargets = await collectTrackingTargets(page);
    const trackingTarget = currentTargets[i];

    if (!trackingTarget) {
      reportExtracting(
        progress,
        `배송조회 대상 재수집 실패: ${sourceOrderNumber} / ${i + 1}`
      );
      continue;
    }

    const lineIndex = i + 1;
    const item =
      detailItems[i] ??
      parseDetailItemFromText(trackingTarget.containerText, lineIndex);

    reportExtracting(
      progress,
      `배송조회 클릭/확인 중: ${sourceOrderNumber} / ${lineIndex}/${firstTargets.length}`,
      { current: lineIndex, total: firstTargets.length }
    );

    const trackingResult = await openTrackingAndReadText(page, trackingTarget);

    const trackingText = trackingResult.trackingText;
    const finalTrackingUrl = trackingResult.trackingUrl || trackingTarget.href;

    const tracking = parseTrackingText(trackingText);

    const ordOptNo = finalTrackingUrl
      ? extractOrdOptNoFromUrl(finalTrackingUrl)
      : trackingTarget.href
        ? extractOrdOptNoFromUrl(trackingTarget.href)
        : undefined;

    const invoiceUrl =
      finalTrackingUrl &&
      finalTrackingUrl.includes("/order-service/my/delivery/trace")
        ? finalTrackingUrl
        : buildInvoiceUrl(sourceOrderNumber, ordOptNo) || trackingTarget.href;

    const trackingFallbackStatus = trackingText
      ? mapMusinsaStatus(trackingText)
      : "PENDING";
    const shippingStatus =
      tracking.trackingStatus ||
      (trackingFallbackStatus !== "PENDING"
        ? trackingFallbackStatus
        : item.shippingStatus);

    orders.push({
      orderNumber: makeMusinsaOrderNumber(sourceOrderNumber, lineIndex),
      orderDate,
      productName: item.productName,
      quantity: item.quantity,
      amount: item.amount,
      currency: "KRW",
      invoiceNumber: tracking.trackingNumber,
      invoiceUrl,
      shippingStatus,
      rawData: JSON.stringify({
        source: "musinsa",
        sourceOrderNumber,
        lineIndex,
        ordOptNo,
        brandName: item.brandName,
        optionName: item.optionName,
        carrier: tracking.carrier,
        trackingNumber: tracking.trackingNumber,
        shippingMessage: item.shippingMessage,
        detailUrl,
        trackingUrl: invoiceUrl,
        trackingButtonText: trackingTarget.text
      })
    });

    await page.goto(detailUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(800);
  }

  return orders;
}
