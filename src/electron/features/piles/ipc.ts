import { app, ipcMain } from "electron";
import path from "node:path";
import { invokeAiProvider } from "../ai/cli.js";
import { readAiSettings } from "../ai/models.js";
import type { AiProvider } from "../ai/types.js";
import { listAllTransactions } from "../plaid/transactions.js";
import { summarizePayees, validateStore } from "./piles.js";
import { groupPayees } from "./group.js";
import { readStore, writeStore } from "./store.js";

const GROUP_TIMEOUT_MS = 120_000;
const MAX_GROUPED_DESCRIPTIONS = 200;

export type RegisterPilesHandlersOptions = { getVaultPath: () => Promise<string | null> };

function aiProvider(value: unknown): AiProvider {
  if (value !== "codex" && value !== "claude") throw new Error("Choose Codex or Claude.");
  return value;
}

export function registerPilesHandlers(options: RegisterPilesHandlersOptions) {
  const settingsPath = () => path.join(app.getPath("userData"), "ai-models.json");

  async function vault(): Promise<string> {
    const vaultPath = await options.getVaultPath();
    if (!vaultPath) throw new Error("Choose a storage folder in Sources before making piles.");
    return vaultPath;
  }

  ipcMain.handle("piles:list", async () => {
    const vaultPath = await options.getVaultPath();
    return vaultPath ? readStore(vaultPath) : { piles: [], payees: [] };
  });

  ipcMain.handle("piles:save", async (_event, value: unknown) => {
    return writeStore(await vault(), validateStore(value));
  });

  ipcMain.handle("payees:group", async (_event, value: unknown) => {
    const provider = aiProvider(value);
    const vaultPath = await vault();
    const { model, effort } = readAiSettings(settingsPath())[provider];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GROUP_TIMEOUT_MS);
    try {
      const [store, transactions] = await Promise.all([readStore(vaultPath), listAllTransactions(vaultPath)]);
      // Only descriptions leave this machine: no amounts, no dates, no account names.
      const ungrouped = summarizePayees(transactions, store.payees)
        .filter((entry) => !entry.grouped)
        .slice(0, MAX_GROUPED_DESCRIPTIONS)
        .map((entry) => entry.name);
      const payees = await groupPayees(store.payees, ungrouped, (prompt, schema) =>
        invokeAiProvider(provider, prompt, schema, controller.signal, model, effort));
      return writeStore(vaultPath, validateStore({ piles: store.piles, payees }));
    } catch (error) {
      if (controller.signal.aborted) throw new Error("AI request canceled or timed out.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  });
}
