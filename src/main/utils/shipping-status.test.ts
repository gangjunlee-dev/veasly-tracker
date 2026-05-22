import { describe, expect, it } from "vitest";
import { normalizeShippingStatus } from "./shipping-status";

describe("normalizeShippingStatus", () => {
  it("취소 관련 상태를 canceled로 분류한다", () => {
    expect(normalizeShippingStatus("주문취소")).toBe("canceled");
    expect(normalizeShippingStatus("취소완료")).toBe("canceled");
  });

  it("환불/반품 상태를 refunded로 분류한다", () => {
    expect(normalizeShippingStatus("환불완료")).toBe("refunded");
    expect(normalizeShippingStatus("반품접수")).toBe("refunded");
  });

  it("부분배송을 partially_shipped로 분류한다", () => {
    expect(normalizeShippingStatus("부분배송")).toBe("partially_shipped");
    expect(normalizeShippingStatus("분할배송")).toBe("partially_shipped");
  });

  it("배송 진행/완료 상태를 shipped로 분류한다", () => {
    expect(normalizeShippingStatus("배송중")).toBe("shipped");
    expect(normalizeShippingStatus("배송완료")).toBe("shipped");
    expect(normalizeShippingStatus("발송완료")).toBe("shipped");
    expect(normalizeShippingStatus("구매확정")).toBe("shipped");
  });

  it("발송 준비 단계를 preparing_shipment로 분류한다", () => {
    expect(normalizeShippingStatus("배송준비중")).toBe("preparing_shipment");
    expect(normalizeShippingStatus("상품준비중")).toBe("preparing_shipment");
  });

  it("발송 대기 단계를 awaiting_shipment로 분류한다", () => {
    expect(normalizeShippingStatus("발송대기")).toBe("awaiting_shipment");
    expect(normalizeShippingStatus("배송대기")).toBe("awaiting_shipment");
  });

  it("결제/주문 완료 단계를 purchased로 분류한다", () => {
    expect(normalizeShippingStatus("결제완료")).toBe("purchased");
    expect(normalizeShippingStatus("주문접수")).toBe("purchased");
  });

  it("'배송준비중'을 'shipped'로 오분류하지 않는다", () => {
    // "배송준비중"은 "배송중"을 부분 문자열로 포함하지 않음을 확인
    expect(normalizeShippingStatus("배송준비중")).not.toBe("shipped");
  });

  it("공백이 섞이거나 앞뒤 여백이 있어도 정규화한다", () => {
    expect(normalizeShippingStatus("배송 준비중")).toBe("preparing_shipment");
    expect(normalizeShippingStatus("  배송완료  ")).toBe("shipped");
  });

  it("알 수 없는 텍스트와 빈 값은 unknown으로 둔다", () => {
    expect(normalizeShippingStatus("교환요청")).toBe("unknown");
    expect(normalizeShippingStatus("")).toBe("unknown");
    expect(normalizeShippingStatus(null)).toBe("unknown");
    expect(normalizeShippingStatus(undefined)).toBe("unknown");
  });

  it("판별 불가 + 송장 있음이면 shipped로 보정한다", () => {
    expect(normalizeShippingStatus("", { hasTracking: true })).toBe("shipped");
    expect(normalizeShippingStatus("교환요청", { hasTracking: true })).toBe(
      "shipped"
    );
  });

  it("상태 텍스트가 명확하면 송장 유무로 덮어쓰지 않는다", () => {
    // 준비중인데 송장이 있는 데이터 충돌 — 원 판정을 유지하고
    // 충돌 해소는 '미발송' 판정 단계로 미룬다.
    expect(normalizeShippingStatus("상품준비중", { hasTracking: true })).toBe(
      "preparing_shipment"
    );
    expect(normalizeShippingStatus("주문취소", { hasTracking: true })).toBe(
      "canceled"
    );
  });

  it("영문 상태 텍스트도 분류한다", () => {
    expect(normalizeShippingStatus("Shipped")).toBe("shipped");
    expect(normalizeShippingStatus("Preparing")).toBe("preparing_shipment");
    expect(normalizeShippingStatus("Canceled")).toBe("canceled");
  });
});
