import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("boringmoney", {
  getVaultPath: () => ipcRenderer.invoke("vault:get-path"),
  chooseVault: () => ipcRenderer.invoke("vault:choose"),
  importFiles: (paths: string[]) => ipcRenderer.invoke("files:import", paths),
  listFiles: () => ipcRenderer.invoke("files:list"),
  // Electron 44 removed File.path; webUtils.getPathForFile is the sync replacement.
  getFilePath: (file: File) => webUtils.getPathForFile(file),
});
