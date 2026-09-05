import { spawn } from "node:child_process";
import { watch } from "node:fs";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const devServerUrl = "http://127.0.0.1:5173";
const baseEnv = { ...process.env };
delete baseEnv.ELECTRON_RUN_AS_NODE;
const children = new Set();
let electron;
let stopping = false;
let restartTimer;

function run(args, extraEnv = {}) {
  const child = spawn(pnpm, args, {
    stdio: "inherit",
    env: { ...baseEnv, ...extraEnv },
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}

function stopElectron() {
  if (electron) {
    const child = electron;
    electron = undefined;
    child.kill();
  }
}

function startElectron() {
  stopElectron();
  const child = run(["exec", "electron", "."], {
    ELECTRON_DEV_SERVER_URL: devServerUrl,
  });
  electron = child;
  child.on("exit", (code) => {
    if (child === electron) {
      electron = undefined;
      if (!stopping) stop(code ?? 1);
    }
  });
}

function restartElectron() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(startElectron, 100);
}

async function waitForServer() {
  for (;;) {
    try {
      await fetch(devServerUrl);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

const initialBuild = run(["exec", "tsc", "-p", "tsconfig.electron.json"]);
await new Promise((resolve, reject) => {
  initialBuild.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("Electron build failed"))));
});

run(["exec", "tsc", "-p", "tsconfig.electron.json", "--watch"]);
run(["exec", "vite", "--host", "127.0.0.1", "--port", "5173", "--strictPort"]);
await waitForServer();
startElectron();

const outputWatcher = watch("dist-electron", { recursive: true }, restartElectron);

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  outputWatcher.close();
  clearTimeout(restartTimer);
  stopElectron();
  for (const child of children) child.kill();
  process.exit(code);
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
