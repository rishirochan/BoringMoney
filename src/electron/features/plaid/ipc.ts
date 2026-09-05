import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  safeStorage,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createLinkToken,
  exchangePublicToken,
  isTrustedPlaidLinkUrl,
  parsePlaidCredentials,
  PLAID_LINK_SCHEME,
  PLAID_LINK_URL,
  removeItem,
  type PlaidCredentials,
  type PlaidEnvironment,
} from "./client.js";

type PlaidAccount = {
  id: string;
  name: string;
  mask: string | null;
  type: string | null;
  subtype: string | null;
};

type PlaidConnection = {
  itemId: string;
  accessToken: string;
  institutionName: string;
  accounts: PlaidAccount[];
  connectedAt: number;
};

type PlaidStore = PlaidCredentials & {
  clientUserId: string;
  connections: PlaidConnection[];
};

type LinkSuccess = Omit<PlaidConnection, "itemId" | "accessToken" | "connectedAt"> & {
  publicToken: string;
};

type JsonObject = Record<string, unknown>;
const STORE_VERSION = 1;
const directory = path.dirname(fileURLToPath(import.meta.url));
let activeLinkWindow: BrowserWindow | null = null;

export { PLAID_LINK_SCHEME };

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isAccount(value: unknown): value is PlaidAccount {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isNullableString(value.mask) &&
    isNullableString(value.type) &&
    isNullableString(value.subtype)
  );
}

function isConnection(value: unknown): value is PlaidConnection {
  return (
    isObject(value) &&
    typeof value.itemId === "string" &&
    typeof value.accessToken === "string" &&
    typeof value.institutionName === "string" &&
    Array.isArray(value.accounts) &&
    value.accounts.every(isAccount) &&
    typeof value.connectedAt === "number"
  );
}

function parseStore(value: unknown): PlaidStore {
  if (!isObject(value) || typeof value.clientUserId !== "string") {
    throw new Error("Plaid settings are damaged.");
  }
  const credentials = parsePlaidCredentials(value);
  if (!Array.isArray(value.connections) || !value.connections.every(isConnection)) {
    throw new Error("Plaid settings are damaged.");
  }
  return { ...credentials, clientUserId: value.clientUserId, connections: value.connections };
}

function storePath(): string {
  return path.join(app.getPath("userData"), "plaid.json");
}

async function writeStore(store: PlaidStore): Promise<void> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error("Secure credential storage is not available on this device.");
  }
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(store));
  const filePath = storePath();
  const temporaryPath = `${filePath}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify({ version: STORE_VERSION, encrypted: encrypted.toString("base64") })}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readStore(): Promise<PlaidStore | null> {
  let raw: string;
  try {
    raw = await fs.readFile(storePath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error("Secure credential storage is not available on this device.");
  }
  const envelope: unknown = JSON.parse(raw);
  if (
    !isObject(envelope) ||
    envelope.version !== STORE_VERSION ||
    typeof envelope.encrypted !== "string"
  ) {
    throw new Error("Plaid settings are damaged.");
  }
  const decrypted = await safeStorage.decryptStringAsync(Buffer.from(envelope.encrypted, "base64"));
  const store = parseStore(JSON.parse(decrypted.result));
  if (decrypted.shouldReEncrypt) await writeStore(store);
  return store;
}

function publicConnection(connection: PlaidConnection) {
  return {
    id: connection.itemId,
    institutionName: connection.institutionName,
    accounts: connection.accounts,
    connectedAt: connection.connectedAt,
  };
}

function status(store: PlaidStore | null) {
  if (!store) {
    return { configured: false as const, environment: "sandbox" as PlaidEnvironment, connections: [] };
  }
  return {
    configured: true as const,
    environment: store.environment,
    clientIdLast4: store.clientId.slice(-4),
    connections: store.connections.map(publicConnection),
  };
}

function assertMainRenderer(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  const rendererUrl = event.sender.getURL();
  const devServerUrl = process.env.ELECTRON_DEV_SERVER_URL;
  const isTrustedDevServer =
    devServerUrl !== undefined && new URL(rendererUrl).origin === new URL(devServerUrl).origin;
  if (!window || (!rendererUrl.startsWith("file://") && !isTrustedDevServer)) {
    throw new Error("Untrusted Plaid request.");
  }
  return window;
}

function linkHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src https://cdn.plaid.com/; script-src 'unsafe-inline' https://cdn.plaid.com/link/v2/stable/link-initialize.js; style-src 'unsafe-inline'; frame-src https://cdn.plaid.com/; connect-src https://sandbox.plaid.com/ https://production.plaid.com/; img-src data: https://cdn.plaid.com/ https://*.plaid.com/">
  <title>Connect a bank</title>
</head>
<body>
  <p id="status">Loading Plaid Link...</p>
  <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
  <script>
    try {
      const linkToken = new URLSearchParams(location.hash.slice(1)).get("token");
      if (!linkToken) throw new Error("Plaid link token is missing.");
      const handler = Plaid.create({
        token: linkToken,
        onLoad() { document.getElementById("status").remove(); },
        onSuccess(publicToken, metadata) { window.plaidLink.complete(publicToken, metadata); },
        onExit(error) {
          window.plaidLink.exit(error && (error.display_message || error.error_message));
        }
      });
      handler.open();
    } catch (error) {
      window.plaidLink.exit(error instanceof Error ? error.message : "Plaid Link could not load.");
    }
  </script>
</body>
</html>`;
}

