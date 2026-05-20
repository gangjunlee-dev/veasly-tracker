import { ipcMain } from "electron";
import { z } from "zod";
import {
  createSite,
  deleteSite,
  listSites,
  resetSiteSession,
  updateSite
} from "../services/sites-repo";

const CreateSiteSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  enabled: z.boolean().optional()
});

const UpdateSiteSchema = z.object({
  id: z.number().int().positive(),
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  enabled: z.boolean().optional()
});

const DeleteSiteSchema = z.object({
  id: z.number().int().positive()
});

export function registerSitesIpc() {
  ipcMain.handle("sites:list", async () => {
    return listSites();
  });

  ipcMain.handle("sites:create", async (_event, rawInput) => {
    const input = CreateSiteSchema.parse(rawInput);
    return createSite(input);
  });

  ipcMain.handle("sites:update", async (_event, rawInput) => {
    const input = UpdateSiteSchema.parse(rawInput);
    return updateSite(input);
  });

  ipcMain.handle("sites:delete", async (_event, rawInput) => {
    const input = DeleteSiteSchema.parse(rawInput);
    return deleteSite(input.id);
  });

  ipcMain.handle("sites:resetSession", async (_event, rawInput) => {
    const input = DeleteSiteSchema.parse(rawInput);
    return resetSiteSession(input.id);
  });
}
