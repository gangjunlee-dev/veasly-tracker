import { app, BrowserWindow, clipboard, ipcMain, session, shell } from "electron";
import path from "node:path";
import { URL } from "node:url";
import { closeDb } from "./db/client";
import { logger } from "./utils/logger";
import { registerSitesIpc } from "./ipc/sites";
import { registerOrdersIpc } from "./ipc/orders";
import { registerExtractorIpc } from "./ipc/extractor";
import { registerLogsIpc } from "./ipc/logs";
import { registerWarehouseIpc } from "./ipc/warehouse";

let mainWindow: BrowserWindow | null = null;

function registerAppIpc() {
  ipcMain.handle("app:ping", async () => {
    return "pong from Electron main";
  });

  ipcMain.handle("app:getVersion", async () => {
    return app.getVersion();
  });

  ipcMain.handle("app:copyToClipboard", async (_event, text: unknown) => {
    if (typeof text !== "string") {
      throw new Error("클립보드에 복사할 텍스트가 올바르지 않습니다.");
    }
    clipboard.writeText(text);
  });
}

function registerIpc() {
  registerAppIpc();
  registerSitesIpc();
  registerOrdersIpc();
  registerExtractorIpc();
  registerLogsIpc();
  registerWarehouseIpc();
}

function installContentSecurityPolicy() {
  const devServerUrl = process.env.NEXT_DEV_SERVER_URL;
  const devOrigin = devServerUrl
    ? (() => {
        try {
          return new URL(devServerUrl).origin;
        } catch {
          return undefined;
        }
      })()
    : undefined;

  // Dev needs eval/inline for Next HMR; packaged build is stricter.
  const directives = app.isPackaged
    ? [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'"
      ]
    : [
        "default-src 'self'",
        `script-src 'self' 'unsafe-inline' 'unsafe-eval'${devOrigin ? ` ${devOrigin}` : ""}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        `connect-src 'self' ws: wss:${devOrigin ? ` ${devOrigin}` : ""}`,
        "object-src 'none'",
        "base-uri 'self'"
      ];

  const csp = directives.join("; ");

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...(details.responseHeaders ?? {}) };
    headers["Content-Security-Policy"] = [csp];
    callback({ responseHeaders: headers });
  });
}

function isAllowedAppUrl(target: string): boolean {
  const devServerUrl = process.env.NEXT_DEV_SERVER_URL;

  if (devServerUrl && target.startsWith(devServerUrl)) {
    return true;
  }

  // file:// URLs that point inside our resourcesPath are the packaged renderer.
  if (target.startsWith("file://")) {
    return true;
  }

  return false;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    title: "Veasly Tracker",
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();

    if (!app.isPackaged) {
      mainWindow?.webContents.openDevTools({ mode: "detach" });
    }
  });

  // External links (target="_blank" etc.) open in the OS browser, never in app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // Block navigation to any URL outside our app surface.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAllowedAppUrl(url)) return;

    event.preventDefault();
    logger.warn("[main] blocked will-navigate to", url);
    void shell.openExternal(url);
  });

  // Refuse to attach webviews — we don't use them, so any creation is a bug.
  mainWindow.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      logger.error("[main] did-fail-load", {
        errorCode,
        errorDescription,
        validatedURL
      });
    }
  );

  const devServerUrl = process.env.NEXT_DEV_SERVER_URL;

  if (!app.isPackaged && devServerUrl) {
    logger.info("[main] loading Next dev server:", devServerUrl);
    void mainWindow.loadURL(devServerUrl);
  } else {
    const indexHtml = path.join(
      process.resourcesPath,
      "renderer",
      "index.html"
    );

    logger.info("[main] loading production file:", indexHtml);
    void mainWindow.loadFile(indexHtml);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

process.on("uncaughtException", (error) => {
  logger.error("[main] uncaughtException:", error);
});

process.on("unhandledRejection", (reason) => {
  logger.error("[main] unhandledRejection:", reason);
});

app.whenReady().then(() => {
  installContentSecurityPolicy();
  registerIpc();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  closeDb();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Defense-in-depth: refuse to create any non-app browser windows.
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
});
