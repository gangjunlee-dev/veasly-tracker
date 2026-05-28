import { describe, expect, it } from "vitest";
import { stripLeadingNoiseFromProductText } from "./index";

// 입력은 실제 추출 dump에서 캡처한 segmentBeforeAmount 또는 raw.slice(0, amountMatch.index).
// 기대 출력은 그 segment에서 의미상 "이번 상품"의 시작 텍스트(브랜드+상품명+옵션 포함).
describe("stripLeadingNoiseFromProductText", () => {
  it("결제완료/이내배송시작 prefix가 두 번 반복된 케이스 (60962296-002)", () => {
    const input =
      "결제완료6. 5 (금) 이내 배송시작취소접수결제완료6. 5 (금) 이내 배송시작하베크 Slim fit wrap sleeveless / Black";
    expect(stripLeadingNoiseFromProductText(input)).toBe(
      "하베크 Slim fit wrap sleeveless / Black"
    );
  });

  it("배송완료/송장/액션버튼 후 다음 상품 prefix (60862282-002)", () => {
    const input =
      "배송완료5. 27 (수) 도착롯데택배 410992005502반품접수교환접수배송조회구매확정 +780원리뷰작성 +최대 1,500원배송완료5. 27 (수) 도착하 아카이브[HAH ARCHIVE] ARK BLACK MESSENGER BAG";
    expect(stripLeadingNoiseFromProductText(input)).toBe(
      "하 아카이브[HAH ARCHIVE] ARK BLACK MESSENGER BAG"
    );
  });

  it("취소완료가 날짜 없이 단독 반복되는 케이스 (60957892-002)", () => {
    const input =
      "취소완료취소상세취소완료하베크Essential crop top / Ivory[Size (교환 및 반품 불가 제품)]M";
    expect(stripLeadingNoiseFromProductText(input)).toBe(
      "하베크Essential crop top / Ivory[Size (교환 및 반품 불가 제품)]M"
    );
  });

  it("구매확정+날짜만 있고 도착 키워드는 없는 케이스 (60414291-002)", () => {
    const input =
      "배송완료5. 22 (금) 도착우체국택배 6097535544322반품접수교환접수배송조회구매확정 +2,183원리뷰작성 +최대 1,500원구매확정5. 26 (화)아캄Tread Henry Neck Half Top (Gray)[사이즈]";
    expect(stripLeadingNoiseFromProductText(input)).toBe(
      "아캄Tread Henry Neck Half Top (Gray)[사이즈]"
    );
  });

  it("CJ대한통운 송장+옵션이 길게 붙은 케이스 (60753362-002)", () => {
    const input =
      "배송완료5. 28 (목) 도착CJ대한통운 585562040256반품접수교환접수배송조회구매확정 +390원리뷰작성 +최대 500원배송완료5. 28 (목) 도착뮤즈무드White Paw (bumper) 휴대폰케이스[옵션](epoxy) [기종]아이폰";
    expect(stripLeadingNoiseFromProductText(input)).toBe(
      "뮤즈무드White Paw (bumper) 휴대폰케이스[옵션](epoxy) [기종]아이폰"
    );
  });

  it("두 번째 슬라이스 구매확정+날짜 케이스 (60102417-002)", () => {
    const input =
      "구매확정5. 22 (금)우체국택배 6091496935609반품접수교환접수배송조회리뷰작성 +최대 1,500원구매확정5. 22 (금)조스라운지(w) Strawberry Pajama Set[패키지]기본옵션";
    expect(stripLeadingNoiseFromProductText(input)).toBe(
      "조스라운지(w) Strawberry Pajama Set[패키지]기본옵션"
    );
  });

  it("split 1상품 카드 — 주문일자+주문상세+상태+날짜+상품명 (60957935 정상)", () => {
    const input =
      "주문일자2026. 5. 28주문상세결제완료6. 1 (월) 이내 배송시작오데스[38TH RESTOCK] SHELL BUTTON HALTER SLEEVELESS - NAVY";
    expect(stripLeadingNoiseFromProductText(input)).toBe(
      "오데스[38TH RESTOCK] SHELL BUTTON HALTER SLEEVELESS - NAVY"
    );
  });

  it("도착 키워드 없이 날짜만 prefix로 붙은 DB 오추출 케이스 (60542032-001 재현)", () => {
    const input =
      "주문일자2026. 5. 18주문상세구매확정5. 26 (화)조스라운지[모달] (couplers) 슬립온";
    expect(stripLeadingNoiseFromProductText(input)).toBe(
      "조스라운지[모달] (couplers) 슬립온"
    );
  });

  it("over-strip 방지 — 결과가 너무 짧으면 원본 반환", () => {
    const input = "ABC";
    expect(stripLeadingNoiseFromProductText(input)).toBe("ABC");
  });

  it("빈 입력은 빈 문자열", () => {
    expect(stripLeadingNoiseFromProductText("")).toBe("");
  });
});
