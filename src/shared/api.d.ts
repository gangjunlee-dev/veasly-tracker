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
  warehouseStatus?: string;
  warehouseArrivedAt?: string | null;
  warehouseScanId?: number | null;
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


export type OliveYoungSnapshotItem = {
  orderNumber: string;
  orderDate: string;
  productName: string;
  quantity: number;
  amount: number;
  currency?: string;
  invoiceNumber?: string | null;
  invoiceUrl?: string | null;
  shippingStatus?: string | null;
  carrier?: string | null;
  carrierCode?: string | null;
  trackingNumber?: string | null;
  expectedDeliveryDate?: string | null;
  tradeShipCode?: string | null;
  orderGoodsSeq?: string | null;
  goodsNo?: string | null;
  goodsName?: string | null;
  rawText?: string;
  sourceRowIndex?: number;
};

export type OliveYoungSnapshot = {
  url?: string;
  title?: string;
  capturedAt?: string;
  totalItems?: number;
  orderNumbers?: string[];
  items: OliveYoungSnapshotItem[];
};

export type ImportOliveYoungSnapshotInput = {
  siteId: number;
  snapshot: OliveYoungSnapshot;
};

export type ImportOliveYoungSnapshotResult = {
  siteId: number;
  totalItems: number;
  newOrders: number;
  updatedOrders: number;
  savedOrders: number;
  sourceOrderNumbers: string[];
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
      maxOrders?: number;
      limit?: number;
      maxItems?: number;
      take?: number;
      count?: number;

      trackingLimit?: number;
      maxTracking?: number;
      maxTrackingOrders?: number;
      trackingCount?: number;

      includeTracking?: boolean;
      onlyTrackable?: boolean;
      trackingOnly?: boolean;
      debugShippingDiagnostic?: boolean;
      diagnosticLimit?: number;

      naverpay?: Record<string, unknown>;
      naverPay?: Record<string, unknown>;
      extra?: Record<string, unknown>;
      [key: string]: unknown;
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


export type WarehouseInboundScan = {
  id: number;
  trackingNumber: string;
  normalizedTrackingNumber: string;
  carrier: string | null;
  rawInput: string | null;
  status: "SCANNED" | "MATCHED" | "UNMATCHED" | "DUPLICATE" | "IGNORED" | "ISSUE" | string;
  matchedOrderCount: number;
  scanCount: number;
  scannedAt: string;
  lastScannedAt: string | null;
  matchedAt: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WarehouseMatchedOrder = {
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
  warehouseStatus: string;
  warehouseArrivedAt: string | null;
  warehouseScanId: number | null;
  carrier: string | null;
  trackingNumber: string | null;
  sourceOrderNumber: string | null;
  ordOptNo: string | null;
  brandName: string | null;
  optionName: string | null;
};

export type WarehouseScanInboundInput = {
  trackingNumber: string;
  carrier?: string;
  note?: string;
};

export type ListInboundScansInput = {
  page?: number;
  pageSize?: number;
  status?: string;
  search?: string;
};

export type WarehouseInboundScanListResult = PaginatedResult<WarehouseInboundScan> & {
  summary: Record<string, number>;
};

export type WarehouseScanInboundResult = {
  result: "SCANNED" | "DUPLICATE" | string;
  message: string;
  scan: WarehouseInboundScan | null;
  matchedOrders: WarehouseMatchedOrder[];
};

export type WarehouseAutoMatchInput = {
  scanId?: number;
};

export type WarehouseAutoMatchResult = {
  scannedCount: number;
  matchedScanCount: number;
  unmatchedScanCount: number;
  matchedOrderCount: number;
  matchedScans: Array<{
    scan: WarehouseInboundScan;
    matchedOrders: WarehouseMatchedOrder[];
  }>;
  unmatchedScans: WarehouseInboundScan[];
};

export type WarehouseFindOrdersByTrackingResult = {
  trackingNumber: string;
  items: WarehouseMatchedOrder[];
};

export type AdminSyncResult = {
  ok: boolean;
  totalOrders?: number;
  newOrders?: number;
  updatedOrders?: number;
  error?: string;
};

export type AdminMatchResult = {
  ok: boolean;
  total?: number;
  auto?: number;
  suggest?: number;
  trackerTotal?: number;
  adminTotal?: number;
};

export type AdminMatch = {
  id: number;
  tracker_order_id: number;
  admin_item_id: number;
  match_score: number;
  match_reasons: string;
  match_type: string;
  confirmed: number;
  tracker_order_number: string;
  tracker_product_name: string;
  tracker_amount: number;
  tracker_tracking: string | null;
  tracker_site_code: string;
  admin_item_number: string;
  admin_product_name: string;
  admin_purchase_url: string | null;
  admin_price_krw: number;
  veasly_order_number: string;
};

export type AdminStats = {
  ok: boolean;
  adminOrders: number;
  adminItems: number;
  totalMatches: number;
  autoMatches: number;
  suggestMatches: number;
  lastSync: any;
};
declare global {
  interface Window {
    api: {
      app: {
        ping: () => Promise<string>;
        getVersion: () => Promise<string>;
        copyToClipboard: (text: string) => Promise<void>;
      };
      sites: {
        list: () => Promise<Site[]>;
        create: (input: CreateSiteInput) => Promise<Site>;
        update: (input: UpdateSiteInput) => Promise<Site>;
        delete: (input: { id: number }) => Promise<{
          success: boolean;
          deletedId: number;
        }>;
        resetSession: (input: { id: number }) => Promise<{
          success: boolean;
          code: string;
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
        importOliveYoungSnapshot: (
          input: ImportOliveYoungSnapshotInput
        ) => Promise<ImportOliveYoungSnapshotResult>;
      };
      warehouse: {
        scanInbound: (
          input: WarehouseScanInboundInput
        ) => Promise<WarehouseScanInboundResult>;
        listInboundScans: (
          input?: ListInboundScansInput
        ) => Promise<WarehouseInboundScanListResult>;
        autoMatch: (
          input?: WarehouseAutoMatchInput
        ) => Promise<WarehouseAutoMatchResult>;
        findOrdersByTracking: (
          input: WarehouseScanInboundInput
        ) => Promise<WarehouseFindOrdersByTrackingResult>;
      };
      admin: {
        login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
        sync: () => Promise<AdminSyncResult>;
        match: () => Promise<AdminMatchResult>;
        getMatches: (input: { type?: string }) => Promise<{ ok: boolean; matches: AdminMatch[] }>;
        confirmMatch: (matchId: number, confirm: boolean) => Promise<{ ok: boolean }>;
        stats: () => Promise<AdminStats>;
      };
      logs: {
        list: (
          input?: ListExtractionLogsInput
        ) => Promise<PaginatedResult<ExtractionLog>>;
        listBySite: (
          input: ListExtractionLogsBySiteInput
        ) => Promise<PaginatedResult<ExtractionLog>>;
      };
      extractor: {
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
