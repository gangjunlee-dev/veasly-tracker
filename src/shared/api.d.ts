export {};

export type Site = {
  id: number;
  code: string;
  name: string;
  username: string;
  enabled: boolean;
  lastExtractedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateSiteInput = {
  code: string;
  name: string;
  username: string;
  password: string;
  enabled?: boolean;
};

export type UpdateSiteInput = {
  id: number;
  code?: string;
  name?: string;
  username?: string;
  password?: string;
  enabled?: boolean;
};

export type Order = {
  id: number;
  siteId: number;
  siteName?: string;
  siteCode?: string;
  orderNumber: string;
  orderDate: string;
  productName: string;
  quantity: number;
  amount: number;
  currency: string;
  invoiceNumber: string | null;
  invoiceUrl: string | null;
  shippingStatus: string | null;
  rawData: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type ListOrdersInput = {
  page?: number;
  pageSize?: number;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
};

export type ListOrdersBySiteInput = ListOrdersInput & {
  siteId: number;
};

export type ListAllOrdersInput = ListOrdersInput & {
  siteIds?: number[];
};

export type ExportOrdersInput = {
  siteId?: number;
  siteIds?: number[];
  dateFrom?: string;
  dateTo?: string;
  search?: string;
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
export type ExtractionLog = {
  id: number;
  siteId: number;
  siteName?: string;
  siteCode?: string;
  status: "running" | "success" | "failed" | "cancelled" | string;
  startedAt: string;
  finishedAt: string | null;
  message: string | null;
  totalOrders: number;
  newOrders: number;
  updatedOrders: number;
  savedOrders: number;
  errorStack: string | null;
  createdAt: string;
};

export type ListExtractionLogsInput = {
  page?: number;
  pageSize?: number;
};

export type ListExtractionLogsBySiteInput = ListExtractionLogsInput & {
  siteId: number;
};

declare global {
  interface Window {
    api: {
      app: {
        ping: () => Promise<string>;
        getVersion: () => Promise<string>;
      };
      sites: {
        list: () => Promise<Site[]>;
        create: (input: CreateSiteInput) => Promise<Site>;
        update: (input: UpdateSiteInput) => Promise<Site>;
        delete: (input: { id: number }) => Promise<{
          success: boolean;
          deletedId: number;
        }>;
      };
      orders: {
        listBySite: (
          input: ListOrdersBySiteInput
        ) => Promise<PaginatedResult<Order>>;
        listAll: (
          input: ListAllOrdersInput
        ) => Promise<PaginatedResult<Order>>;
        export: (input: ExportOrdersInput) => Promise<string>;
      };
      logs: {
        list: (
          input?: ListExtractionLogsInput
        ) => Promise<PaginatedResult<ExtractionLog>>;
        listBySite: (
          input: ListExtractionLogsBySiteInput
        ) => Promise<PaginatedResult<ExtractionLog>>;
      };      extractor: {
        available: () => Promise<ExtractorConfig[]>;
        run: (input: {
          siteId: number;
          options?: ExtractionOptions;
        }) => Promise<{ runId: string }>;
        cancel: (input: {
          runId: string;
        }) => Promise<{
          success: boolean;
          message?: string;
        }>;
        onProgress: (
          callback: (progress: ExtractionProgress) => void
        ) => () => void;
      };
    };
  }
}
