import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";

const directory = path.dirname(fileURLToPath(import.meta.url));

function createWindow() {
  const window = new BrowserWindow({ width: 1200, height: 800 });
  window.loadFile(path.join(directory, "../dist/index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
