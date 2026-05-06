import { contextBridge, ipcRenderer } from "electron";
import type {
  CreateSiteInput,
  ExportOrdersInput,
  ListAllOrdersInput,
  ListOrdersBySiteInput,
  UpdateSiteInput
} from "../shared/api";

const api = {
  app: {
    ping: () => ipcRenderer.invoke("app:ping") as Promise<string>,
    getVersion: () => ipcRenderer.invoke("app:getVersion") as Promise<string>
  },
  sites: {
    list: () => ipcRenderer.invoke("sites:list"),
    create: (input: CreateSiteInput) => ipcRenderer.invoke("sites:create", input),
    update: (input: UpdateSiteInput) => ipcRenderer.invoke("sites:update", input),
    delete: (input: { id: number }) => ipcRenderer.invoke("sites:delete", input)
  },
  orders: {
    listBySite: (input: ListOrdersBySiteInput) =>
      ipcRenderer.invoke("orders:listBySite", input),
    listAll: (input: ListAllOrdersInput) =>
      ipcRenderer.invoke("orders:listAll", input),
    export: (input: ExportOrdersInput) =>
      ipcRenderer.invoke("orders:export", input)
  }
};

contextBridge.exposeInMainWorld("api", api);
