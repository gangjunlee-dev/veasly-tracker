import { ipcMain } from "electron";
import { z } from "zod";
import { listExtractionLogs } from "../services/logs-repo";

const PaginationSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(200).default(50)
});

const ListBySiteSchema = PaginationSchema.extend({
  siteId: z.number().int().positive()
});

export function registerLogsIpc() {
  ipcMain.handle("logs:list", async (_event, rawInput) => {
    const input = PaginationSchema.parse(rawInput ?? {});
    return listExtractionLogs(input);
  });

  ipcMain.handle("logs:listBySite", async (_event, rawInput) => {
    const input = ListBySiteSchema.parse(rawInput);
    return listExtractionLogs(input);
  });
}
