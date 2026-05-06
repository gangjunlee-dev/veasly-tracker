import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";

let mainWindow: BrowserWindow | null = null;

function registerAppIpc() {
  ipcMain.handle("app:ping", async () => {
    return "pong from Electron main";
  });

  ipcMain.handle("app:getVersion", async () => {
    return app.getVersion();
  });
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
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();

    if (!app.isPackaged) {
      mainWindow?.webContents.openDevTools({ mode: "detach" });
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error("[main] did-fail-load", {
        errorCode,
        errorDescription,
        validatedURL
      });
    }
  );

  const devServerUrl = process.env.NEXT_DEV_SERVER_URL;

  if (!app.isPackaged && devServerUrl) {
    console.log("[main] loading Next dev server:", devServerUrl);
    void mainWindow.loadURL(devServerUrl);
  } else {
    const indexHtml = path.join(
      process.resourcesPath,
      "renderer",
      "index.html"
    );

    console.log("[main] loading production file:", indexHtml);
    void mainWindow.loadFile(indexHtml);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

process.on("uncaughtException", (error) => {
  console.error("[main] uncaughtException:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[main] unhandledRejection:", reason);
});

app.whenReady().then(() => {
  registerAppIpc();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
