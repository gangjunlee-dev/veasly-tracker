import { describe, expect, it } from "vitest";
import {
  buildInvoiceUrl,
  extractOrdOptNoFromUrl,
  extractSourceOrderNumberFromUrl,
  makeMusinsaOrderNumber,
  mapMusinsaStatus,
  parseMoney,
  parseTrackingText
} from "./parser";

describe("parseMoney", () => {
  it("returns 0 for empty/undefined input", () => {
    expect(parseMoney(undefined)).toBe(0);
    expect(parseMoney("")).toBe(0);
  });

  it("parses Korean won string with thousand separators", () => {
    expect(parseMoney("1,234,567원")).toBe(1234567);
  });

  it("parses plain digit string", () => {
    expect(parseMoney("89000원")).toBe(89000);
  });

  it("strips all non-digit characters", () => {
    expect(parseMoney(" KRW  12,345 원 (할인 포함)")).toBe(12345);
  });
});

describe("mapMusinsaStatus", () => {
  it("maps 결제 완료 → PAID", () => {
    expect(mapMusinsaStatus("결제 완료")).toBe("PAID");
  });

  it("maps 상품 준비 중 → READY", () => {
    expect(mapMusinsaStatus("상품 준비 중")).toBe("READY");
  });

  it("maps 배송 중 → SHIPPED", () => {
    expect(mapMusinsaStatus("배송 중")).toBe("SHIPPED");
  });

  it("maps 배송 완료 → DELIVERED", () => {
    expect(mapMusinsaStatus("배송 완료")).toBe("DELIVERED");
  });

  it("maps 취소 완료 → CANCELLED", () => {
    expect(mapMusinsaStatus("취소 완료")).toBe("CANCELLED");
  });

  it("maps 결제 오류 → PAYMENT_ERROR", () => {
    expect(mapMusinsaStatus("결제 오류")).toBe("PAYMENT_ERROR");
  });

  it("does NOT mistake '주문 취소' action button for CANCELLED", () => {
    expect(mapMusinsaStatus("주문 취소")).toBe("PENDING");
  });

  it("ignores action buttons mixed in with status text", () => {
    expect(mapMusinsaStatus("결제 완료 주문 취소 스냅 보기")).toBe("PAID");
  });

  it("returns PENDING for unrecognised text", () => {
    expect(mapMusinsaStatus("???")).toBe("PENDING");
  });
});

describe("extractSourceOrderNumberFromUrl", () => {
  it("extracts numeric id from order-detail URL", () => {
    expect(
      extractSourceOrderNumberFromUrl(
        "https://www.musinsa.com/order/order-detail/20240512000123456"
      )
    ).toBe("20240512000123456");
  });

  it("returns undefined for unrelated URL", () => {
    expect(
      extractSourceOrderNumberFromUrl("https://www.musinsa.com/")
    ).toBeUndefined();
  });
});

describe("extractOrdOptNoFromUrl", () => {
  it("extracts ord_opt_no from delivery trace URL", () => {
    expect(
      extractOrdOptNoFromUrl(
        "https://www.musinsa.com/order-service/my/delivery/trace?ord_no=1&ord_opt_no=99"
      )
    ).toBe("99");
  });

  it("returns undefined when ord_opt_no is absent", () => {
    expect(
      extractOrdOptNoFromUrl(
        "https://www.musinsa.com/order-service/my/delivery/trace?ord_no=1"
      )
    ).toBeUndefined();
  });
});

describe("buildInvoiceUrl", () => {
  it("returns undefined when either field is missing", () => {
    expect(buildInvoiceUrl("", "1")).toBeUndefined();
    expect(buildInvoiceUrl("1", undefined)).toBeUndefined();
  });

  it("builds delivery trace URL with both ord_no and ord_opt_no", () => {
    const url = buildInvoiceUrl("20240512", "99");
    expect(url).toContain("ord_no=20240512");
    expect(url).toContain("ord_opt_no=99");
    expect(url).toContain("/order-service/my/delivery/trace");
  });
});

describe("makeMusinsaOrderNumber", () => {
  it("composes MUSINSA-<source>-<lineIndex padded to 3>", () => {
    expect(makeMusinsaOrderNumber("12345", 7)).toBe("MUSINSA-12345-007");
    expect(makeMusinsaOrderNumber("12345", 1)).toBe("MUSINSA-12345-001");
  });
});

describe("parseTrackingText", () => {
  it("extracts carrier from same line as label", () => {
    const result = parseTrackingText("택배사: CJ대한통운\n송장번호: 1234567890");
    expect(result.carrier).toBe("CJ대한통운");
    expect(result.trackingNumber).toBe("1234567890");
  });

  it("extracts carrier from next line when label-only", () => {
    const result = parseTrackingText("택배사\n한진택배\n송장번호\n9876543210");
    expect(result.carrier).toBe("한진택배");
    expect(result.trackingNumber).toBe("9876543210");
  });

  it("falls back to first plausible digit run if no labels", () => {
    const result = parseTrackingText("도착 예정 1234567890\n주문");
    expect(result.trackingNumber).toBe("1234567890");
  });

  it("returns DELIVERED status when text contains 배송 완료", () => {
    const result = parseTrackingText("배송 완료\n송장번호: 1234567890");
    expect(result.trackingStatus).toBe("DELIVERED");
  });
});
