import { app, dialog, ipcMain, shell } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  getDocument,
  listDocuments,
  loadParsed,
  removeDocument,
  renameDocument,
  setDocumentAccount,
} from "../documents/store.js";
import { listAllTransactions } from "../plaid/transactions.js";
import { filterTransactions, validateFilters } from "../analytics/transactions.js";
import { transactionsToCsv } from "../statements/export-csv.js";
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

function csvFileName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Enter a file name");
  const name = value.trim();
  return name.toLowerCase().endsWith(".csv") ? name : `${name}.csv`;
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

  ipcMain.handle("documents:rename", async (_event, id: unknown, fileName: unknown) => {
    return renameDocument(await selectedVault(), documentId(id), csvFileName(fileName));
  });

  ipcMain.handle("documents:set-account", async (_event, id: unknown, account: unknown) => {
    if (typeof account !== "string") throw new Error("invalid arguments");
    return setDocumentAccount(await selectedVault(), documentId(id), account.trim() || undefined);
  });

  ipcMain.handle("transactions:list", async () => {
    const vaultPath = await readVaultPath(configPath());
    return vaultPath ? listAllTransactions(vaultPath) : [];
  });

  ipcMain.handle("transactions:export", async (_event, value: unknown) => {
    const filters = value === undefined ? { pending: "include" as const } : validateFilters(value);
    const vaultPath = await readVaultPath(configPath());
    if (!vaultPath) throw new Error("no vault selected");
    const [transactions, documents] = await Promise.all([
      listAllTransactions(vaultPath),
      listDocuments(vaultPath),
    ]);
    const result = await dialog.showSaveDialog({
      defaultPath: `boringmoney-transactions-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false as const, canceled: true as const };
    const sources = new Map(documents.map((document) => [document.id, document.fileName]));
    const temporaryPath = `${result.filePath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, transactionsToCsv(filterTransactions(transactions, filters, documents), sources), { encoding: "utf8", mode: 0o600 });
      await fs.rename(temporaryPath, result.filePath);
    } finally {
      await fs.rm(temporaryPath, { force: true });
    }
    return { ok: true as const, path: result.filePath };
  });
}
