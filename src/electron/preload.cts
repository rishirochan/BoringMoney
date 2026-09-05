import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("boringmoney", {
  getVaultPath: () => ipcRenderer.invoke("vault:get-path"),
  chooseVault: () => ipcRenderer.invoke("vault:choose"),
  importFiles: (paths: string[]) => ipcRenderer.invoke("files:import", paths),
  listFiles: () => ipcRenderer.invoke("files:list"),
  listDocuments: () => ipcRenderer.invoke("documents:list"),
  getParsed: (id: string) => ipcRenderer.invoke("documents:parsed", id),
  deleteDocument: (id: string) => ipcRenderer.invoke("documents:delete", id),
  listTransactions: () => ipcRenderer.invoke("transactions:list"),
  // Electron 44 removed File.path; webUtils.getPathForFile is the sync replacement.
  getFilePath: (file: File) => webUtils.getPathForFile(file),
});
