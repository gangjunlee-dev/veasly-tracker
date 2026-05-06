export const MUSINSA_URLS = {
  orderList: "https://www.musinsa.com/order/order-list",
  orderDetailBase: "https://www.musinsa.com/order/order-detail",
  deliveryTraceBase: "https://www.musinsa.com/order-service/my/delivery/trace"
};

export const MUSINSA_SELECTORS = {
  orderDetailLinks: [
    "a[href*='/order/order-detail/']"
  ],
  trackingButtons: [
    "a[href*='/order-service/my/delivery/trace']",
    "button:has-text('배송 조회')",
    "button:has-text('배송조회')",
    "a:has-text('배송 조회')",
    "a:has-text('배송조회')"
  ],
  closeButtons: [
    "button:has-text('닫기')",
    "button:has-text('확인')",
    "[aria-label='닫기']"
  ]
};
