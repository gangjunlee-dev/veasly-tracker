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
