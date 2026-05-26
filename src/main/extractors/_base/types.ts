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
  // 사이트 마이페이지 URL에서 추출 가능한 원본 주문 식별자.
  // admin_order_items.source_order_ref와 비교해 URL 페어링에 사용.
  sourceOrderRef?: string | null;
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
