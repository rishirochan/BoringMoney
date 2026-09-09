import { app, BrowserWindow, protocol } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  PLAID_LINK_SCHEME,
  registerPlaidHandlers,
  registerPlaidLinkProtocol,
} from "./features/plaid/ipc.js";
import { registerAiHandlers } from "./features/ai/ipc.js";
import { listAllTransactions } from "./features/plaid/transactions.js";
import { listDocuments } from "./features/documents/store.js";
import { readVaultPath } from "./features/vault/ingest.js";
import { registerVaultHandlers } from "./features/vault/ipc.js";

const directory = path.dirname(fileURLToPath(import.meta.url));

protocol.registerSchemesAsPrivileged([
  { scheme: PLAID_LINK_SCHEME, privileges: { standard: true, secure: true } },
]);

function createWindow() {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#07080a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(directory, "preload.cjs"),
    },
  });
  const devServerUrl = process.env.ELECTRON_DEV_SERVER_URL;
  if (devServerUrl) {
    window.loadURL(devServerUrl);
  } else {
    window.loadFile(path.join(directory, "../dist/index.html"));
  }
}

registerVaultHandlers();
registerPlaidHandlers();
const vaultPath = () => readVaultPath(path.join(app.getPath("userData"), "vault-config.json"));
registerAiHandlers({
  getTransactions: async () => {
    const vault = await vaultPath();
    if (!vault) throw new Error("Choose a storage folder in Sources before asking about transactions.");
    return listAllTransactions(vault);
  },
  getDocuments: async () => {
    const vault = await vaultPath();
    return vault ? listDocuments(vault) : [];
  },
});

app.whenReady().then(() => {
  registerPlaidLinkProtocol();
  createWindow();
});
app.on("window-all-closed", () => app.quit());
