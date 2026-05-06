import { contextBridge, ipcRenderer } from "electron";

const api = {
  app: {
    ping: () => ipcRenderer.invoke("app:ping") as Promise<string>,
    getVersion: () => ipcRenderer.invoke("app:getVersion") as Promise<string>
  }
};

contextBridge.exposeInMainWorld("api", api);
