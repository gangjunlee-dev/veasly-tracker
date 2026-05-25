import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type {
  CreateSiteInput,
  ExportOrdersInput,
  ImportOliveYoungSnapshotInput,
  ExtractionOptions,
  ExtractionProgress,
  ListAllOrdersInput,
  ListExtractionLogsInput,
  ListExtractionLogsBySiteInput,
  ListInboundScansInput,
  WarehouseAutoMatchInput,
  WarehouseScanInboundInput,
  ListOrdersBySiteInput,
  UpdateSiteInput
} from "../shared/api";

const api = {
  app: {
    ping: () => ipcRenderer.invoke("app:ping") as Promise<string>,
    getVersion: () => ipcRenderer.invoke("app:getVersion") as Promise<string>,
    copyToClipboard: (text: string) =>
      ipcRenderer.invoke("app:copyToClipboard", text) as Promise<void>
  },
  sites: {
    list: () => ipcRenderer.invoke("sites:list"),
    create: (input: CreateSiteInput) => ipcRenderer.invoke("sites:create", input),
    update: (input: UpdateSiteInput) => ipcRenderer.invoke("sites:update", input),
    delete: (input: { id: number }) => ipcRenderer.invoke("sites:delete", input),
    resetSession: (input: { id: number }) =>
      ipcRenderer.invoke("sites:resetSession", input)
  },
  orders: {
    listBySite: (input: ListOrdersBySiteInput) =>
      ipcRenderer.invoke("orders:listBySite", input),
    listAll: (input: ListAllOrdersInput) =>
      ipcRenderer.invoke("orders:listAll", input),
    export: (input: ExportOrdersInput) =>
      ipcRenderer.invoke("orders:export", input),
    importOliveYoungSnapshot: (input: ImportOliveYoungSnapshotInput) =>
      ipcRenderer.invoke("orders:importOliveYoungSnapshot", input)
  },
  warehouse: {
    scanInbound: (input: WarehouseScanInboundInput) =>
      ipcRenderer.invoke("warehouse:scanInbound", input),
    listInboundScans: (input?: ListInboundScansInput) =>
      ipcRenderer.invoke("warehouse:listInboundScans", input ?? {}),
    autoMatch: (input?: WarehouseAutoMatchInput) =>
      ipcRenderer.invoke("warehouse:autoMatch", input ?? {}),
    findOrdersByTracking: (input: WarehouseScanInboundInput) =>
      ipcRenderer.invoke("warehouse:findOrdersByTracking", input)
  },
  logs: {
    list: (input?: ListExtractionLogsInput) =>
      ipcRenderer.invoke("logs:list", input ?? {}),
    listBySite: (input: ListExtractionLogsBySiteInput) =>
      ipcRenderer.invoke("logs:listBySite", input)
  },
  admin: {
    saveCredentials: (input: { username: string; password: string }) =>
      ipcRenderer.invoke("admin:saveCredentials", input),
    login: () => ipcRenderer.invoke("admin:login"),
    status: () => ipcRenderer.invoke("admin:status"),
    logout: () => ipcRenderer.invoke("admin:logout"),
    autoLogin: () => ipcRenderer.invoke("admin:autoLogin"),
    sync: () => ipcRenderer.invoke("admin:sync"),
    syncStatus: () => ipcRenderer.invoke("admin:syncStatus"),
    listItems: (input?: {
      page?: number;
      pageSize?: number;
      status?: string;
      warehouseStatus?: string;
      search?: string;
    }) => ipcRenderer.invoke("admin:listItems", input),
    matchBarcode: (input: { trackingNumber: string }) =>
      ipcRenderer.invoke("admin:matchBarcode", input),
    confirmMatch: (input: {
      orderItemId: number;
      trackingNumber: string;
      vyCode: string;
    }) => ipcRenderer.invoke("admin:confirmMatch", input),
    searchOrders: (input: { query: string }) =>
      ipcRenderer.invoke("admin:searchOrders", input),
    recentMatches: (input?: { limit?: number }) =>
      ipcRenderer.invoke("admin:recentMatches", input),
    auditLog: (input?: { limit?: number; eventType?: string }) =>
      ipcRenderer.invoke("admin:auditLog", input),
    retryPending: () => ipcRenderer.invoke("admin:retryPending"),
  },
  extractor: {
    available: () => ipcRenderer.invoke("extractor:available"),
    run: (input: { siteId: number; options?: ExtractionOptions }) =>
      ipcRenderer.invoke("extractor:run", input),
    cancel: (input: { runId: string }) =>
      ipcRenderer.invoke("extractor:cancel", input),
    onProgress: (callback: (progress: ExtractionProgress) => void) => {
      const listener = (
        _event: IpcRendererEvent,
        progress: ExtractionProgress
      ) => {
        callback(progress);
      };

      ipcRenderer.on("extractor:progress", listener);

      return () => {
        ipcRenderer.removeListener("extractor:progress", listener);
      };
    }
  }
};

contextBridge.exposeInMainWorld("api", api);
