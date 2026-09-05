import { app, dialog, ipcMain } from "electron";
import path from "node:path";
import { importFiles, listFiles, readVaultPath, writeVaultPath } from "./ingest.js";

// ponytail: no cache, JSON file is tiny and reads are infrequent (app start, dialogs).
const configPath = () => path.join(app.getPath("userData"), "vault-config.json");

export function registerVaultHandlers() {
  ipcMain.handle("vault:get-path", () => readVaultPath(configPath()));

  ipcMain.handle("vault:choose", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    const vaultPath = result.filePaths[0];
    await writeVaultPath(configPath(), vaultPath);
    return vaultPath;
  });

  ipcMain.handle("files:import", async (_event, paths: unknown) => {
    if (!Array.isArray(paths) || !paths.every((path) => typeof path === "string")) {
      throw new Error("invalid arguments");
    }
    const vaultPath = await readVaultPath(configPath());
    if (!vaultPath) throw new Error("no vault selected");
    return importFiles(vaultPath, paths);
  });

  ipcMain.handle("files:list", async () => {
    const vaultPath = await readVaultPath(configPath());
    return vaultPath ? listFiles(vaultPath) : [];
  });
}
