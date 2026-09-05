import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { registerVaultHandlers } from "./features/vault/ipc.js";

const directory = path.dirname(fileURLToPath(import.meta.url));

function createWindow() {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(directory, "preload.cjs"),
    },
  });
  window.loadFile(path.join(directory, "../dist/index.html"));
}

registerVaultHandlers();

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
