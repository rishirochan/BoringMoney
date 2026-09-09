import { ipcMain } from "electron";
import { analyzeTransactions, parseAiRequest } from "./analysis.js";
import { getAiStatus, invokeAiProvider } from "./cli.js";
import type { RegisterAiHandlersOptions } from "./types.js";

const AI_TIMEOUT_MS = 120_000;
const activeRequests = new Map<string, AbortController>();

function requestId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) {
    throw new Error("Invalid AI request ID.");
  }
  return value;
}

export function registerAiHandlers(options: RegisterAiHandlersOptions) {
  ipcMain.handle("ai:status", getAiStatus);
  ipcMain.handle("ai:query", async (_event, value: unknown) => {
    const request = parseAiRequest(value);
    if (activeRequests.has(request.requestId)) throw new Error("That AI request is already running.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    activeRequests.set(request.requestId, controller);
    try {
      const [transactions, documents] = await Promise.all([
        options.getTransactions(),
        options.getDocuments(),
      ]);
      return await analyzeTransactions(
        request,
        transactions,
        documents,
        invokeAiProvider,
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted) throw new Error("AI request canceled or timed out.");
      throw error;
    } finally {
      clearTimeout(timeout);
      activeRequests.delete(request.requestId);
    }
  });
  ipcMain.handle("ai:cancel", (_event, value: unknown) => {
    const controller = activeRequests.get(requestId(value));
    controller?.abort();
    return { canceled: Boolean(controller) };
  });
}
