export type StandardOrder = {
  orderNumber: string;
  orderDate: string;
  productName: string;
  quantity: number;
  amount: number;
  currency?: string;
  invoiceNumber?: string | null;
  invoiceUrl?: string | null;
  shippingStatus?: string | null;
  rawData?: string | null;

  // Phase 1: 구매사이트 주문 모니터링 확장 필드.
  // 사이트가 해당 정보를 노출할 때만 채운다. 미노출 시 undefined/null 유지(추측 금지).
  purchaseSiteOrderId?: string | null;
  sellerName?: string | null;
  productOption?: string | null;
  sku?: string | null;
  recipientName?: string | null;
  // recipientPhone: 참조용 데이터. 매칭 키로 사용 금지.
  recipientPhone?: string | null;
  carrier?: string | null;
  carrierCode?: string | null;
  trackingNumber?: string | null;
  shippedAt?: string | null;
  expectedShipDate?: string | null;
};

export type ExtractorConfig = {
  code: string;
  name: string;
  description?: string;
  loginUrl?: string;
  ordersUrl?: string;
  version?: string;
  enabled?: boolean;
};

export type ExtractionOptions = {
  since?: string;
  until?: string;
  maxPages?: number;
  lastOrderDate?: string;
  includeNoTracking?: boolean;
  headless?: boolean;
};

export type Credentials = {
  username: string;
  password: string;
};

export type ExtractionProgressPhase =
  | "starting"
  | "browser"
  | "login"
  | "session"
  | "extracting"
  | "saving"
  | "success"
  | "failed"
  | "cancelled";

export type ExtractionProgress = {
  runId: string;
  siteId: number;
  siteCode: string;
  phase: ExtractionProgressPhase;
  message: string;
  current?: number;
  total?: number;
  ordersFound?: number;
  createdAt: string;
};

export type ProgressReporter = (
  progress: Omit<ExtractionProgress, "createdAt">
) => void;
