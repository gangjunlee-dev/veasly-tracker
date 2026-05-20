import { describe, expect, it } from "vitest";
import {
  cleanProductName,
  isInvalidProductName,
  isLikelyProductAmountLine,
  isMusinsaActionButtonLine,
  parseQuantityAndOption,
  pickMusinsaStatusLine
} from "./text-parser";

describe("isMusinsaActionButtonLine", () => {
  it.each([
    ["주문 취소", true],
    ["취소 요청", true],
    ["옵션 변경", true],
    ["스냅 보기", true],
    ["주문 취소 완료", false],
    ["배송 완료", false],
    ["", false]
  ])("line %j → %j", (line, expected) => {
    expect(isMusinsaActionButtonLine(line)).toBe(expected);
  });
});

describe("pickMusinsaStatusLine", () => {
  it("returns exact match status text when present", () => {
    expect(pickMusinsaStatusLine(["배송 완료"])).toBe("배송 완료");
  });

  it("ignores action button '주문 취소' even when present alone", () => {
    expect(pickMusinsaStatusLine(["주문 취소"])).toBeUndefined();
  });

  it("collapses combined status text to canonical value", () => {
    expect(
      pickMusinsaStatusLine(["결제 완료 05.12(화) 이내 출고 예정"])
    ).toBe("결제 완료");
  });

  it("prefers 취소 완료 over plain 결제 완료 when both appear", () => {
    expect(
      pickMusinsaStatusLine(["결제 완료", "취소 완료"])
    ).toBe("취소 완료");
  });

  it("returns undefined when no status keyword present", () => {
    expect(pickMusinsaStatusLine(["임의 텍스트"])).toBeUndefined();
  });
});

describe("parseQuantityAndOption", () => {
  it("returns 1 quantity for empty input", () => {
    expect(parseQuantityAndOption(undefined)).toEqual({ quantity: 1 });
  });

  it("parses quantity from '<option> / N개'", () => {
    expect(parseQuantityAndOption("BLACK / 2개")).toEqual({
      optionName: "BLACK",
      quantity: 2
    });
  });

  it("strips '옵션:' prefix", () => {
    expect(parseQuantityAndOption("옵션: M / 1개")).toEqual({
      optionName: "M",
      quantity: 1
    });
  });
});

describe("isLikelyProductAmountLine", () => {
  it("matches a price line preceded by quantity line", () => {
    expect(isLikelyProductAmountLine("89,000원", "BLACK / 1개")).toBe(true);
  });

  it("rejects a price line preceded by unrelated text", () => {
    expect(isLikelyProductAmountLine("89,000원", "어떤 상품 이름")).toBe(false);
  });

  it("rejects a non-price line", () => {
    expect(isLikelyProductAmountLine("어떤 상품", "BLACK / 1개")).toBe(false);
  });
});

describe("isInvalidProductName", () => {
  it.each([
    ["판매자 정보", true],
    ["주문번호", true],
    ["89,000원", true],
    ["1개", true],
    ["스냅 보기", true],
    ["무신사", true],
    ["", true],
    ["적당한 상품명", false]
  ])("line %j → %j", (line, expected) => {
    expect(isInvalidProductName(line)).toBe(expected);
  });
});

describe("cleanProductName", () => {
  it("strips trailing '/ N개'", () => {
    expect(cleanProductName("멋진 티셔츠 / 1개")).toBe("멋진 티셔츠");
  });

  it("leaves a clean name alone", () => {
    expect(cleanProductName("멋진 티셔츠")).toBe("멋진 티셔츠");
  });
});
