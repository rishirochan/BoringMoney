import { app, ipcMain } from "electron";
import path from "node:path";
import { invokeAiProvider } from "../ai/cli.js";
import { readAiSettings } from "../ai/models.js";
import type { AiProvider } from "../ai/types.js";
import { listDocuments } from "../documents/store.js";
import { listAllTransactions } from "../plaid/transactions.js";
import { routeTransactions, validatePiles } from "./piles.js";
import { readPiles, writePiles } from "./store.js";
import { suggestRules } from "./suggest.js";

const SUGGEST_TIMEOUT_MS = 120_000;

export type RegisterPilesHandlersOptions = { getVaultPath: () => Promise<string | null> };

function aiProvider(value: unknown): AiProvider {
  if (value !== "codex" && value !== "claude") throw new Error("Choose Codex or Claude.");
  return value;
}

export function registerPilesHandlers(options: RegisterPilesHandlersOptions) {
  const settingsPath = () => path.join(app.getPath("userData"), "ai-models.json");

  ipcMain.handle("piles:list", async () => {
    const vaultPath = await options.getVaultPath();
    return vaultPath ? readPiles(vaultPath) : [];
  });

  ipcMain.handle("piles:save", async (_event, value: unknown) => {
    const vaultPath = await options.getVaultPath();
    if (!vaultPath) throw new Error("Choose a storage folder in Sources before making piles.");
    return writePiles(vaultPath, validatePiles(value));
  });

  ipcMain.handle("piles:suggest", async (_event, value: unknown) => {
    const provider = aiProvider(value);
    const vaultPath = await options.getVaultPath();
    if (!vaultPath) throw new Error("Choose a storage folder in Sources before making piles.");
    const { model, effort } = readAiSettings(settingsPath())[provider];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SUGGEST_TIMEOUT_MS);
    try {
      const [piles, transactions, documents] = await Promise.all([
        readPiles(vaultPath),
        listAllTransactions(vaultPath),
        listDocuments(vaultPath),
      ]);
      const { unrouted } = routeTransactions(transactions, piles, documents);
      const suggestions = await suggestRules(piles, unrouted, (prompt, schema) =>
        invokeAiProvider(provider, prompt, schema, controller.signal, model, effort));
      return { suggestions };
    } catch (error) {
      if (controller.signal.aborted) throw new Error("AI request canceled or timed out.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  });
}