export function registerPlaidLinkProtocol(): void {
  protocol.handle(
    PLAID_LINK_SCHEME,
    () => new Response(linkHtml(), { headers: { "content-type": "text/html; charset=utf-8" } })
  );
}

function openPlaidLink(parent: BrowserWindow, linkToken: string): Promise<LinkSuccess | null> {
  if (activeLinkWindow && !activeLinkWindow.isDestroyed()) {
    throw new Error("Plaid Link is already open.");
  }
  const linkWindow = new BrowserWindow({
    parent,
    modal: true,
    width: 420,
    height: 760,
    minWidth: 420,
    minHeight: 760,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    title: "Connect a bank",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(directory, "../../plaid-link-preload.cjs"),
    },
  });
  activeLinkWindow = linkWindow;
  linkWindow.webContents.setWindowOpenHandler(({ url }) => ({
    action: url.startsWith("https://") ? "allow" : "deny",
    overrideBrowserWindowOptions: {
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    },
  }));
  linkWindow.webContents.on("will-navigate", (event) => {
    if (!isTrustedPlaidLinkUrl(event.url)) event.preventDefault();
  });
  linkWindow.webContents.on("will-redirect", (event) => {
    if (event.isMainFrame && !isTrustedPlaidLinkUrl(event.url)) event.preventDefault();
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      ipcMain.removeListener("plaid-link:success", onSuccess);
      ipcMain.removeListener("plaid-link:exit", onExit);
      if (activeLinkWindow === linkWindow) activeLinkWindow = null;
    };
    const finish = (result: LinkSuccess | null, error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!linkWindow.isDestroyed()) linkWindow.close();
      if (error) reject(error);
      else resolve(result);
    };
    const fromLinkWindow = (event: IpcMainEvent) =>
      event.sender === linkWindow.webContents &&
      event.senderFrame !== null &&
      isTrustedPlaidLinkUrl(event.senderFrame.url);
    const onSuccess = (event: IpcMainEvent, result: LinkSuccess) => {
      if (fromLinkWindow(event)) finish(result);
    };
    const onExit = (event: IpcMainEvent, message: string | null) => {
      if (fromLinkWindow(event)) finish(null, message ? new Error(message) : undefined);
    };

    ipcMain.on("plaid-link:success", onSuccess);
    ipcMain.on("plaid-link:exit", onExit);
    linkWindow.once("ready-to-show", () => linkWindow.show());
    linkWindow.once("closed", () => finish(null));
    linkWindow
      .loadURL(`${PLAID_LINK_URL}#token=${encodeURIComponent(linkToken)}`)
      .catch((error) => finish(null, error));
  });
}

export function registerPlaidHandlers() {
  ipcMain.handle("plaid:status", async (event) => {
    assertMainRenderer(event);
    return status(await readStore());
  });

  ipcMain.handle("plaid:credentials", async (event) => {
    assertMainRenderer(event);
    const store = await readStore();
    if (!store) throw new Error("Add your Plaid keys first.");
    return { clientId: store.clientId, secret: store.secret, environment: store.environment };
  });

  ipcMain.handle("plaid:save-credentials", async (event, value: unknown) => {
    assertMainRenderer(event);
    const credentials = parsePlaidCredentials(value);
    const existing = await readStore();
    if (
      existing?.connections.length &&
      (existing.clientId !== credentials.clientId || existing.environment !== credentials.environment)
    ) {
      throw new Error("Remove connected banks before changing the Plaid client or environment.");
    }
    const store: PlaidStore = {
      ...credentials,
      clientUserId: existing?.clientUserId ?? randomUUID(),
      connections: existing?.connections ?? [],
    };
    await writeStore(store);
    return status(store);
  });

  ipcMain.handle("plaid:connect", async (event) => {
    const parent = assertMainRenderer(event);
    const store = await readStore();
    if (!store) throw new Error("Add your Plaid keys first.");
    const linkToken = await createLinkToken(store, store.clientUserId);
    const linked = await openPlaidLink(parent, linkToken);
    if (!linked) return { status: "cancelled" as const };

    const exchanged = await exchangePublicToken(store, linked.publicToken);
    const connection: PlaidConnection = {
      itemId: exchanged.itemId,
      accessToken: exchanged.accessToken,
      institutionName: linked.institutionName,
      accounts: linked.accounts,
      connectedAt: Date.now(),
    };
    store.connections.push(connection);
    await writeStore(store);
    return { status: "connected" as const, connection: publicConnection(connection) };
  });

  ipcMain.handle("plaid:disconnect", async (event, itemId: unknown) => {
    assertMainRenderer(event);
    if (typeof itemId !== "string" || !itemId || itemId.length > 512) {
      throw new TypeError("Invalid Plaid connection.");
    }
    const store = await readStore();
    if (!store) throw new Error("Plaid is not configured.");
    const index = store.connections.findIndex((connection) => connection.itemId === itemId);
    if (index === -1) throw new Error("Plaid connection not found.");
    let remoteRemovalFailed = false;
    try {
      await removeItem(store, store.connections[index].accessToken);
    } catch {
      remoteRemovalFailed = true;
    }
    store.connections.splice(index, 1);
    await writeStore(store);
    return { ...status(store), remoteRemovalFailed };
  });
}
