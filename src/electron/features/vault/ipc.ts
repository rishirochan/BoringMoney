import { app, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import {
  getDocument,
  listDocuments,
  listTransactions,
  loadParsed,
  removeDocument,
} from "../documents/store.js";
import { importFiles, listFiles, readVaultPath, writeVaultPath } from "./ingest.js";

// ponytail: no cache, JSON file is tiny and reads are infrequent (app start, dialogs).
const configPath = () => path.join(app.getPath("userData"), "vault-config.json");

async function selectedVault(): Promise<string> {
  const vaultPath = await readVaultPath(configPath());
  if (!vaultPath) throw new Error("no vault selected");
  return vaultPath;
}

function documentId(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid arguments");
  return value;
}

async function deleteDocument(vaultPath: string, id: string) {
  const record = await getDocument(vaultPath, id);
  if (!record) return null;
  try {
    await shell.trashItem(path.join(vaultPath, record.fileName));
    return removeDocument(vaultPath, id, { deleteFile: false });
  } catch {
    return removeDocument(vaultPath, id, { deleteFile: true });
  }
}

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
    return importFiles(await selectedVault(), paths);
  });

  ipcMain.handle("files:list", async () => {
    const vaultPath = await readVaultPath(configPath());
    return vaultPath ? listFiles(vaultPath) : [];
  });

  ipcMain.handle("documents:list", async () => {
    const vaultPath = await readVaultPath(configPath());
    return vaultPath ? listDocuments(vaultPath) : [];
  });

  ipcMain.handle("documents:parsed", async (_event, id: unknown) => {
    return loadParsed(await selectedVault(), documentId(id));
  });

  ipcMain.handle("documents:delete", async (_event, id: unknown) => {
    return deleteDocument(await selectedVault(), documentId(id));
  });

  ipcMain.handle("transactions:list", async () => {
    const vaultPath = await readVaultPath(configPath());
    return vaultPath ? listTransactions(vaultPath) : [];
  });
}
