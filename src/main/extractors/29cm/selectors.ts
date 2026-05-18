export const TWENTY_NINE_CM_URLS = {
  orderList: "https://www.29cm.co.kr/order/my-order/list",
  orderListCandidates: [
    "https://www.29cm.co.kr/order/my-order/list",
    "https://www.29cm.co.kr/order/my-order",
    "https://www.29cm.co.kr/my-page",
    "https://www.29cm.co.kr/mypage/"
  ],
  orderDetailBase: "https://www.29cm.co.kr/order/my-order/detail",
  deliveryTraceBase: "https://www.29cm.co.kr/order/my-order/list"
};

export const TWENTY_NINE_CM_SELECTORS = {
  orderDetailLinks: [
    "a[href*='order']",
    "a[href*='/my-order/']",
    "a[href*='order.29cm.co.kr']",
    "a[href*='orders']",
    "a[href*='mypage']",
    "a[href*='my-page']",
    "a:has-text('주문상세')",
    "a:has-text('주문 상세')",
    "a:has-text('상세보기')",
    "a:has-text('상세 보기')",
    "button:has-text('주문상세')",
    "button:has-text('주문 상세')",
    "button:has-text('상세보기')",
    "button:has-text('상세 보기')"
  ],
  trackingButtons: [
    "a:has-text('배송조회')",
    "a:has-text('배송 조회')",
    "button:has-text('배송조회')",
    "button:has-text('배송 조회')",
    "a[href*='delivery']",
    "a[href*='tracking']",
    "a[href*='trace']",
    "button:has-text('운송장')",
    "button:has-text('송장')"
  ],
  closeButtons: [
    "button:has-text('닫기')",
    "button:has-text('확인')",
    "[aria-label='닫기']"
  ]
};
