export const SELECTORS = {
  login: {
    usernameInput: "#username",
    passwordInput: "#password",
    submitButton: "button[type='submit']",
    captcha: "[data-captcha], .captcha, iframe[src*='captcha']"
  },
  orders: {
    row: ".order-row",
    date: ".order-date",
    orderNumber: ".order-number",
    productName: ".product-name",
    quantity: ".quantity",
    amount: ".amount",
    invoiceNumber: ".invoice-number",
    invoiceUrl: "a.invoice-link",
    shippingStatus: ".shipping-status",
    nextPageButton: "button.next-page"
  }
} as const;
