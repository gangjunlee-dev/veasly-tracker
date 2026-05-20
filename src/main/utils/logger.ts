import electronLog from "electron-log/main";

electronLog.initialize();

electronLog.transports.console.level = "debug";
electronLog.transports.file.level = "info";
electronLog.transports.file.maxSize = 5 * 1024 * 1024;

export const logger = electronLog.scope("main");
export const createLogger = (scope: string) => electronLog.scope(scope);
