/**
 * Veasly Admin API 클라이언트
 * admin.veasly.com과 통신하여 주문 데이터를 가져온다.
 */

const ADMIN_URL = "https://admin.veasly.com";
const API_URL = "https://api.veasly.com";

export interface AdminCredentials {
  username: string;
  password: string;
}

export interface AdminSession {
  accessToken: string;
  refreshToken: string;
  user: { id: number; name: string; role: string };
  expires: string;
}

/** NextAuth CSRF → 로그인 → 세션 토큰 획득 */
export async function adminLogin(
  creds: AdminCredentials
): Promise<AdminSession> {
  // 1) CSRF
  const csrfRes = await fetch(`${ADMIN_URL}/api/auth/csrf`);
  const csrfData = (await csrfRes.json()) as { csrfToken: string };
  const cookies = csrfRes.headers.getSetCookie?.() || [];
  const cookieStr = cookies.map((s) => s.split(";")[0]).join("; ");

  // 2) 로그인
  const loginRes = await fetch(
    `${ADMIN_URL}/api/auth/callback/credentials`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieStr,
      },
      body: new URLSearchParams({
        providerId: creds.username,
        password: creds.password,
        redirect: "false",
        csrfToken: csrfData.csrfToken,
        callbackUrl: `${ADMIN_URL}/auth/sign-in`,
        json: "true",
      }).toString(),
      redirect: "manual",
    }
  );

  // 3) 세션 쿠키 수집
  const loginCookies = loginRes.headers.getSetCookie?.() || [];
  const allCookies = [...cookies, ...loginCookies]
    .map((s) => s.split(";")[0])
    .join("; ");

  // 4) 세션에서 토큰 획득
  const sessionRes = await fetch(`${ADMIN_URL}/api/auth/session`, {
    headers: { Cookie: allCookies },
  });
  const session = (await sessionRes.json()) as any;

  if (!session?.account?.accessToken) {
    throw new Error("Admin 로그인 실패: 토큰을 찾을 수 없습니다");
  }

  return {
    accessToken: session.account.accessToken,
    refreshToken: session.account.refreshToken,
    user: session.user,
    expires: session.expires,
  };
}

/** 인증 헤더 생성 */
function authHeader(token: string): Record<string, string> {
  return {
    Authorization: token.startsWith("Bearer") ? token : `Bearer ${token}`,
  };
}

/** 주문 목록 조회 (query 검색 지원) */
export async function fetchOrders(
  token: string,
  opts: {
    page?: number;
    take?: number;
    status?: string;
    query?: string;
    queryType?: string;
  } = {}
): Promise<{ totalCount: number; data: any[] }> {
  const { page = 0, take = 100, status, query, queryType } = opts;
  let url = `${API_URL}/admin/orders/${page}/${take}`;
  const params = new URLSearchParams();
  if (status) params.set("orderStatus", status);
  if (query) params.set("query", query);
  if (queryType) params.set("queryType", queryType);
  const qs = params.toString();
  if (qs) url += `?${qs}`;

  const res = await fetch(url, { headers: authHeader(token) });
  if (!res.ok) throw new Error(`주문 목록 조회 실패: ${res.status}`);
  return res.json() as Promise<{ totalCount: number; data: any[] }>;
}

/** 주문 상세 조회 */
export async function fetchOrderDetail(
  token: string,
  orderNumber: string
): Promise<any[]> {
  const res = await fetch(
    `${API_URL}/admin/orders/${orderNumber}/detail`,
    { headers: authHeader(token) }
  );
  if (!res.ok) return [];
  const data = await res.json();
  if (data?.statusCode) return []; // 500 등 에러
  return Array.isArray(data) ? data : [];
}

