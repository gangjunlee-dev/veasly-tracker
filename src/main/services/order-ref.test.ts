import { describe, it, expect } from "vitest";
import { extractOrderRef } from "./order-ref";

describe("extractOrderRef", () => {
  it("musinsa: mypage detail URL → path 마지막 segment", () => {
    expect(
      extractOrderRef("https://www.musinsa.com/order/order-detail/202605261139420003")
    ).toEqual({ siteCode: "musinsa", ref: "202605261139420003" });
  });

  it("bunjang: order subdomain의 purchases path", () => {
    expect(
      extractOrderRef("https://order.bunjang.co.kr/purchases/95773064")
    ).toEqual({ siteCode: "bunjang", ref: "95773064" });
  });

  it("29cm: my-order/detail path", () => {
    expect(
      extractOrderRef("https://www.29cm.co.kr/order/my-order/detail/60916485")
    ).toEqual({ siteCode: "29cm", ref: "60916485" });
  });

  it("oliveyoung: ordNo 쿼리만 추출, 추적 파라미터(t_page/t_click) 무시", () => {
    const url =
      "https://www.oliveyoung.co.kr/store/mypage/getOrderDetail.do" +
      "?ordNo=Y2605260624054&operDt=2026.05.26&originBizplCd=&posNo=" +
      "&receiptNo=&dealSp=&frstReceiptNo=" +
      "&t_page=%EB%A7%88%EC%9D%B4%ED%8E%98%EC%9D%B4%EC%A7%80" +
      "&t_click=%EC%A3%BC%EB%AC%B8%EB%B2%88%ED%98%B8";
    expect(extractOrderRef(url)).toEqual({
      siteCode: "oliveyoung",
      ref: "Y2605260624054"
    });
  });

  it("naverpay: orders.pay.naver.com path, returnUrl 쿼리 무시", () => {
    expect(
      extractOrderRef(
        "https://orders.pay.naver.com/order/status/2026052676966921?returnUrl=https%3A%2F%2Fpay.naver.com%2Fpc%2Fhistory"
      )
    ).toEqual({ siteCode: "naverpay", ref: "2026052676966921" });
  });

  it("알 수 없는 도메인 → null", () => {
    expect(extractOrderRef("https://example.com/order/123")).toBeNull();
  });

  it("URL 형식이 아닌 입력 → null", () => {
    expect(extractOrderRef("not-a-url")).toBeNull();
    expect(extractOrderRef("")).toBeNull();
    expect(extractOrderRef(null)).toBeNull();
    expect(extractOrderRef(undefined)).toBeNull();
  });

  it("oliveyoung: ordNo 쿼리가 비면 null", () => {
    expect(
      extractOrderRef("https://www.oliveyoung.co.kr/store/mypage/getOrderDetail.do")
    ).toBeNull();
  });

  it("musinsa: 경로 끝 슬래시가 있어도 처리", () => {
    expect(
      extractOrderRef("https://www.musinsa.com/order/order-detail/202605261139420003/")
    ).toEqual({ siteCode: "musinsa", ref: "202605261139420003" });
  });
});
