export const OLIVEYOUNG_URLS = {
  login: "https://www.oliveyoung.co.kr/store/login/loginForm.do",
  orderListCandidates: [
    "https://www.oliveyoung.co.kr/store/mypage/getOrderList.do",
    "https://www.oliveyoung.co.kr/store/mypage/getOrderList.do?ordTmcCd=10",
    "https://www.oliveyoung.co.kr/store/mypage/getOrderList.do?ordTmcCd=20",
    "https://m.oliveyoung.co.kr/m/mypage/getOrderList.do"
  ]
};

export const OLIVEYOUNG_SELECTORS = {
  usernameInputs: [
    "input[name='mbrId']",
    "input[name='loginId']",
    "input[name='userId']",
    "input[id*='login']",
    "input[id*='id']",
    "input[placeholder*='아이디']",
    "input[placeholder*='이메일']",
    "input[type='email']",
    "input[type='text']"
  ],
  passwordInputs: [
    "input[name='password']",
    "input[name='pwd']",
    "input[name='mbrPwd']",
    "input[id*='password']",
    "input[id*='pwd']",
    "input[placeholder*='비밀번호']",
    "input[type='password']"
  ],
  loginButtons: [
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('로그인')",
    "a:has-text('로그인')",
    "input[value*='로그인']"
  ],
  orderLinks: [
    "a[href*='order']",
    "a[href*='Order']",
    "a[href*='ord']",
    "a[href*='mypage']",
    "a:has-text('주문')",
    "a:has-text('배송')",
    "button:has-text('주문')",
    "button:has-text('배송')"
  ]
};