/** 합배송 기본 정보 */
export async function fetchCombinedBase(
  token: string,
  orderNumber: string
): Promise<any | null> {
  try {
    const res = await fetch(
      `${API_URL}/admin/orders/${orderNumber}/combined-shipping-base`,
      { headers: authHeader(token) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.result === false || data.statusCode) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * 주문 1건의 전체 데이터를 수집하여 정규화된 형태로 반환.
 * detail API + 목록 API(payment) + combined API 모두 시도.
 */
export interface AdminOrderData {
  orderNumber: string;
  orderedAt: string;
  status: string;
  totalAmountLocal: number;
  currency: string;
  isCombined: boolean;
  hasFreeShipping: boolean;
  customerName: string;
  shippingAddressType: string;
  items: AdminItemData[];
}

export interface AdminItemData {
  orderItemNumber: string;
  productName: string;
  brand: string;
  detailUrl: string;
  priceLocal: number;
  priceKRW: number;
  quantity: number;
  estimatedWeight: number;
  status: string;
  isFreeShipping: boolean;
  isCancelled: boolean;
  purchaseUrl: string | null;
  purchasePrice: number | null;
  cardApprovalCode: string | null;
  cardProvider: string | null;
  domesticTracking: string | null;
  overseasTracking: string | null;
  overseasVendor: string | null;
}

export async function fetchFullOrder(
  token: string,
  orderNumber: string
): Promise<AdminOrderData | null> {
  // 1) 목록에서 payment 정보
  const listData = await fetchOrders(token, {
    query: orderNumber,
    queryType: "ORDER_NUMBER",
    take: 5,
  });
  const listOrder = listData.data.find(
    (o: any) => o.orderNumber === orderNumber
  );
  if (!listOrder) return null;

  // 2) 상세 (일반 주문)
  let detailItems = await fetchOrderDetail(token, orderNumber);

  // 3) 합배송 확인
  let isCombined = false;
  const combined = await fetchCombinedBase(token, orderNumber);
  if (combined && combined.payment) {
    isCombined = true;
  }

  // 합배송인데 detail이 빈 경우 → combined-detail에서 아이템 가져오기
  if (isCombined && detailItems.length === 0) {
    try {
      const detRes = await fetch(
        `${API_URL}/admin/orders/${orderNumber}/combined-shipping-detail`,
        { headers: authHeader(token) }
      );
      if (detRes.ok) {
        const detData = await detRes.json();
        detailItems = (detData.data || []).flatMap(
          (child: any) => child.items || []
        );
      }
    } catch {}
  }

  const CANCEL_STATUSES = ["CANCEL_COMPLETED", "CANCEL_REQUESTED"];

  const items: AdminItemData[] = detailItems.map((it: any) => {
    const ph = (it.purchaseHistory || [])[0];
    const domesticShip = (it.shippingInfo || []).find(
      (s: any) => s.isDomestic
    );
    const overseasShip = (it.shippingInfo || []).find(
      (s: any) => !s.isDomestic && s.vendor
    );

    return {
      orderItemNumber: it.orderItemNumber || "",
      productName: it.product?.name || "",
      brand: it.product?.brand || "",
      detailUrl: it.product?.detailUrl || "",
      priceLocal: it.priceLocal || 0,
      priceKRW: it.priceKRW || 0,
      quantity: it.quantity || 1,
      estimatedWeight: it.weight || it.product?.weight || 0,
      status: it.status || "",
      isFreeShipping: it.isFreeShipping || false,
      isCancelled: CANCEL_STATUSES.includes(it.status || ""),
      purchaseUrl: ph?.url || null,
      purchasePrice: ph?.purchasePrice || null,
      cardApprovalCode: ph?.cardProviderApprovalCode || null,
      cardProvider: ph?.cardProviderName || null,
      domesticTracking: domesticShip?.trackingNumber || null,
      overseasTracking: overseasShip?.trackingNumber || null,
      overseasVendor: overseasShip?.vendor?.text || null,
    };
  });

  return {
    orderNumber,
    orderedAt: listOrder.orderedAt || "",
    status: listOrder.status || "",
    totalAmountLocal: listOrder.payment?.totalAmountLocal || 0,
    currency: listOrder.payment?.currency || "TWD",
    isCombined,
    hasFreeShipping: items.some((it) => it.isFreeShipping),
    customerName: listOrder.customer?.name || "",
    shippingAddressType: listOrder.shippingAddress?.type || "",
    items,
  };
}
